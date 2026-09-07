# Cavy — Project Context

> **Brand:** the app is **Cavy** (App Store subtitle "Hair & Beauty Models", tagline
> "Be the guinea pig, get the glow."). **The legal entity is unchanged — Guinea Pig
> App Ltd.** Cavy is a trading name, so Terms, Privacy, the data controller and any
> company details must still read *"Cavy is a trading name of Guinea Pig App Ltd,
> registered in England & Wales, company no. 17272796."*
>
> The git repo, the local folder path and the `guineapigapp.co.uk` domain all keep
> the old name on purpose — renaming them buys nothing and breaks links. The tagline
> keeps the phrase "guinea pig" deliberately, and the mascot is still a guinea pig
> (a cavy *is* a guinea pig). So never blanket find-and-replace this repo.

**Where things stand right now — what blocks launch, what does not, what is dated — is in `HANDOVER.md` at the repo root.** This file holds only what does not change.

_This file is read automatically at the start of every Claude Code session. It holds durable context only — how I work, the stack, identifiers, and schema truths. Session state (what's done, what's next) lives in chat, not here._

---

## How to work with me

- **Be a root-cause-first coder.** Fix the first cause in a chain, not the symptom. If something needs a pivot, pivot — don't tinker. Aim for elegant code.
- **Format:** terse, numbered, **copy-paste-ready** command/SQL blocks. One task at a time. Minimal forward-planning — don't stack five future steps.
- **Plain English, always.** Explain in plain language; the first time a technical term comes up, define it in a few words. When reporting a bug, lead with one plain sentence saying what breaks for the user — then the technical detail.
- **When I have a choice to make, lay the options out as a short numbered list** so I can pick one.
- **Always remind me to add haptic feedback** when we build a new screen or interaction **in `mobile/`**. Not on web: `navigator.vibrate` doesn't exist on iOS Safari at all and is a no-op on desktop, so it only ever reaches Android mobile-web — and a buzz nobody asked for isn't what "the web works without the app" means. Web haptics were added to `/shop` on 12 Aug and removed on 14 Aug for exactly this reason. The rule was written for expo-haptics, where the platform makes it real.
- **Recurring trap — stale Metro bundles mask fixes.** After ANY mobile change, reload with `npx expo start -c --dev-client` before concluding a fix failed. Never declare a fix broken off a stale bundle.
- Prefer **plan mode** for anything non-trivial: investigate the repo read-only, show me the plan, let me approve, then build.

## Stack & paths

- **Mobile:** React Native / Expo (Android-first, iOS planned), Expo Router, EAS. Runs via Metro tunnel on my phone.
- **Backend:** Supabase (Postgres / auth / storage / realtime), project `ptluekkhiopowuyvkgnd`.
- **Admin:** Next.js 16.2.7 / Vercel (App Router, Turbopack).
- **Payments:** Stripe — **LIVE since 17 Jul 2026, not TEST.** Real cards are
  charged. The test card below only works against a client deliberately pointed
  at test keys. This line said TEST until 24 Aug 2026, which is exactly how
  someone ends up exercising a card flow against real money.
- **Media:** Supabase Storage — buckets `profile-pics`, `model-photos`,
  `portfolio-photos`, `verification-selfies`. Cloudinary is named in older notes
  and is called by no code in any of the three apps.
- **Email:** Supabase Auth SMTP via Resend, sending from
  `no-reply@guineapigapp.co.uk` — not yet moved to cavybeauty.com.
