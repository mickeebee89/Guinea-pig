# Cavy Web — Phase 2: Full Parity

> **Status: SCOPING. Nothing built.**
> Read `web-phase-1-handover.md` first — its constraints and principles carry over unchanged,
> including **migrations-first for any schema change** and the chain that produced them.

---

## Context

Phase 1 shipped a public, unauthenticated marketing and SEO site at `cavybeauty.com`. Phase 2
makes the browser a **complete second front end**: sign up, sign in, browse, apply, book,
message, pay, review, manage a provider profile. Same Supabase project, same accounts — someone
who signs up on web signs into the app with those credentials and back again.

**A second front end, not a second product.** The point is removing the install barrier on both
sides: a model shouldn't need an app store to book a treatment, and a course leader should be
able to sign a cohort up on a laptop.

### What actually exists to work from

| | |
|---|---|
| Mobile app | **28 screens, ~19,700 lines of TSX** |
| Largest | `provider-dashboard` 2,092 · `model-profile` 1,998 · `chat/[sessionId]` 1,480 · `apply-session` 1,463 · `index` 1,343 · `settings` 1,206 |
| Realtime | **3 subscription sites** — chat, message list, header unread badge. All `postgres_changes`. |
| Native APIs | haptics (34 files), image-picker (6), image (6), location (2), notifications (2), secure-store (1), Stripe RN (3) |
| Web site | `site/` — Next 16, static, anon client, no cookies |

---

## The seven decisions

### 1. The static/dynamic split — the one that must be right

**One app in `site/`. Route groups. A `proxy.ts` with an ALLOWLIST matcher, never a catch-all.**

Phase 1's SEO surface is static: anon client, no cookies, `revalidate`. Auth needs
`@supabase/ssr` and cookie sessions, and **any route that reads cookies becomes dynamic.** The
failure mode is not subtle — it is exactly what broke the first two phase-1 deploys, when the
admin console's catch-all `proxy.ts` was compiled into the public site and would have put a
login wall in front of every page.

```
site/app/
  (public)/        ← static. anon client. NEVER reads cookies.
      page.tsx · [treatment] · terms · privacy · community · delete-account
  (auth)/          ← dynamic. sign-in, sign-up, reset, confirm callback
  (app)/           ← dynamic. everything behind a session
      layout.tsx   ← THE GATE: server component, reads session, redirects
      dashboard · sessions · messages · chat/[id] · apply/[providerId] · profile · shop · …
```

Two mechanisms, deliberately separated:

- **`(app)/layout.tsx` is the auth gate.** A server component that reads the session and
  redirects when absent. Forgetting to add a route here means it sits outside the group, which
  is visible in the file tree.
- **`proxy.ts` only refreshes the session cookie**, with a matcher that lists `(app)` and
  `(auth)` paths explicitly. **Never a catch-all with exclusions.** If someone forgets to add a
  path, the cost is a stale token, not an auth bypass — the failure lands on the safe side.

**Two Supabase clients, named so misuse is obvious:**

| Module | Client | Used by |
|---|---|---|
| `lib/supabase-public.ts` | `createClient`, `persistSession: false` | `(public)` only |
| `lib/supabase-server.ts` | `@supabase/ssr` `createServerClient` | `(app)`, `(auth)` only |

Phase 1's unprefixed `SUPABASE_ANON_KEY` trick stays and extends: the public key remains
unreachable from Client Components, so a public page cannot accidentally become a client-side
query. Add a build check that fails if `(public)/**` imports `supabase-server`.

**Rejected:** a separate `app.cavybeauty.com` deployment. Cleaner isolation, but it duplicates
every shared component, splits the design system, and adds a cross-subdomain cookie story for a
problem route groups already solve.

**Verification, not assumption:** after the first authenticated route ships, `next build` must
still show `(public)` routes as `○ Static`. If any flips to `ƒ Dynamic`, cookie access has
leaked into the public half and SEO is silently broken.

### 2. The auth-URL migration — additive, never a cutover

Deferred through phase 1, now unavoidable. The **shipped app hardcodes** both callbacks:

