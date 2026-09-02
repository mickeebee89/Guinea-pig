# The 90-day selfie retention promise has never been kept, and could not have been

_Found 24 Aug 2026, during the audit. **FIXED AND PROVEN the same day.**
`0020` applied 13:04; the end-to-end proof completed 16:29 — the first selfie
this system has ever deleted._

**The privacy policy publishes a 90-day retention period for identity-verification
selfies. The job that enforces it cannot complete. Not in an edge case — its
central operation is forbidden by the schema, so no selfie has ever been deleted
by it and none ever could have been.**

`purge-selfies` deletes the storage object, then sets
`verification_requests.selfie_url = null`. That column is **NOT NULL**. The
update throws `23502` every time, on every row, always.

---

## Nothing has actually been over-retained yet

The clock runs from `reviewed_at` (decided) or `created_at` (abandoned). The
oldest rows are 7–8 July 2026, so the first selfie becomes eligible for deletion
around **5 October 2026**. Until then there is nothing the job should have
deleted, so the published promise has not yet been broken in fact.

**It was found roughly six weeks before the first breach.** No disclosure
question arises today. It would have arisen in October.

---

## Why nothing caught it

Four separate signals all reported success, and each was reporting something
other than what it claimed.

| Layer | Reported | Actually meant |
|---|---|---|
| `cron.job_run_details` | `succeeded`, nightly, 20+ runs | `net.http_post` **dispatched**. Says nothing about the response |
| `net._http_response` | `200` | The function ran and returned cleanly — because it took the **"Nothing to purge"** early return every single time |
| The `dryRun` flag | honoured | Silently defaulted to the DESTRUCTIVE mode whenever its body failed to parse |
| The error handler | `{"error":"[object Object]"}` | It had the full error and discarded it |

The deciding factor: **the purge branch had never once executed.** Every
scheduled run since the job was installed found nothing eligible and returned
early. The first execution of that code path in its entire life was a manual
test on 24 Aug 2026 — which failed immediately.

Had that test not been run, the first execution would have been **early October,
at 03:15 UTC, unattended, against a real user's selfie** — and it would have
failed silently while `cron.job_run_details` recorded another success.

---

## The state this leaves

