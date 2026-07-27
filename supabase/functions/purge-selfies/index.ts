// Supabase Edge Function — purge-selfies
//
// Deletes identity-verification selfies 90 days after the verification was
// DECIDED, so the retention period stated in the privacy policy is actually
// enforced rather than aspirational.
//
// Covers three cases, not just approvals:
//   approved / rejected  -> 90 days after reviewed_at
//   pending (abandoned)  -> 90 days after created_at
// A rule covering only approvals would keep every rejected applicant's selfie
// forever, which would make the policy untrue by omission.
//
// Account deletion already purges selfies immediately (delete-account); this is
// the time-based half.
//
// Runs as the SERVICE ROLE — the verification-selfies bucket is private and its
// only read policy is admin-scoped, so nothing else can remove these objects.
//
// Deploy:  npx supabase functions deploy purge-selfies
// Schedule: see supabase/purge-selfies-cron.sql

import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const BUCKET       = 'verification-selfies'
const RETAIN_DAYS  = 90
const MAX_PER_RUN  = 500   // keeps a single run bounded; the schedule catches the rest

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // This deletes personal data on a schedule, so it must not be publicly callable.
  // The caller proves itself with a shared secret rather than a user JWT — cron has
  // no user. Fail closed if the secret isn't configured at all.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected) return respond({ error: 'CRON_SECRET not configured' }, 500)
  if (req.headers.get('x-cron-secret') !== expected) return respond({ error: 'Forbidden' }, 403)

  let dryRun = false
  try {
    const body = await req.json().catch(() => ({}))
    dryRun = body?.dryRun === true
  } catch { /* no body is fine */ }

  const cutoff = new Date(Date.now() - RETAIN_DAYS * 864e5).toISOString()

  try {
    // Decided (approved or rejected) more than RETAIN_DAYS ago.
    const { data: decided, error: decidedErr } = await db
      .from('verification_requests')
      .select('id, user_id, selfie_url, status, reviewed_at')
      .in('status', ['approved', 'rejected'])
      .not('selfie_url', 'is', null)
      .lt('reviewed_at', cutoff)
      .limit(MAX_PER_RUN)
    if (decidedErr) throw decidedErr

    // Never reviewed and older than the window — abandoned, so it falls under the
    // same promise. Keyed on created_at because reviewed_at is null by definition.
    const { data: abandoned, error: abandonedErr } = await db
      .from('verification_requests')
      .select('id, user_id, selfie_url, status, created_at')
      .eq('status', 'pending')
      .not('selfie_url', 'is', null)
      .lt('created_at', cutoff)
      .limit(MAX_PER_RUN)
    if (abandonedErr) throw abandonedErr

    const rows = [...(decided ?? []), ...(abandoned ?? [])]
    if (rows.length === 0) {
      return respond({ ok: true, dryRun, cutoff, purged: 0, message: 'Nothing to purge.' })
    }

    const paths = rows.map(r => r.selfie_url as string).filter(Boolean)

    if (dryRun) {
      return respond({
        ok: true, dryRun: true, cutoff,
        wouldPurge: rows.length,
        breakdown: {
          approved:  rows.filter(r => r.status === 'approved').length,
          rejected:  rows.filter(r => r.status === 'rejected').length,
          abandoned: rows.filter(r => r.status === 'pending').length,
        },
      })
    }

    // Remove the objects first. If this fails we keep selfie_url pointing at them,
    // so the next run retries rather than orphaning files we've lost the path to.
    const { error: rmErr } = await db.storage.from(BUCKET).remove(paths)
    if (rmErr) throw rmErr

    // Then drop the reference. The admin UI already renders a missing object as
    // "No photo", so a null here reads correctly rather than as a broken image.
    const { error: nullErr } = await db
      .from('verification_requests')
      .update({ selfie_url: null })
      .in('id', rows.map(r => r.id))
    if (nullErr) throw nullErr

    // Evidence the retention promise is being kept. admin_id is null: this is the
    // system acting on a schedule, not a person.
    await db.from('admin_audit_log').insert({
      action: 'selfie_retention_purge',
      admin_id: null,
      details: {
        purged: rows.length,
        retain_days: RETAIN_DAYS,
        cutoff,
        approved:  rows.filter(r => r.status === 'approved').length,
        rejected:  rows.filter(r => r.status === 'rejected').length,
        abandoned: rows.filter(r => r.status === 'pending').length,
      },
    })

    return respond({ ok: true, dryRun: false, cutoff, purged: rows.length })
  } catch (err) {
    console.error('[purge-selfies]', err)
    return respond({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