- `SignupScreen.tsx:153` → `https://guineapigapp.co.uk/auth/confirmed`
- `ForgotPasswordScreen.tsx:53` → `https://guineapigapp.co.uk/auth/reset`

Those cannot change without an app release, and users on old versions never update.

**Do NOT redirect `/auth/*`.** A 301 on an auth callback is the one redirect that can lose the
credential: implicit-flow tokens arrive in the URL **fragment**, and fragment survival across
redirects is browser-dependent. Phase 1 deliberately scoped its 301s to three legal paths for
this reason. That stays true.

**Sequence — both live simultaneously:**

1. Add `https://cavybeauty.com/auth/**` to the Supabase redirect allowlist. **Additive.** Nothing
   breaks; the old URLs keep working.
2. Build `/auth/confirm` and `/auth/reset` on `cavybeauty.com` as real Next routes.
3. Web signup/reset use the new URLs from day one.
4. App release points its two constants at `cavybeauty.com`. Both hosts now work.
5. **Retire `guineapigapp.co.uk/auth/*` only when the old app version is out of use** — a
   telemetry question, not a calendar one.

Steps 1–3 are safe now. Steps 4–5 wait on an app release.

### 3. Stripe on web — margin changes, and Apple has opinions

Mobile pays Apple/Google **15–30%**. Web pays Stripe roughly **1.5% + 20p**. On a £4.99
subscription that is a difference of about £0.75–£1.50 per member per month.

Mechanically it is small: the `stripe-payment` edge function is **shared and unchanged**. Only
presentation differs — `@stripe/stripe-js` + Elements instead of `@stripe/stripe-react-native`'s
PaymentSheet. Three mobile files touch Stripe.

**The commercial and compliance questions are the real content, and I am flagging rather than
deciding:**

- **Price parity.** Same price on web = more margin. Cheaper on web = a steering incentive, and
  the app cannot mention it.
- **Apple anti-steering.** `CLAUDE.md` already records IAP as the #1 rejection risk, unresolved.
  Selling the subscription on web is *permitted*; **linking to it from inside the iOS app is the
  part that has historically drawn rejections**, and the rules have moved recently and
  differently per jurisdiction. Worth asking App Review directly rather than inferring.
- **A web-only subscription weakens the IAP argument in both directions.** It proves the feature
  is consumable outside the app, which helps — and it makes the in-app unlock look more like a
  digital good, which hurts. Decide the posture before building, not after a rejection.

### 4. Realtime chat cross-platform — ports as-is

`supabase-js` realtime works in browsers unchanged. Three subscription sites, all
`postgres_changes` on `messages`, all reading through existing RLS (`participants can read
messages`). A message sent from web reaches an app user because both are the same rows and the
same channel.

**Nothing to design. Something to verify:** send from web, assert arrival on device without a
refresh, and back. That is a slice-2 acceptance test, not an architectural risk.

### 5. Notifications — email first, web push later

There is no native push on web. `send-push` targets Expo push tokens; `push_tokens` has no type
column.

- **Slice A — email via Resend.** Already configured and sending, zero new infrastructure. Covers
  the events that matter: new application, accepted, new message.
- **Slice B — Web Push (VAPID + service worker).** Real work: a new transport in `send-push`, a
  `push_tokens.kind` column (**migration**), and a service worker. Safari needs an installed PWA
  on iOS, so coverage is uneven.

Do A first. B is a genuine feature, not a parity gap to rush.

### 6. The exposure layer — a boundary, not a rewrite

Phase 1's `public_*` views exist for the **anon** half. The authenticated half reads base tables
through **exactly the same RLS the mobile app already uses** — same policies, same role, same
rows. So nothing about the exposure layer needs loosening for parity, and **no new anon exposure
is created by this phase.**

The risk is blurring, not exposure: using the server client on a public page (breaks static
rendering, and could leak), or the public client on an authenticated page (shows nothing, looks
like a bug). Handled by the two-client split in §1 plus the import check.