A failure between the two steps strands data, and the code comment at
`supabase/functions/purge-selfies/index.ts:176` does not cover it. It reasons
only about a FAILED remove ("we keep selfie_url pointing at them, so the next run
retries"). It says nothing about a SUCCEEDED remove followed by a failed null,
which is the case that actually occurs — every time, by construction.

Result: **object deleted, row still pointing at it.** And it is self-perpetuating
— the next run re-selects the row (`selfie_url` is not null, date still old),
removes a key that is already gone, fails the null again, and leaves the identical
state. Nightly. Reporting success each time.

One row is in this state now, deliberately: `346e01a0-ad56-4499-86c8-dd2fec9ace69`,
aged for the test.

---

## The fix

**Drop the NOT NULL constraint.**

```sql
alter table public.verification_requests alter column selfie_url drop not null;
```

Two places already treat null as the correct post-purge state, so nothing else
needs to change:

* `admin/app/verification/page.tsx:52` — `if (!r.selfie_url) return [r.id, '']`,
  rendering the "No photo" placeholder.
* Migration `0019`'s `vr_selfie_path_matches_user` — `selfie_url is null or
  selfie_url like (user_id::text || '/%')`.

The column genuinely is optional once the object is gone. The constraint was
asserting a fact the product contradicts.

Rejected alternatives:

* **A sentinel** (`'purged'`) keeps the constraint but re-selects purged rows for
  ever unless the query also learns the string, and violates `0019`'s policy so
  no client could write it.
* **Deleting the row** destroys the record of a safety decision, removes the
  `reviewed_at` the retention clock reads, and contradicts `0004`'s principle
  that moderation evidence survives deletion.

### Also required

1. ~~**Repair the stranded row**~~ — done by `0020`. `346e01a0…` now has
   `selfie_url` null; its object was already gone.
2. **Make the job observable when idle.** It returns early and writes nothing
   when there is nothing to purge, which is exactly why 20 green rows meant
   nothing. An audit row on every run, including zero-purge runs, turns "no rows"
   from ambiguous into diagnostic.
3. ~~**Re-run the manual proof**~~ — done, 24 Aug 16:21–16:29. See below.
4. ~~**Do not publish the 90-day sentence as verified until step 3 passes.**~~ —
   step 3 now passes. `supabase/purge-selfies-cron.sql:73` set that condition
   (*"Only publish the 90-day sentence in the privacy policy once a real run has
   completed and the audit entries are appearing"*) and it has finally been met,
   rather than assumed.

---

## The proof, 24 Aug 2026

Row `2d33f81f-534a-4b21-9d64-d3bf12799e68`, submitted through `/verify` on the
web, then aged past the cutoff.

| Step | Result |
|---|---|
| Age `created_at` to 16 May | `pending`, `selfie_url` populated |
| Dry run | `wouldPurge: 1`, `breakdown: { approved: 0, rejected: 0, abandoned: 1 }` |
| Real run | `ok: true, dryRun: false, purged: 1`, no `auditWriteFailed` |
| Confirm | `selfie_url` **null** · object **gone** from storage · **1** `selfie_retention_purge` audit row |

The `abandoned: 1` in the breakdown matters: it confirms the row was selected by
the branch intended, and that nothing else was swept in alongside it.

**Coverage.** The two selection queries differ only in their WHERE clause and
merge into one list; `paths`, `storage.remove`, the null and the audit write are
common code. This run exercised the **abandoned** selection plus the entire
shared tail. The **decided** selection was demonstrated separately on 24 Aug —
it found its row and reached `storage.remove` before dying on the NOT NULL. So
both selections and the shared destructive path have now each been shown to
work.

**The row does not come back.** It keeps `status = 'pending'` with `selfie_url`
null, and the abandoned query filters on `selfie_url is not null` — so it is not
re-selected on subsequent nights. The self-perpetuating re-selection that the
old failure produced does not occur.

**Still outstanding:** the job writes nothing when there is nothing to purge, so
a future breakage would again be invisible until someone asked. See "Also
required", item 2.

---

## Decision: what we keep after a purge, and what we do not

**Settled 24 Aug 2026.** The end state below is intended, not a side effect.

After the 90 days elapse and the purge runs, an account is **permanently
verified and the photograph is gone**. What remains:

* `verification_requests` — status, `reviewed_at`, the reviewer's note
* `admin_audit_log` — the approval: who decided, when, the outcome
* `admin_audit_log` — the deletion, recording that retention was honoured

So the *decision* is retained and the *input to it* is not. That is the right way
round. Keeping a face on file indefinitely so it could hypothetically be
re-examined is precisely what a retention policy exists to prevent, and
re-examining a photograph months later is not a meaningful control anyway. For a
check described as modestly as this one — a person compared a selfie against a
profile photo — the decision record IS the artefact.

**What this deliberately gives up:** the ability to look at the original image
during a later dispute. Accepted. The audit trail answers who verified whom and
when, which is the question a dispute actually turns on.

### The real gap this exposed is revocation, not retention

Checked 24 Aug: `is_verified` is set to `true` in two places in the admin
console and **set to `false` nowhere in the entire product**. Verification is
one-way. Not reversible for a mistaken approval, for fraud, for an account that
later proves to be someone else, or for a dispute. The only route today is an
`UPDATE` by hand.

That — not the retention behaviour — is what needs building, and it happens to
dissolve the resubmit problem: an admin revoke that clears `is_verified` and
deletes the request row leaves the account in a state `/verify` already handles
(provider, no request, submit offered). No new web surface required.

Scoped as its own item; see the audit plan.

---

## The pattern, fifth instance

Every fault here is the same shape: **a success signal that does not depend on
the thing it claims to prove.** Cron reporting dispatch as completion. A dry-run
flag defaulting to destructive. An error handler discarding the error. A NOT NULL
constraint asserting a state the product contradicts.

Same family as the client-boundary check that passed with a violation one level
down, and the six published providers with no name. In each case nothing was
reporting a problem, so there appeared not to be one.

The general defence is the one this job lacked: **make the thing execute its real
path, deliberately, before it has to do so unattended.** This was found only
because the system was driven into a state it had never occupied.

---

## 2 Sep 2026 — the leak is older than the fix that found it

The orphan sweep's first real listing found **two** unreferenced objects, both
under the provider test account `517c2853`:

```
517c2853-.../selfie-1787162837357.jpg   2026-08-19
517c2853-.../selfie-1783525522986.jpg   2026-07-08
```

**The 8 July object matters more than the August one.** The August orphan was
created during piece 4's testing, so it could be dismissed as an artefact of
looking. July's cannot: it predates that work by six weeks and was made by the
ordinary resubmit path. The leak is not something the audit introduced by poking
at verification — it has been running since at least early July, and every
rejected-then-resubmitted selfie since has left one behind.

That also settles what the sweep is for. It was justified as "the client fix
depends on every writer remembering". Its first run showed it is also the only
thing that can reach objects stranded before the fix existed, which is the larger
half.

### Why `storage.objects.created_at` was not edited to test it

The obvious way to exercise the sweep today is to age an object past the 90-day
cutoff. That means `update storage.objects set created_at = ...` — a table
Supabase owns, in a schema with its own triggers, which the Storage API reads
through.

Hand-editing `auth.users` earlier this month produced malformed rows that broke
both sign-in and account deletion. Same category: a platform table whose
invariants are not ours and are not written down anywhere we control. Six weeks
of waiting is cheaper than one malformed storage row, and the July object crosses
90 days in early October by itself.

Instead the function takes an `?orphanCutoff=` parameter that is **accepted only
on a dry run** and refused with a 400 on a real one. It moves what the scan
*lists*, never what gets *deleted*, and the response names the override whenever
it is in effect so a widened scan cannot be mistaken for the real one. The
row-based purge always uses the true 90-day cutoff regardless.

That proves the query today and leaves the deletion to happen on its own
schedule — which is also a better test, because nobody will have touched
anything by then.

---

## ⏰ THE OCTOBER CHECK — DIARISED 2 Sep 2026

**A one-time reminder is scheduled for 8 October 2026** (Claude Code scheduled
task `selfie-orphan-purge-check`, and this heading, because a reminder that lives
only in a tool nobody opens is not a record).

The 8 July orphan crosses 90 days on about **6 October**. The
`purge-verification-selfies` cron runs **daily at 03:15**, so it should be deleted
without anyone arranging it.

**Why the date matters more than the deletion.** This is the only end-to-end proof
this job will ever get that nobody set up. Every other test of it has been staged:
a row aged by hand, an object listed against a moved cutoff, a dry run pointed at
a nearer date. All of those prove the query. None proves the *schedule*.

**If nobody looks, it passes unobserved — which is the same failure as the twenty
green `cron.job_run_details` rows.** Those recorded dispatch and were read as
completion for weeks. An unwatched success is indistinguishable from an unwatched
failure, and this file exists because that distinction was missed once already.

What to check on the day:

```sql
-- 1. The July object should be gone. The August one may remain; it crosses
--    90 days in mid-November, and that is correct rather than a failure.
select o.name, o.created_at
from storage.objects o
where o.bucket_id = 'verification-selfies'
  and o.name not in (
    select selfie_url from public.verification_requests where selfie_url is not null
  )
order by o.created_at;

-- 2. The evidence. A purge with no audit row is a deletion we cannot prove.
select created_at, details
from public.admin_audit_log
where action = 'selfie_retention_purge'
order by created_at desc limit 10;
```

If the July object is still there, that is a real finding rather than a delay:
the sweep works on demand but is not running in production. Look at
`cron.job_run_details`, then the function logs, then whether the deployed version
predates the sweep.
