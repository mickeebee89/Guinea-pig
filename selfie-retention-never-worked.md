# The 90-day selfie retention promise has never been kept, and could not have been

_Found 24 Aug 2026, during the audit. Not yet fixed._

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

1. **Repair the stranded row** — set `selfie_url` null once the constraint
   allows it, since its object is already gone.
2. **Make the job observable when idle.** It returns early and writes nothing
   when there is nothing to purge, which is exactly why 20 green rows meant
   nothing. An audit row on every run, including zero-purge runs, turns "no rows"
   from ambiguous into diagnostic.
3. **Re-run the manual proof** — age a row, dry run, real run, confirm the object
   is gone, `selfie_url` is null, and an `admin_audit_log` row exists. Only that
   sequence demonstrates the promise can be kept.
4. **Do not publish the 90-day sentence as verified until step 3 passes.**
   `supabase/purge-selfies-cron.sql:73` already said this: *"Only publish the
   90-day sentence in the privacy policy once a real run has completed and the
   audit entries are appearing."* That instruction was written, and not followed.

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