**One thing does need revisiting:** the ungranted `public_stylist_portfolio` and
`public_stylist_reviews` views. Authenticated web will render portfolios and reviews — through
RLS, not those views. Their grants stay off, and the §8 consent basis stays a phase-2 item for
the *public* site only. Do not let "web shows portfolios now" become an argument for granting
them to anon.

### 7. The consent gate — the same RPC, no parallel path

Web booking calls **`create_session_with_consent`**. Not a re-implementation, not two inserts.

The mobile gate renders from `consent_documents` and passes the id, version and content_hash it
actually displayed. Web does the same, sharing the document rather than the component. Two
booking paths that could record consent differently is precisely the divergence this project
already fixed once — hardcoded copy versus a document nobody rendered.

**This constrains the web design:** the browser gate must render from the document, fail closed
when none loads, tick per item, never pre-tick.

---

## What ports and what gets rebuilt

**Ports, essentially unchanged (~30–40% of the value, far less of the line count):**
every Supabase query and RPC call, all auth calls, realtime subscriptions, business rules
(pricing gates, verification gates, blocked/suspended handling), and the shared edge functions.

**Rebuilt — the UI:** `View`/`Text`/`StyleSheet` → HTML + Tailwind. The design tokens already
exist in `site/app/globals.css`, mirrored from `Colors.ts`, so the visual system carries over
even though no component does.

**Dropped or substituted:** haptics (no-op), `expo-image-picker` → `<input type="file">`,
`expo-location` → `navigator.geolocation`, `expo-secure-store` → cookies, `expo-notifications` →
§5, Stripe RN → Stripe.js.

**Not attempted:** `react-native-web` to reuse the mobile components. `@expo/ui` has no web
renderer, and phase 1 already chose a separate Next app over Expo web output.

---

## Phasing — each slice retires a risk before anything depends on it

**Slice 1 — Auth (smallest surface, biggest architectural risk)**
Sign up, sign in, reset, confirm callback, sign out, minimal profile.
*Proves:* the static/dynamic split holds and `(public)` stays `○ Static`.
*Delivers:* the course-leader scenario — a cohort signs up on laptops, then uses the app.
*Forces:* auth-URL migration steps 1–3, which must happen regardless.
**Ship-ready on its own.**

**Slice 2 — Read-only member area**
Sessions list, messages list, chat with realtime, notifications list, view profiles.
*Proves:* realtime cross-platform, and that authenticated reads need no new exposure.
*Delivers:* existing app users can use web for chat.

**Slice 3 — Booking**
Browse → apply → consent gate → `create_session_with_consent`.
*Depends on:* subscription and identity verification, which is the longest chain in the project
(camera capture in a browser is a real piece of work).
*Delivers:* the model-side install barrier actually removed.

**Slice 4 — Provider side**
Dashboard, availability, portfolio, shop editing, accept/decline.
*Largest by line count* — `provider-dashboard` alone is 2,092 lines.

**Slice 5 — Payments on web**
Subscription and verification fee via Stripe.js. Gated on the §3 decision, not on engineering.

**Why not big-bang:** slice 1 answers the question that invalidates everything else if wrong. If
the static/dynamic split cannot hold, that is better known after one week of auth work than after
four slices of member area built on top of it.

---

## Open questions before slice 1

1. **Does web signup need the same gates as mobile?** Age confirmation and terms acceptance are
   recorded in `auth.users` metadata by `SignupScreen`. Web must record them identically or the
   two paths produce different accounts.
2. **Onboarding parity.** `(onboarding)/profile-pic.tsx` runs after mobile signup. Does a
   web signup land in the same place, or defer it?
3. **Does a cohort sign-up need anything beyond normal signup** — an invite link, a shared code,
   a bulk path? "A course leader signs a cohort up" may imply a feature, not just a form.

---

## Verification, per slice

- `next build` shows every `(public)` route as `○ Static`. **Non-negotiable, checked every slice.**
- An account created on web signs into the app, and vice versa.
- A message sent on web arrives on device without a refresh.
- Booking on web produces a `session_consents` row with the version actually rendered.
- `/robots.txt` and `noindex` still behave — `PUBLIC_SITE_MODE` still gates indexing.
- No `(public)` page reads cookies; no `(app)` page uses the public client.
