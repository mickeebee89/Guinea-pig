# Cavy

**Hair & Beauty Models** — be the guinea pig, get the glow.

A UK marketplace connecting trainee and portfolio-building beauty stylists with people
willing to be practice models. Stylists get the experience and the photos; models get
the treatment free or discounted. Cavy never handles payment for a treatment — cost is
agreed between the two people in chat and settled in person.

> **Cavy is a trading name of Guinea Pig App Ltd, registered in England & Wales,
> company no. [NUMBER].** The git repo, the local folder and the `guineapigapp.co.uk`
> domain keep the original name deliberately.

## What's in here

| Path | What it is |
|---|---|
| `mobile/` | The app — React Native / Expo (SDK 56), Expo Router, EAS. Android-first, iOS planned. |
| `app/`, `components/`, `lib/` | Admin console — Next.js 16 App Router, deployed on Vercel. Access is gated by a row in the `admins` table, enforced server-side by `proxy.ts`. |
| `supabase/` | Edge functions and the SQL that isn't in a migration — RLS policies, triggers, RPCs. |
| `seed/` | Demo data for store screenshots, plus teardown. See `seed/README.md`. |
| `scripts/` | `check-queries.mjs` validates every Supabase `.select()` against the live schema. |
| `web/` | Static password-reset and email-confirmation pages hosted on the marketing site. |

Backend is Supabase (Postgres, auth, storage, realtime). Payments are Stripe. Images go
through Cloudinary, transactional email through Resend, push through Expo.

## Running it

**Admin console**

```bash
npm install
npm run dev            # http://localhost:3000
```

**Mobile** — needs a dev client installed on the device, not Expo Go:

```bash
cd mobile
npx expo start -c --dev-client
```

Always pass `-c`. A stale Metro bundle will happily serve you the previous build and
make a working fix look broken.

**Deploy an edge function** — from the repo root:

```bash
npx supabase functions deploy <name>
```

The "Docker not running" warning is harmless.

## Before changing anything

`CLAUDE.md` holds the durable context: schema truths that differ from what you'd guess
(bookings live in `sessions`, there is no `profiles` table, `public.users` has no FK to
`auth.users`), the RLS conventions, and the payment/verification flows. Read it first —
several of those have caused real bugs.

## Environment

Neither app reads secrets from the repo. `mobile/.env` and `.env.local` hold the
Supabase URL, anon key and Stripe publishable key; the service-role key is only ever
set in a shell for the duration of a script run.
