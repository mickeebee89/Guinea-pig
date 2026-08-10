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

Full diagnostic blocks are in `supabase/migrations/0012_…sql` under **BEFORE
APPLYING**. Run them and keep the output; the repair is only believable against
a before-figure. The short version:

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

## The fix — three parts, two of them done

1. **✅ The database owns the rule.** `supabase/migrations/0012` adds an
   `after delete` trigger on `provider_treatments` that strips the id from every
   slot that referenced it, plus a one-off repair of the existing dangling ids.
   A trigger, not client code: three writers can delete these rows (mobile, web
   `/shop`, admin) and putting the rule in three clients leaves it one client
   away from being wrong again, which is this bug's whole history.
   **Not applied yet — paste it into the SQL editor.**

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

## Still open

* **`chat/[sessionId].tsx:546`** — a locked chat should show its date whether or
  not the treatment resolves. Small, separate, and a real loss of information to
  the model.
* **Whether `sessions.treatment_id` should have a foreign key**, and which
  `on delete` behaviour. Answer Block D before deciding — adding a constraint to
  live data that currently violates it will simply fail.
* **The `apply-session.tsx:293` fallback should probably go**, once orphans stop
  being manufactured. It exists to paper over this bug, and what it does when it
  fires is over-offer treatments. But it must not be removed until the diagnostic
  says the data is clean, or it will start showing "no treatments" on real slots.
* **Nothing has been type-checking or linting mobile either.** `tsc --noEmit`
  reports 15 pre-existing errors across `_layout.tsx`, `leave-review.tsx` and
  `sessions.tsx`. None are from this change, and none were noticed.
