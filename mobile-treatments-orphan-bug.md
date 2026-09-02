# Edit Shop empties every slot's treatments — root cause, damage, fix

_Written 10 Aug 2026. This is its own item, not part of the web slice._

**A stylist opens Edit Shop in the app, changes nothing, presses Save — and
every slot in their diary quietly forgets which treatments it was for. Models
are then offered treatments that stylist deliberately did not enable for that
slot, and can book one.**

It is live, it affects any stylist who has ever re-saved Edit Shop, and
**Micky B's account is already confirmed affected** — it was the account the
symptom was first reported against on 11 Jul.

---

## What actually happens

`mobile/src/app/(app)/edit-shop.tsx:115` saved treatments by deleting all of a
provider's rows and re-inserting the selection:

```ts
const { error: delError } = await supabase.from('provider_treatments').delete().eq('provider_id', providerId)
const rows = [...selectedCategories].map(cat => ({ provider_id: providerId, name: cat, category: cat }))
const { error: insError } = await supabase.from('provider_treatments').insert(rows)
if (insError) throw insError
```

Re-inserting mints a **new uuid per category, on every save**. Those uuids are
not private to that table:

| Column | Type | Holds |
|---|---|---|
| `availability.active_treatments` | `uuid[]` | which treatments a slot is for |
| `sessions.treatment_id` | `uuid` | what a booking was booked for |

Nothing anywhere — no trigger, no constraint, no client — cleaned up after that
delete. So both columns are left pointing at rows that no longer exist.

Two smaller faults in the same four lines:

* **`delError` is captured and never read.** Only `insError` is checked. A
  refused delete followed by a successful insert **duplicates** the rows and
  still plays the success haptic.
* Between the delete and the insert the provider holds **zero** treatment rows.
  `public_stylists` requires `cardinality(categories) >= 1`
  (`supabase/public-web-views.sql:154`), so for that window they vanish from the
  public website and the sitemap.

## Why it was filed as niche, and why that was wrong

This surfaced on 11 Jul as *"Model apply: No treatments listed for this slot"*.
The fix was a **fallback** at `apply-session.tsx:293` — when a slot's scoped
treatment set resolves to nothing, offer the provider's entire current list.
`cavy-handover.md:278` then downgraded the root cause to a parked nice-to-have:

> only over-offers for a multi-treatment provider who scopes slots to subsets
> AND has orphans — niche, soft failure

That reasoning assumed orphans are rare accidents. **They are produced
systematically by a routine action.** For any provider who has re-saved Edit
Shop, every slot is orphaned, so the fallback is not a safety net catching an
edge case — it is the normal path. And what it does is invert the stylist's
scoping from "these three treatments" to "anything I do".

The mitigation removed the visible symptom, which is what allowed the cause to
be filed as minor. Same shape as the client-boundary check that passed with a
violation one level down: nothing was reporting a problem, so there appeared not
to be one.

## What a user sees, surface by surface

Nothing crashes and no booking disappears — every read resolves treatments with
a separate query and merges with `?? null`, so there are no inner joins to drop
a row. It is all silent degradation:

| Where | What the user sees |
|---|---|
| **Model applying** (`apply-session.tsx:293`) | **The bad one.** All ids dead → offered the stylist's *entire* treatment list and can book any of it. *Some* ids dead → those are silently dropped from the picker, no message, no count |
| Stylist's day list (`availability/days.tsx:155`) | "No treatments set" on a day that has them |
| Stylist's slot rows (`availability/[date].tsx:257`) | "No treatments" |
| Stylist's availability home (`availability/index.tsx:553`) | Colour stripes render **nothing at all** — a blank gap, no fallback text |
| **Web** availability editor (`DayEditor.tsx:100`) | Every chip shows off. Worse: `update()` at :106 preserves the unmatched id, so it is invisible, unclearable and re-saved for ever |
| Booking cards, both apps | The ` · Treatment` suffix just disappears |
| **Locked chat** (`chat/[sessionId].tsx:546`) | Real content loss — the block is gated on the treatment resolving, so the model loses **the date line too** and cannot tell which booking the locked chat is for |
| `public_stylists` / sitemap | Immune to dangling ids (reads `provider_treatments` directly), but see the zero-rows window above |

## Is the damage already there? — run this first

> **⚠️ The baseline was never captured.** 0012 was applied on 10 Aug before
> Blocks A and B were run, so the number of slots that had been carrying dead
> ids is gone for good — the repair rewrote them. Nothing distinguishes a slot
> the repair emptied from one that was always empty, so it cannot be
> reconstructed. **The repair is therefore unverified against a before-figure,
> and this doc should not be read as saying otherwise.**
>
> Blocks C, D and E survive intact: the migration deliberately does not touch
> `sessions.treatment_id`, and D and E read only `pg_constraint` and
> `provider_treatments`. D — the one that decides whether this was orphaning
> bookings, duplicating rows, or deleting bookings — is unaffected.
>
> The ordering trap is worth naming: the diagnostic lived in comments *inside*
> the file being applied, so "run the migration" and "run the thing that must
> precede the migration" were the same paste. A pre-check that ships inside the
> change it is checking will be skipped sooner or later. Next time it goes in
> its own file.

Full diagnostic blocks are in `supabase/migrations/0012_…sql` under **BEFORE
APPLYING**. The short version:

