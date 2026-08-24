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

/**
 * Get a readable message out of anything that was thrown.
 *
 * The handler used to be `err instanceof Error ? err.message : String(err)`,
 * which turned every non-Error into the string "[object Object]". supabase-js
 * returns `{ data, error }` where that error is a PLAIN OBJECT, not an Error —
 * so `throw rmErr` hit the String() branch and the function reported an empty
 * fact about a failure it had fully in hand.
 *
 * That is the same failure shape as the rest of this job's history: a signal
 * that reports something other than what it knows. Every future failure of this
 * function was unreportable until this was fixed.
 */
function describeError(err: unknown): { message: string; detail: unknown } {
  if (err instanceof Error) return { message: err.message, detail: { name: err.name } }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const message =
      typeof o.message === 'string' ? o.message
      : typeof o.error === 'string' ? o.error
      : JSON.stringify(o)
    // The whole object goes back too: StorageError carries statusCode and error,
    // and which of those is set is usually the difference between "wrong key"
    // and "not allowed".
    return { message, detail: o }
  }
  return { message: String(err), detail: null }
}

/** Throw with the step named, so a message says WHERE as well as what. */
function fail(step: string, err: unknown): never {
  const { message, detail } = describeError(err)
  throw Object.assign(new Error(`${step}: ${message}`), { step, detail })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // This deletes personal data on a schedule, so it must not be publicly callable.
  // The caller proves itself with a shared secret rather than a user JWT — cron has
  // no user. Fail closed if the secret isn't configured at all.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected) return respond({ error: 'CRON_SECRET not configured' }, 500)
  if (req.headers.get('x-cron-secret') !== expected) return respond({ error: 'Forbidden' }, 403)

  // ── HOW dryRun IS READ, AND WHY IT FAILS CLOSED ─────────────────────────
  //
  // This used to be `await req.json().catch(() => ({}))`, so ANY unparseable
  // body silently became "not a dry run" — the destructive default. On 24 Aug a
  // dry run sent from PowerShell came back `{"dryRun":false,...,"purged":0}`:
  // PowerShell 5.1 mangles `\"` when handing arguments to a native exe, so
  // curl's body arrived as the fragment `{\"` and never parsed. Nothing was lost
  // only because nothing was eligible yet. Had a row been aged first — which was
  // the very next step — that call would have deleted it while the operator
  // believed they were checking what it WOULD delete.
  //
  // A safety flag that degrades to the dangerous mode when its input is
  // malformed is worse than no flag, because it reads as confirmation.
  //
  // So: a body that is present but unparseable is now a REFUSAL, not a default.
  // Cron sends a valid `{}` (see purge-selfies-cron.sql), so this cannot affect
  // the scheduled run. The query parameter is offered because it survives every
  // shell's quoting rules, which a JSON body demonstrably does not.
  const dryRunFromQuery = new URL(req.url).searchParams.get('dryRun') === 'true'

  let dryRunFromBody = false
  const raw = await req.text()
  if (raw.trim().length > 0) {
    try {
      dryRunFromBody = (JSON.parse(raw) as { dryRun?: unknown })?.dryRun === true
    } catch {
      return respond({
        error: 'Body was sent but is not valid JSON. Refusing to run.',
        hint: 'A malformed body must never be read as "not a dry run". '
            + 'Use ?dryRun=true on the URL, or send a valid JSON body.',
        received: raw.slice(0, 80),
      }, 400)
    }
  }

  const dryRun = dryRunFromQuery || dryRunFromBody

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
    if (decidedErr) fail('query decided rows', decidedErr)

    // Never reviewed and older than the window — abandoned, so it falls under the
    // same promise. Keyed on created_at because reviewed_at is null by definition.
    const { data: abandoned, error: abandonedErr } = await db
      .from('verification_requests')
      .select('id, user_id, selfie_url, status, created_at')
      .eq('status', 'pending')
      .not('selfie_url', 'is', null)
      .lt('created_at', cutoff)
      .limit(MAX_PER_RUN)
    if (abandonedErr) fail('query abandoned rows', abandonedErr)

    const rows = [...(decided ?? []), ...(abandoned ?? [])]
    if (rows.length === 0) {
      // Report against the field the caller expects — saying "purged: 0" on a dry
      // run claims an action that didn't happen, which misreads in logs later.
      return respond({
        ok: true, dryRun, cutoff,
        ...(dryRun ? { wouldPurge: 0 } : { purged: 0 }),
        message: 'Nothing to purge.',
      })
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
    if (rmErr) {
      // The attempted keys go in the detail. "Object not found" and "not
      // permitted" look identical from the outside, and the difference is
      // usually visible in the key itself — a full URL where a path belongs, a
      // leading slash, a bucket name doubled into the key.
      const { message, detail } = describeError(rmErr)
      throw Object.assign(new Error(`storage.remove: ${message}`), {
        step: 'storage.remove',
        detail: { storageError: detail, bucket: BUCKET, attemptedPaths: paths },
      })
    }

    // Then drop the reference. The admin UI already renders a missing object as
    // "No photo", so a null here reads correctly rather than as a broken image.
    const { error: nullErr } = await db
      .from('verification_requests')
      .update({ selfie_url: null })
      .in('id', rows.map(r => r.id))
    if (nullErr) fail('null selfie_url', nullErr)

    // Evidence the retention promise is being kept. admin_id is null: this is the
    // system acting on a schedule, not a person.
    // Deliberately NOT `fail()`: the objects are already gone and the rows are
    // already nulled, so throwing here would report a purge that did happen as
    // one that didn't. But an unchecked insert is how the evidence for a legal
    // retention claim goes missing without anyone noticing, so it is logged
    // loudly and named in the response instead.
    const { error: auditErr } = await db.from('admin_audit_log').insert({
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

    if (auditErr) {
      console.error('[purge-selfies] PURGED BUT NOT AUDITED',
        JSON.stringify(describeError(auditErr)))
    }

    return respond({
      ok: true, dryRun: false, cutoff, purged: rows.length,
      // Surfaced rather than swallowed: a purge with no audit row is a deletion
      // this system cannot later prove it performed.
      ...(auditErr ? { auditWriteFailed: describeError(auditErr).message } : {}),
    })
  } catch (err) {
    const { message, detail } = describeError(err)
    // Full object server-side: the response is for whoever called, the log is
    // for whoever has to work out why at 03:15 with nobody watching.
    console.error('[purge-selfies] FAILED', message, JSON.stringify({
      step: (err as { step?: string })?.step ?? 'unknown',
      detail: (err as { detail?: unknown })?.detail ?? detail,
    }))
    return respond({
      error: message,
      step: (err as { step?: string })?.step ?? 'unknown',
      detail: (err as { detail?: unknown })?.detail ?? detail,
    }, 500)
  }
})
