# Stylists can't find models on the web — and the app version shouldn't be ported as-is

_Written 14 Aug 2026. Its own item, not part of slice 3._

**A stylist who signs up on the web can't find a single model. They can publish a
shop and then wait, and that is the entire extent of it.** In the app they get a
searchable, filterable list of models near them and a button to invite one.

This is an **eighth** "requires the Cavy app" dependency. The seven in
`web-slice-3-progress.md` were all model-side or shop-setup; this one is
stylist-side and nobody had listed it.

For a college cohort it is arguably the worst of the eight. Thirty students
publish a shop, and then thirty students wait for strangers to arrive.

---

## What exists today

Mobile only, and not even a route of its own — a **"Nearby models"** strip at the
bottom of the provider dashboard.

| Piece | Where |
|---|---|
| Section, search box, filter panel | `mobile/src/app/(app)/provider-dashboard.tsx:1166–1257` |
| The fetch | `provider-dashboard.tsx:609` — `supabase.rpc('nearby_models', …)` |
| Client-side filtering | `provider-dashboard.tsx:1272–1281` |
| Model profile | `mobile/src/app/(app)/model/[id].tsx` — keyed by **auth user_id**, not a provider id |
| Invite | `provider-dashboard.tsx:783` — inserts a `stylist_invite` notification |

A stylist can filter by hair colour, hair type, hair length, skin tone, distance
and verified-only, then open a full profile: photo gallery, attributes, bio,
every review about that model, and a clickable Instagram handle.

The web has none of it. `site/` never calls `nearby_models`, and there is no
`/model/[id]` route — `site/lib/queries/dashboard.ts:271` says so in a comment:
`providerId: null, // a stylist's counterparty is a model; no profile route yet`.
A web stylist sees a model's name and photo only once that model has applied.

---

## Three things NOT to port

Verified against source, not assumed. These are the reasons this should be a
slice rather than a port.

### 1. Blocking is enforced in JavaScript only

`nearby_models` is `SECURITY DEFINER`, so it bypasses RLS entirely. Blocked users
are removed **in the client**, at `provider-dashboard.tsx:1273`:

```js
const filtered = nearbyModels.filter(m => {
  if (blockedIds.has(m.id)) return false
```

So the RPC still returns a blocked model, and `/(app)/model/[id]` is still
reachable by navigating straight to it — the block only removes them from one
list on one screen.

This matters more here than almost anywhere else in the product. The whole
argument for pulling the blocked-list forward in slice 3 was that *"a control you
cannot reverse is one people hesitate to use"*. A control that only hides someone
from one list has the same problem wearing a different hat. **The web's stylist
browse already does this properly** — `getBrowseStylists` filters server-side via
`getBlockedIds` — so the web would be regressing to reach parity.

### 2. Nothing gates it, including the caller's role

- No subscription, no verification, no fee, no `is_published` check.
- **No role check on the CALLER.** The RPC filters `u.role = 'model'` on the
  *target*. `grant execute … to authenticated` (`nearby-models-any.sql:81`) is
  the only access control, so any signed-in account — including a model — can
  call it and receive up to 200 model records with photos, attributes and (via
  `public_profiles`) Instagram handles.
- Suspended models are returned: `where u.role = 'model'` is the only predicate.

### 3. It is the highest-sensitivity object in the schema, by our own assessment

`supabase/schema-snapshot-2026-08-08.sql:305` says it outright:

> Reads users.latitude/longitude and returns distance_mi computed from
> CALLER-SUPPLIED coordinates. Varying them across calls trilaterates a model's
> real location. Combined with first name, photo and (via public_profiles) an
> Instagram handle, this is the highest-sensitivity object in the schema.

Caller-supplied coordinates are the problem: a caller can vary them freely and
triangulate. Nothing rate-limits or logs it.

And the attributes the filter is built on — hair type, skin tone — are the
**Article 9** question already flagged for the solicitor in
`site/content/legal.ts` §7. Building a second surface on them before that answer
comes back widens the exposure rather than holding it steady.

---

## What building it would need

Not a port. Roughly:

1. **A server-side blocked filter**, the way `getBrowseStylists` already does it.
   Non-negotiable, and it should be fixed on mobile too rather than left as the
   web being stricter than the app.
2. **A caller role gate.** Only providers should be discovering models. Cleanest
   is a new RPC that checks the caller, leaving `nearby_models` alone until
   mobile can move.
3. **Exclude suspended and deleted accounts.**
4. **Decide about distance at all.** The web has no coordinates for a web-only
   signup — the same constraint that made stylist browse text-based. The
   trilateration risk disappears if the web version never accepts caller
   coordinates, and a `location_text` match may be enough, exactly as it was for
   browse.
5. **Decide whether attribute filters ship at all** before the Article 9 answer.
   Distance and verified-only may be enough for a first version.
6. **A `/model/[id]` route**, with the same blocked check, and a decision about
   the Instagram handle — it is currently shown to any authenticated viewer.

---

## Recommendation

Do it, after the current slice, as its own piece — and treat item 1 as a bug fix
against **mobile** that lands first, independent of any web work. Client-side-only
block enforcement is live today and the web being built correctly does not fix
the app.

Not urgent for slice 3, which is about the stylist getting set up. It becomes
urgent the moment a cohort is onboarded, because that is the point at which
thirty stylists have working shops and no way to find anybody.
