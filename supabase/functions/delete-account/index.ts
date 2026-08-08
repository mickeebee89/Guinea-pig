// Supabase Edge Function — delete-account
// Permanently deletes the AUTHENTICATED caller's own account. Never trusts a
// passed id — the target is always derived from the verified JWT.
// Deploy: supabase functions deploy delete-account
//
// ── WHY THIS WAS REWRITTEN (8 Aug 2026) ──────────────────────────────────────
// The previous version attempted to DELETE from session_consents and
// moderation_actions. Both are append-only by trigger, so those deletes always
// failed. A best-effort helper swallowed the failure and carried on, the
// surviving rows then blocked the sessions delete and the auth delete, and the
// request returned 500 — AFTER messages, reviews, notifications, provider rows
// and all four storage buckets had already been destroyed.
//
// A user who had ever applied for a booking could not delete their account, and
// each attempt stripped more of it. That is the Apple 5.1.1(v) surface.
//
// Three rules now, in order of importance:
//   1. NOTHING IS DESTROYED until we know the deletion can finish. The preflight
//      is read-only and aborts on a blocker, leaving the account whole.
//   2. THE DATABASE WORK IS ONE TRANSACTION (delete_account_data RPC). All rows
//      go or none do. No more partial wipes.
//   3. ANYTHING REQUIRED FAILS LOUDLY. `optional()` is only for work whose
//      failure genuinely does not compromise the outcome, and every use says
//      why. Nothing that must succeed continues past an error.
//
// session_consents and moderation_actions SURVIVE DELIBERATELY. They carry
// their own subject identity and are purged by retention (6 years; ip/device
// scrubbed at 12 months). See supabase/account-deletion-fix.sql.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@14'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function getVerifiedUser(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  )
  const { data: { user } } = await anonClient.auth.getUser()
  return user
}

/** Non-fatal work. Every call site must justify why failing here is acceptable. */
async function optional(label: string, q: PromiseLike<{ error: unknown }>, warnings: string[]) {
  const { error } = await q
  if (error) warnings.push(`${label}: ${(error as { message?: string })?.message ?? String(error)}`)
}

