# Demo mode — made-up data for screenshots

Local only. Audit item 69.

## Run it

From `site/`, in PowerShell. The two Supabase addresses are pointed at a dead
local port as a second safety net: if the demo wiring ever failed, a real call
would fail instead of reaching the live database.

```powershell
$env:DEMO_MODE = '1'; $env:SUPABASE_URL = 'http://127.0.0.1:9'; $env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'; npx next dev
```

For marketing images with the small "Example screen" label, set
`$env:DEMO_LABEL = '1'` as well, before `npx next dev`.

Then open http://localhost:3000/demo. Every link signs you in as the right
account first (model or stylist), then opens the screen.

To stop: Ctrl+C, then close the PowerShell window (the variables go with it).
Restarting the server resets any change you made to the data.

Demo mode builds into its own folder, `site/.next-demo/` (gitignored), so it
never mixes with a normal `next dev`. If pages ever 404 after switching,
delete that folder and start again.

## What it can't do

- **It can't touch the live database.** With `DEMO_MODE=1`, `next.config.ts`
  points `@supabase/ssr` and `@supabase/supabase-js` at `lib/demo/stub-*.ts`,
  which answer from `lib/demo/fixtures.ts` in memory. There is no network code
  in this folder.
- **It can't run in production.** `next build`, `next start`, and anything on
  Vercel refuse it: `next.config.ts` throws if `DEMO_MODE=1` is set with
  `NODE_ENV` not `development`, or with `VERCEL`/`VERCEL_ENV` set. Each stand-in
  refuses again when it loads (`lib/demo/guard.ts`). Without the flag, no file
  in the build imports anything from `lib/demo`, and `/demo` isn't a route.
- **Payments, sign-in, sign-up, email and uploads are switched off.** They
  return a plain "switched off in demo mode" error.

## Rules for the data (`fixtures.ts`)

- **No reviews, ratings or testimonials.** UK law bans fake reviews, and these
  screenshots are for advertising.
- **No photos of real people.** The pictures are the AI-generated set in
  `seed/photos/` (see `seed/README.md`).
- **Every person is invented**, with `.invalid` email addresses. The names
  match `seed/photos/`, so each face appears under the name it was made for.

## Photos

Read straight from `seed/photos/` (gitignored) by the demo-only
`/demo-photos` route. Nothing is copied into `public/`.

| Folder | Used as | Keys |
|---|---|---|
| `stylists/NN-<key>.png` | stylist profile picture | `priya`, `amelia`, `nadia`, `chloe`, `grace` |
| `portfolio/NN-<key>-N.png` | stylist portfolio | same |
| `models/NN-<key>.png` | model profile picture | `amara`, `sophie`, `leah`, `jess` |
| `gallery/NN-<key>-N.png` | model's own photos (model profile) | same |

`tia` (spray tan) and `ellie` (hair & makeup) have no photos, so they show
initials. To give them one, add e.g. `stylists/06-tia.png`, or drop a file in
`site/public/demo-images/avatars/<key>.jpg`, which takes priority for the
profile picture. Restart the dev server to pick up new files.
