# Guinea Pig — Project Context

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
- **Repo root (Windows):** `C:\Users\micky\Documents\Guinea-pig` (admin app). Mobile lives in `mobile\`.
- **Run mobile:** `cd C:\Users\micky\Documents\Guinea-pig\mobile` then `npx expo start -c --dev-client`.
- **Deploy an edge function:** from repo ROOT, `npx supabase functions deploy <name>` (the "Docker not running" warning is harmless).

## Key identifiers

- **Admin / provider "Micky B":** user_id `ff06d568-8936-45fa-ad5f-0b88c150ec30` (micky.buckfield@gmail.com); `providers.id` `49d40aae-a830-41d1-bca8-0fbdb2695455`.
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
- Both flows are **PAY-FIRST:** Get Verified → pay → selfie → admin approves → unlock.
  - Provider unlock = `is_verified` + `is_published`.
  - Model = active subscription AND identity verification, both required to apply (browsing is free).
- Admin `approve()` unlocks unconditionally (free-account override).
- Test card: `4242 4242 4242 4242`, exp `12/34`, CVC `123`.

---

_Not in this file on purpose: session progress, the compliance "RED" gate status, and the launch checklist. Those change constantly and are tracked in chat / the handover doc, so they don't belong in persistent context._