- **Repo:** github.com/mickeebee89/Guinea-pig — commit direct to `main`.
- **Repo root (Windows):** `C:\Users\micky\Documents\Guinea-pig` — **no app lives at the root.**
  Three sibling apps: `admin\` (Next.js console), `site\` (public website), `mobile\` (Expo).
  Each has its own `package.json` and `node_modules`; there is no workspace linkage.
  The admin app moved out of the root on 7 Aug 2026 — while it sat there, its `proxy.ts`
  auth gate was being compiled into the site's build and nearly shipped a login wall on
  the public website.
- **Run mobile:** `cd C:\Users\micky\Documents\Guinea-pig\mobile` then `npx expo start -c --dev-client`.
- **Deploy an edge function:** from repo ROOT, `npx supabase functions deploy <name>` (the "Docker not running" warning is harmless).

## Key identifiers

- **Admin access = a row in the `admins` table** (keyed to the immutable `auth.users.id`); enforced server-side by `proxy.ts` (`is_admin()` on every route) + RLS. **Two admins:** a **dedicated console-only admin on a separate email (primary, added 17 Jul)** that is NEVER an app user — so app-side changes can't affect admin login — plus **Micky B `ff06d568…` as break-glass backup**. Never sign the dedicated admin into the mobile app; never delete its auth user (`admins.user_id` cascades).
- **"Micky B" (provider/app + backup admin):** user_id `ff06d568-8936-45fa-ad5f-0b88c150ec30` (micky.buckfield@gmail.com); `providers.id` `49d40aae-a830-41d1-bca8-0fbdb2695455`.
- **Model test acct:** `b0df9c2f-02c5-4fef-afb0-9b184c3b9130` (micky.buckfield@hotmail.co.uk — subscribed + verified).
- **Provider test acct** `nahitih259@bevriz.com`: user_id `517c2853-50bb-4e8f-87fe-d79311bc37c0`.
- **Palette — `mobile/src/constants/Colors.ts` is canonical, read it rather than
  trusting this list.** This file carried the pre-restyle GOLD palette until
  24 Aug 2026, in which `roseDark` was a gold (`#A8862E`) — every value was
  wrong, so anyone following it built gold UI into a pink app. Current: rose
  `#DB4B86`, roseDark `#C23A71`, softPink `#FFE3EF`, pinkVibrant `#DB4B86`,
  cream `#FFF7FA`, warmDark `#2B2531`, muted `#6E6675`, inputBg `#FFF0F6`,
  border `#F6E1EA`.

## Schema anchors (verified against live DB)

- **The word boundary: user-facing text says "booking", the data layer says `sessions`, and the query layer is where they meet.** Above it (URLs, nav, headings, copy) it is a booking; below it (tables, RPCs, RLS) it is a session. The web route was renamed `/sessions` → `/bookings` on 2 Sep 2026 with a permanent redirect; the path is the constant `BOOKINGS_PATH` in `site/lib/routes.ts` and every call site imports it, because two of the five call sites were `revalidatePath()` and a missed one serves stale data silently rather than 404ing. **Mobile still routes to `/(app)/sessions` and should be left that way** — that is an Expo Router path inside the app binary, nothing links between the two, and renaming it would be churn with a chance of breaking a `router.push`. The two clients use different words for the same screen on purpose.
- Bookings are `sessions` (**not** `bookings`). Model in a session = `model_user_id` (a `model_id` col also exists). Provider owner = `providers.user_id`; session → provider via `provider_id` → `providers.id`. All are `auth.users` ids.
- **`public.users.id` → `auth.users(id)`, `ON DELETE NO ACTION`** (migration `0003`, 8 Aug 2026). Deleting the auth user does NOT cascade `public.users` — **delete the profile row first, or the auth delete is refused.** `delete_account_data` and `teardown.mjs` both already do. NO ACTION rather than CASCADE deliberately: cascading would reach seven FKs into `public.users`, two of them moderation evidence. CASCADE-from-users children hang off `public.users`.
- **Reports survive account deletion, de-identified** (migration `0004`). `reports.reporter_id`/`reported_id`/`session_id` are `ON DELETE SET NULL`; the durable identity is `reported_name` + `reported_email_hash` (SHA-256, also the ban-evasion signal). `reports` is append-only for 6 years (`0006`), purged by `run_retention_purge` (`0005`, monthly cron `retention-purge`). **Do not add a `reports` delete to any cleanup script** — it will be refused.
- **Retention is enforced, not just promised.** Consents, moderation actions and reports are all deleted at 6 years by `run_retention_purge`; every run is recorded in `retention_runs` and surfaced on the admin dashboard. `cavybeauty.com/delete-account` states that period, so removing the job makes a published policy false.
- **`blocks`** table: `blocker_id`, `blocked_id` (both FK users, ON DELETE CASCADE), unique on the pair. Mutual block = either direction.
- Messages: body column is **`messages.body`** (not `content`). British spelling: **`colour_hex`**. There is **no `profiles` table**. Admin status lives in the **`admins`** table. Model profile data lives in **`model_attributes`**.
- **Subscriptions.** `users.subscription_status` is CHECK-constrained to **`none | trialling | active | cancelled | cancelling`** (British spelling). `'none'` means no subscription — **NOT `'free'`**, which the code wrote unchecked for weeks and which the constraint rejects. `subscriptions.status` is a different column with a different vocabulary and does permit `expired`. **Never write either table directly: call `apply_subscription_state(...)`**, which writes both in one transaction so they cannot disagree (migrations `0023`–`0025`). This was already documented in `mobile/notes.md` and was not found there; it is repeated here because this file is the one that is actually read at the start of a session.
- **RLS:** use the `authenticated` role. RESTRICTIVE policies AND with permissive ones — a RESTRICTIVE INSERT still needs a matching permissive INSERT to exist. `public_profiles` is the usual path for cross-user reads if users RLS blocks a direct read.