```sql
select a.provider_id, p.name, count(*) as slots_with_dead_ids
from public.availability a
join public.providers p on p.id = a.provider_id
where a.active_treatments is not null
  and exists (select 1 from unnest(a.active_treatments) as t
              where not exists (select 1 from public.provider_treatments pt where pt.id = t))
group by a.provider_id, p.name
order by slots_with_dead_ids desc;
```

**Block D matters most and settles which failure we have been living with**, by
asking whether `sessions.treatment_id` has a foreign key at all:

* **CASCADE** — Edit Shop has been *deleting bookings* on every save. Worst case,
  and it would explain any unaccounted-for missing sessions.
* **no action / restrict** — the delete has been silently refused whenever a
  booking referenced a treatment, and since `delError` was never read, the
  insert still ran. Those providers have **duplicate** treatment rows, not
  orphans. Block E counts them.
* **no row at all** — nothing was enforcing it and the orphans are real.

The three call for different repairs, so do not skip it.

## What the diagnostic actually found — 10 Aug

```
FK on sessions.treatment_id              NONE - nothing enforces it
bookings pointing at a missing treatment 19
providers with duplicate treatment rows  0
trigger installed                        trg_strip_treatment_from_availability
slots still holding a dead id            0
```

**No foreign key, so the orphans were real** — the third of the three worlds.
Zero duplicates is consistent with that: with nothing enforcing the FK the
deletes always succeeded, so the `delError` fault never had a chance to bite.

**All 19 affected bookings are test data and none of them are live.** Every one
has Micky B as the stylist and Micky's own account as the model (bar one
`Fulltestmodel`); every one is `completed`, `cancelled` or `declined`; the most
recent is 27 Jul.

> **The 19 are ACCEPTED, not overlooked.** Decided 10 Aug: repair none of them.
> They are terminal, they are June–July, and they are one test account booking
> against itself — there is no user to whom the missing label means anything,
> and inventing a treatment for a completed booking would put a guess into a
> historical record. Anyone finding these later should leave them alone; the
> query that lists them is above, and it will keep returning 19.

The recovery attempt via `notifications.body` returned null for all 19. That is
*not* evidence the route does not work — these rows look like `seed/seed.mjs`
inserts (:417, :451), which write `sessions` directly and never create an apply
notification. For a booking made through the app the notification would exist.
Untested, not disproven.

**The finding is about exposure, not damage.** This has been harmless because
there has effectively been one stylist. Thirty cohort stylists with real
bookings is the scenario the fix exists for.

## The fix — three parts, two of them done

1. **✅ The database owns the rule.** `supabase/migrations/0012` adds an
   `after delete` trigger on `provider_treatments` that strips the id from every
   slot that referenced it, plus a one-off repair of the existing dangling ids.
   A trigger, not client code: three writers can delete these rows (mobile, web
   `/shop`, admin) and putting the rule in three clients leaves it one client
   away from being wrong again, which is this bug's whole history.
   **Applied 10 Aug 2026.** (This said "not applied yet" until 2 Sep.)

2. **✅ Mobile stops asking for it.** `edit-shop.tsx` now saves a **diff**:
   a kept category keeps its row and its id, only real additions are inserted,
   only real removals are deleted, one at a time so a refusal can name the
   treatment. The trigger cannot save us from delete-all-and-reinsert, because
   emptying every slot is precisely what that code *asked for*.
   **Typechecks clean; NOT yet run on a device.** Retest on a fresh bundle
   (`npx expo start -c --dev-client`) before believing it.

3. **⬜ The web `/shop` action** already saves a diff, so it never orphans in
   bulk — and once 0012 is applied its genuine removals are cleaned up by the
   trigger. Nothing further to do there, but it depends on 0012 being applied;
   `node scripts/migration-status.mjs` will report it PENDING until then.

4. **⬜ `sessions.treatment_id` is guarded, not constrained.** Migration `0013`
   refuses removing a treatment while a `pending` or `accepted` booking uses it,
   and allows it once that booking is terminal. A foreign key cannot express
   that: `restrict` would mean a stylist who stops doing lashes can never remove
   Lashes, because completed bookings are permanent, and `set null` would
   silently blank the treatment on a live upcoming appointment.

   This also makes an existing promise true. Both shop editors already said
   *"a booking still uses it — it'll come off once that booking is finished or
   cancelled"* and nothing implemented it, so the sentence could never fire.
   **That is the third shipped sentence with no mechanism behind it**, after
   `is_founding_provider` (0011) and the privacy policy's IP claim (0010). All
   three were found by reading, none by anything failing.

   **Applied 19 Aug 2026**, and its guard was later narrowed by `0015` after stale
   `accepted` rows locked treatments permanently. (This said "not applied yet"
   until 2 Sep.) The pre-check was run AFTER the fact, which is what produced
   `0014`. Run `supabase/diagnostics/pre-0013-treatment-delete-guard.sql`
   first — it is a separate file precisely because 0012's pre-check was not.

## Still open

* **`chat/[sessionId].tsx:546`** — a locked chat should show its date whether or
  not the treatment resolves. Small, separate, and a real loss of information to
  the model.
* **The `apply-session.tsx:293` fallback should probably go**, once orphans stop
  being manufactured. It exists to paper over this bug, and what it does when it
  fires is over-offer treatments. But it must not be removed until the diagnostic
  says the data is clean, or it will start showing "no treatments" on real slots.
* **Nothing has been type-checking or linting mobile either.** `tsc --noEmit`
  reports 6 pre-existing errors across `_layout.tsx`, `leave-review.tsx` and
  `sessions.tsx`. None are from this change, and none were noticed.
