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


/**
 * ── THE ORPHAN SWEEP ───────────────────────────────────────────────────────
 * Everything above finds objects VIA verification_requests rows. That is the
 * whole mechanism, and it has a hole: a resubmission uploads to a fresh
 * timestamped path and then deletes the previous row, so the previous OBJECT is
 * left referenced by nothing and no row-based query can ever reach it again.
 * The 90-day promise failed silently for anyone rejected once.
 *
 * Both clients now delete the old object before deleting the row. This exists
 * because that fix depends on every writer remembering, and the retention claim
 * should not. It also clears the orphans already sitting in the bucket, which
 * the client fix cannot reach.
 *
 * Only objects OLDER THAN THE CUTOFF are considered. An object uploaded seconds
 * ago legitimately has no row yet — the upload happens before the insert — so
 * sweeping on "unreferenced" alone would delete a selfie mid-submission.
 */
async function findOrphans(cutoff: string): Promise<{ paths: string[]; scannedFolders: number; capped: boolean }> {
  const MAX_FOLDERS = 500

  // Every path currently claimed by a row, so nothing referenced is touched.
  const { data: refRows, error: refErr } = await db
    .from('verification_requests').select('selfie_url').not('selfie_url', 'is', null)
  if (refErr) fail('query referenced selfie paths', refErr)
  const referenced = new Set((refRows ?? []).map(r => r.selfie_url as string))

  // The bucket is one folder per user id.
  const { data: folders, error: folderErr } = await db.storage
    .from(BUCKET).list('', { limit: MAX_FOLDERS })
  if (folderErr) fail('list selfie folders', folderErr)

  const capped = (folders ?? []).length >= MAX_FOLDERS
  const orphans: string[] = []

  for (const folder of folders ?? []) {
    if (!folder.name) continue
    const { data: files, error: fileErr } = await db.storage
      .from(BUCKET).list(folder.name, { limit: 100 })
    if (fileErr) {
      // One unreadable folder must not abort the whole sweep, but it must not
      // pass silently either — an unswept folder is an unkept promise.
      console.error('[purge-selfies] could not list folder', folder.name, fileErr.message)
      continue
    }
    for (const file of files ?? []) {
      const path = `${folder.name}/${file.name}`
      if (referenced.has(path)) continue
      const created = file.created_at ?? file.updated_at
      if (!created || created >= cutoff) continue   // too new, or unknown age
      orphans.push(path)
    }
  }

  return { paths: orphans, scannedFolders: (folders ?? []).length, capped }
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

  const realCutoff = new Date(Date.now() - RETAIN_DAYS * 864e5).toISOString()

  // ── DRY-RUN-ONLY CUTOFF OVERRIDE ──────────────────────────────────────────
  // Proving the orphan sweep otherwise means waiting for an object to age past
  // 90 days, or hand-editing `storage.objects.created_at` — a platform table
  // Supabase owns, with its own triggers, which is the same category of edit
  // that produced malformed `auth.users` rows and broke sign-in and account
  // deletion earlier this month.
  //
  // So the sweep's QUERY can be exercised against a nearer date instead. This
  // changes what is listed, never what is deleted.
  //
  // REFUSED ON A REAL RUN, deliberately and loudly. An override that widens a
  // deletion window is exactly the shape of thing that gets passed by accident
  // once and takes real data with it, and "dryRun defaulted to destructive" is
  // a mistake this function has already made once.
  const cutoffOverride = new URL(req.url).searchParams.get('orphanCutoff')
  if (cutoffOverride && !dryRun) {
    return respond({
      error: 'orphanCutoff is only accepted on a dry run. It widens the deletion '
           + 'window, so it must never decide what actually gets removed. Re-send with '
           + '?dryRun=true, or wait for the real 90-day cutoff.',
      realCutoff,
    }, 400)
  }
  if (cutoffOverride && Number.isNaN(Date.parse(cutoffOverride))) {
    return respond({ error: `orphanCutoff is not a date I can parse: ${cutoffOverride}` }, 400)
  }

  // Row-based purging ALWAYS uses the real cutoff. Only the orphan scan moves.
  const cutoff = realCutoff
  const orphanCutoff = cutoffOverride
    ? new Date(cutoffOverride).toISOString()
    : realCutoff

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
      // NO ROWS DUE IS NOT NOTHING TO DO. This used to return here, which would
      // have skipped the orphan sweep in the single most common case — no rows
      // expiring today, orphaned objects sitting in the bucket regardless. The
      // sweep exists precisely for objects no row points at, so gating it on
      // rows would have made it unreachable exactly when it was needed.
      const orphans = await findOrphans(orphanCutoff)
      let swept = 0
      if (!dryRun && orphans.paths.length > 0) {
        const { error: orphanErr } = await db.storage.from(BUCKET).remove(orphans.paths)
        if (orphanErr) {
          console.error('[purge-selfies] orphan sweep failed',
            JSON.stringify(describeError(orphanErr)))
        } else {
          swept = orphans.paths.length
          const { error: auditErr } = await db.from('admin_audit_log').insert({
            action: 'selfie_retention_purge',
            admin_id: null,
            details: { purged: 0, orphans_purged: swept, retain_days: RETAIN_DAYS, cutoff },
          })
          if (auditErr) {
            console.error('[purge-selfies] ORPHANS PURGED BUT NOT AUDITED',
              JSON.stringify(describeError(auditErr)))
          }
        }
      }
      // Report against the field the caller expects — saying "purged: 0" on a dry
      // run claims an action that didn't happen, which misreads in logs later.
      return respond({
        ok: true, dryRun, cutoff,
        ...(orphanCutoff !== cutoff ? { orphanCutoffOverride: orphanCutoff } : {}),
        ...(dryRun
          ? { wouldPurge: 0, wouldPurgeOrphans: orphans.paths.length, orphanPaths: orphans.paths }
          : { purged: 0, orphansPurged: swept }),
        ...(orphans.capped ? { orphanScanCapped: orphans.scannedFolders } : {}),
        message: orphans.paths.length === 0
          ? 'Nothing to purge.'
          : `No rows due, but ${orphans.paths.length} orphaned object(s) found.`,
      })
    }

    const paths = rows.map(r => r.selfie_url as string).filter(Boolean)

    if (dryRun) {
      const orphans = await findOrphans(orphanCutoff)
      return respond({
        ok: true, dryRun: true, cutoff,
        ...(orphanCutoff !== cutoff ? { orphanCutoffOverride: orphanCutoff } : {}),
        wouldPurge: rows.length,
        // Named separately from wouldPurge: these are objects no row points at,
        // which is a different failure from a row whose time is up.
        wouldPurgeOrphans: orphans.paths.length,
        orphanPaths: orphans.paths,
        // No silent caps. If the folder listing hit its limit, say so — a sweep
        // that quietly covered part of the bucket reads as a clean bucket.
        ...(orphans.capped ? { orphanScanCapped: orphans.scannedFolders } : {}),
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

    // The orphan sweep, after the row-based purge so the referenced set already
    // reflects the nulls written above.
    const orphans = await findOrphans(orphanCutoff)
    let orphansPurged = 0
    if (orphans.paths.length > 0) {
      const { error: orphanErr } = await db.storage.from(BUCKET).remove(orphans.paths)
      if (orphanErr) {
        // Logged, not thrown: the row-based purge above already succeeded and
        // throwing here would report it as failed. But it is named in the
        // response so a silent failure cannot look like an empty bucket.
        console.error('[purge-selfies] orphan sweep failed',
          JSON.stringify(describeError(orphanErr)))
      } else {
        orphansPurged = orphans.paths.length
      }
    }

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
        orphans_purged: orphansPurged,
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
      orphansPurged,
      ...(orphans.capped ? { orphanScanCapped: orphans.scannedFolders } : {}),
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