## Payments / pricing (**LIVE since 17 Jul 2026** — real cards are charged)

- Provider: **£14.99 one-off** verification (first 100–200 free — "Founding Providers"). Model: **£4.99/mo** subscription.
- **Provider is PAY-FIRST:** Get Verified → pay £14.99 → selfie → admin approves → unlock (`is_verified` + `is_published`). Provider entry points: provider-dashboard + settings.
- **Model has NO standalone verification entry.** Browsing/search is FREE and open (no gate). The £4.99/mo subscribe **and** the identity selfie happen together **only at apply-time** (apply-gate in `apply-session.tsx`: subscribe-first → selfie). Model needs active subscription AND identity verification to apply. (The old model "Get verified" buttons were removed — they created stranded verified-but-unsubscribed accounts.)
- Admin `approve()` unlocks unconditionally (free-account override).
- Test card: `4242 4242 4242 4242`, exp `12/34`, CVC `123`.

---

## App Store / Play compliance (rules to audit against)

Durable store requirements this app must meet. **Live pass/fail status lives in the handover doc, not here** — this is the rulebook + where each is handled, so "does it comply?" can be checked against the code.

- **In-app account deletion** (Apple 5.1.1(v), Play) — required for any app with accounts. → `delete-account` edge function + Settings → Delete account (`settings.tsx`).
- **UGC safety** (Apple Guideline 1.2, Play UGC policy) — apps with user-generated content need ALL of: (a) **block** abusive users, (b) **report** content/users, (c) **moderation** / act on reports, (d) a **consent/EULA**. → block + report in chat (`blocks` table + mutual-block filtering across surfaces), `admins` moderation, per-application `ConsentGate`.
- **Age gate + terms acceptance** at signup — 18+ confirmation AND agree-to-Terms/Privacy, both required to create an account. → two required checkboxes in `src/screens/auth/SignupScreen.tsx` (records `age_confirmed` + `terms_accepted` in `auth.users` metadata). NB signup renders `src/screens/auth/*` via `AppEntry`, not `app/(auth)/*`.
- **iOS permission usage strings** — camera, photo-library, location need Info.plist descriptions. → `app.json` via the `expo-image-picker` + `expo-location` plugins.
- **Privacy** — a working Privacy Policy + data-collection disclosure (Apple privacy labels / Play Data Safety). Identity selfies = special-category data (needs a retention policy + UK ICO registration). Legal links in `settings.tsx` → `guineapigapp.co.uk/{terms,privacy,community}` (those pages must actually serve live content).
- **⚠️ IAP — the #1 rejection risk (UNRESOLVED).** Apple requires **in-app purchase** for digital subscriptions/unlocks consumed *in the app*. The model **£4.99/mo sub** and provider **verification fee** use **Stripe** and unlock in-app features (apply / publish) — a grey zone: Apple permits external payment only for real-world goods/services consumed *outside* the app (the beauty treatment qualifies; the in-app digital unlock may not). **Decide before iOS submit — consider asking Apple App Review directly.** Play is more lenient but confirm.
- **Login:** email/password only (no third-party social login) → Sign in with Apple not required.

---

_Not in this file on purpose: session progress, the compliance "RED" gate status, and the launch checklist. Those change constantly and are tracked in chat / the handover doc, so they don't belong in persistent context._