// ── Step 1: preflight ────────────────────────────────────────────────────────
// Read-only. Confirms the auth delete will not be blocked by a reference this
// function does not clear. Runs BEFORE anything is destroyed, so a blocker
// leaves the account exactly as it was.
//
// The immutable tables are absent on purpose: their FKs to auth.users were
// severed, so their rows no longer block anything.
async function preflight(me: string): Promise<string[]> {
  const blockers: string[] = []

  // Every NO ACTION FK to auth.users that this function does NOT clear.
  //   sessions.model_user_id  -> deleted by the RPC
  //   reports.reviewed_by     -> nulled by the RPC
  //   session_consents.*      -> FK severed, rows survive by design
  //   moderation_actions.*    -> FK severed, rows survive by design
  // What remains are two genuine open cases. Blocking here is deliberate: it
  // reports the problem with the account intact, instead of the old behaviour
  // of stripping the account and then failing on the auth delete.
  const stillReferencing: [string, string][] = [
    // Allergy patch tests. Needs its own decision — the model's own records
    // should probably go with them, but patch_tests.provider_id and .logged_by
    // also point at auth.users, and their nullability is unconfirmed. Not
    // guessed at here.
    ['patch_tests', 'model_id'],
    ['patch_tests', 'provider_id'],
    ['patch_tests', 'logged_by'],
    // An admin deleting their own account. admin_id records WHO acted, so
    // nulling it silently would gut the audit trail. Rare and deliberate
    // enough to want a human in the loop.
    ['admin_audit_log', 'admin_id'],
  ]

  for (const [table, column] of stillReferencing) {
    const { count, error } = await db
      .from(table).select('id', { count: 'exact', head: true }).eq(column, me)
    // A table we cannot read is itself a blocker — we cannot prove it is clear.
    if (error) { blockers.push(`${table}.${column}: unreadable (${error.message})`); continue }
    if ((count ?? 0) > 0) blockers.push(`${table}.${column}: ${count} row(s)`)
  }

  return blockers
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const user = await getVerifiedUser(req)
  if (!user) return respond({ error: 'Unauthorized' }, 401)
  const me = user.id
  const warnings: string[] = []

  try {
    // ── 1. Preflight — abort while the account is still intact ───────────────
    const blockers = await preflight(me)
    if (blockers.length > 0) {
      console.error('[delete-account] preflight blocked, nothing deleted', me, blockers)
      return respond({
        error: 'Could not delete account. Nothing has been removed — please contact support.',
        blockers,
      }, 409)
    }

    // ── 2. Stop billing before the subscription row is discarded ─────────────
    // Optional by design: GDPR erasure must not be blocked by a payment
    // provider being unreachable. A real failure is recorded as a billing
    // orphan so it can be cancelled by hand.
    const { data: subRow } = await db.from('subscriptions')
      .select('stripe_subscription_id, stripe_customer_id').eq('user_id', me).maybeSingle()
    if (subRow?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(subRow.stripe_subscription_id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!/no such subscription|already canceled|resource_missing/i.test(msg)) {
          warnings.push(`stripe_cancel: ${msg}`)
          await optional('audit_billing_orphan', db.from('admin_audit_log').insert({
            action: 'billing_orphan_on_delete',
            admin_id: null,
            target_user_id: null,
            details: {
              user_id: me,
              stripe_subscription_id: subRow.stripe_subscription_id,
              stripe_customer_id: subRow.stripe_customer_id,
              error: msg,
            },
          }), warnings)
        }
      }
    }

    // ── 3. Database — one transaction, all or nothing ────────────────────────
    // REQUIRED. A failure here aborts with the account untouched, because the
    // RPC rolls back in full.
    const { data: counts, error: dbErr } = await db.rpc('delete_account_data', { p_user: me })
    if (dbErr) {
      console.error('[delete-account] db transaction failed, rolled back', me, dbErr)
      return respond({
        error: 'Could not delete account. Nothing has been removed — please contact support.',
        details: dbErr.message,
      }, 500)
    }

    // ── 4. Storage — after the commit, deliberately ──────────────────────────
    // Not transactional, so it runs once the rows are definitely gone. A
    // failure leaves unreachable objects under a deleted user's folder, which
    // is sweepable; running it earlier risked destroying files for an account
    // that then failed to delete. Buckets key by `${userId}/…`.
    for (const bucket of ['verification-selfies', 'profile-pics', 'model-photos', 'portfolio-photos']) {
      try {
        const { data: files, error } = await db.storage.from(bucket).list(me, { limit: 1000 })
        if (error) { warnings.push(`storage_${bucket}: ${error.message}`); continue }
        if (files && files.length > 0) {
          const { error: rmErr } = await db.storage.from(bucket)
            .remove(files.map(f => `${me}/${f.name}`))
          if (rmErr) warnings.push(`storage_${bucket}: ${rmErr.message}`)
        }
      } catch (e) {
        warnings.push(`storage_${bucket}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ── 5. The auth user — the source of truth for "account gone" ────────────
    // REQUIRED. If this fails the account still exists, so the caller must be
    // told plainly rather than shown a success.
    const { error: authErr } = await db.auth.admin.deleteUser(me)
    if (authErr) {
      console.error('[delete-account] auth delete failed after db+storage', me, authErr, warnings)
      return respond({
        error: 'Your data was removed but the account could not be closed. Please contact support.',
        details: authErr.message,
      }, 500)
    }

    if (warnings.length > 0) {
      // Surfaced, never silent: these need a human to sweep them.
      console.warn('[delete-account] completed with warnings', me, { counts, warnings })
    }
    return respond({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[delete-account] unhandled', me, err)
    return respond({ error: message }, 500)
  }
})
