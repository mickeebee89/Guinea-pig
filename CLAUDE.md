# Cavy — Project Context

> **Brand:** the app is **Cavy** (App Store subtitle "Hair & Beauty Models", tagline
> "Be the guinea pig, get the glow."). **The legal entity is unchanged — Guinea Pig
> App Ltd.** Cavy is a trading name, so Terms, Privacy, the data controller and any
> company details must still read *"Cavy is a trading name of Guinea Pig App Ltd,
> registered in England & Wales, company no. [NUMBER]."*
>
> The git repo, the local folder path and the `guineapigapp.co.uk` domain all keep
> the old name on purpose — renaming them buys nothing and breaks links. The tagline
> keeps the phrase "guinea pig" deliberately, and the mascot is still a guinea pig
> (a cavy *is* a guinea pig). So never blanket find-and-replace this repo.

_This file is read automatically at the start of every Claude Code session. It holds durable context only — how I work, the stack, identifiers, and schema truths. Session state (what's done, what's next) lives in chat, not here._

---

## How to work with me

- **Be a root-cause-first coder.** Fix the first cause in a chain, not the symptom. If something needs a pivot, pivot — don't tinker. Aim for elegant code.
- **Format:** terse, numbered, **copy-paste-ready** command/SQL blocks. One task at a time. Minimal forward-planning — don't stack five future steps.
- **Plain English, always.** Explain in plain language; the first time a technical term comes up, define it in a few words. When reporting a bug, lead with one plain sentence saying what breaks for the user — then the technical detail.
- **When I have a choice to make, lay the options out as a short numbered list** so I can pick one.
- **Always remind me to add haptic feedback** when we build a new screen or interaction.
- **Recurring trap — stale Metro bundles mask fixes.** After ANY mobile change, reload with `npx expo start -c --dev-client` before concluding a fix failed. Never declare a fix broken off a stale bundle.
- Prefer **plan mode** for anything non-trivial: investigate the repo read-only, show me the plan, let me approve, then build.

## Stack & paths

- **Mobile:** React Native / Expo (Android-first, iOS planned), Expo Router, EAS. Runs via Metro tunnel on my phone.
- **Backend:** Supabase (Postgres / auth / storage / realtime), project `ptluekkhiopowuyvkgnd`.
- **Admin:** Next.js 16.2.7 / Vercel (App Router, Turbopack).
- **Payments:** Stripe (currently TEST mode). **Media:** Cloudinary. **Email:** Resend.
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
- **Palette:** gold `#C2A14D`, blush/softPink `#F4DADC`, off-white `#FBF6F1`, warmDark `#3A302C`, pinkVibrant `#F45D9E`, roseDark `#A8862E`.

## Schema anchors (verified against live DB)

- Bookings are `sessions` (**not** `bookings`). Model in a session = `model_user_id` (a `model_id` col also exists). Provider owner = `providers.user_id`; session → provider via `provider_id` → `providers.id`. All are `auth.users` ids.
- **`public.users` has NO FK to `auth.users`.** Deleting the auth user does NOT cascade `public.users` — delete it explicitly. CASCADE-from-users children hang off `public.users`.
- **`blocks`** table: `blocker_id`, `blocked_id` (both FK users, ON DELETE CASCADE), unique on the pair. Mutual block = either direction.
- Messages: body column is **`messages.body`** (not `content`). British spelling: **`colour_hex`**. There is **no `profiles` table**. Admin status lives in the **`admins`** table. Model profile data lives in **`model_attributes`**.
- **RLS:** use the `authenticated` role. RESTRICTIVE policies AND with permissive ones — a RESTRICTIVE INSERT still needs a matching permissive INSERT to exist. `public_profiles` is the usual path for cross-user reads if users RLS blocks a direct read.

## Payments / pricing (TEST mode — swap to LIVE before launch)

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
