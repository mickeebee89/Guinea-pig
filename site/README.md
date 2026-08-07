# Cavy website (`cavybeauty.com`)

Public, unauthenticated marketing and SEO site. Separate Next 16 app, separate
Vercel project, same Supabase backend as the app and the admin console.

This is **not** part of the admin console, and must never become part of it:
`admin/proxy.ts` matches every path with no allowlist and redirects anyone
without an `is_admin()` session to `/login`, so marketing routes in that tree
would bounce visitors and Googlebot alike. Route groups do not help — they do
not appear in the URL.

That is not hypothetical. The admin app used to live at the repo root, and the
first two Vercel deploys of this site failed compiling `proxy.ts` into it —
Turbopack resolved the repo root as the build root and found the file. The
build only failed because `@supabase/ssr` is not a dependency here. Had it
resolved, this site would have shipped with an auth wall in front of every
page. The admin app moved to `admin/` on 7 Aug 2026 so there is no longer an
app above this one to reach.

## Local

```bash
npm install --prefix site
cp site/.env.local.example site/.env.local   # then fill in SUPABASE_ANON_KEY
npm run dev --prefix site -- -p 3001
```

Port 3000 is usually taken by the admin app.

## Environment

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | `https://ptluekkhiopowuyvkgnd.supabase.co` |
| `SUPABASE_ANON_KEY` | Publishable key. **No `NEXT_PUBLIC_` prefix on purpose** — see below. |
| `PUBLIC_SITE_MODE` | `live` enables indexing. Anything else = `noindex` + empty sitemap. |

The anon key is public by design, so the missing `NEXT_PUBLIC_` prefix is not a
security boundary — it is a forcing function. Unprefixed, the key is unreachable
from Client Components, which makes it impossible to accidentally write a
client-side query that bypasses the ISR cache, breaks SEO for that content, and
hits Supabase once per visitor instead of once per revalidate window.

## Data

Every read goes through the `public_*` views created by
[`../supabase/public-web-views.sql`](../supabase/public-web-views.sql). Base
tables return zero rows to `anon` and must stay that way.

Granted to `anon`: `public_stylists`, `public_categories`.
Written but **ungranted**: `public_stylist_portfolio`, `public_stylist_reviews`
— both need a public-display consent document version first.

`lib/stylists.ts` is the only place stylists are read. Every failure mode —
missing view, RLS refusal, network error, empty result — degrades to an empty
list plus a server-log warning, never a thrown error. Pre-launch, empty is the
correct answer.

## Deployment (Vercel)

Not yet done. Steps, in order:

1. **New Vercel project** pointed at `github.com/mickeebee89/Guinea-pig`, with
   **Root Directory = `site`**, and **"Include files outside of the Root
   Directory in the Build Step" turned OFF.**

   > **Leave that toggle off. It is not a workaround.**
   >
   > It was first turned off to fix a real failure: while the admin console
   > lived at the repo root, Turbopack resolved the repo root as this app's
   > build root, found `proxy.ts` there, and compiled the admin auth gate into
   > this site. Two deploys failed on it, and they only failed because
   > `@supabase/ssr` is not a dependency here — had it resolved, every page of
   > this site would have shipped behind a login wall.
   >
   > The admin app moved to `admin/` on 7 Aug 2026, so that specific hazard is
   > gone and the toggle *could* technically go back to its default. Do not.
   > Off is simply the correct setting for an app in a subdirectory: the build
   > context is only `site/`, so uploads are smaller, builds are faster, and
   > the build cannot reach a sibling app's files by accident. Turning it on
   > gains nothing and points Vercel's tracing root at a repo root that has no
   > `package.json` at all.

2. Set the three environment variables above. **`PUBLIC_SITE_MODE=preview`** —
   see step 5 for when that changes.

3. **Ignored Build Step** — on this project only. The admin console at the repo
   root has never been deployed anywhere; it runs locally via `npm run dev`.
   There is no second Vercel project to configure.

   ```
   [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- ':(top)site'
   ```

   Still worth setting even as the only project: without it, every push
   touching `mobile/`, `seed/`, `supabase/` or the admin app burns a build.

   Exit 0 skips the build, non-zero builds. Notes on why it is written this way:
   - **`VERCEL_GIT_PREVIOUS_SHA`, never `HEAD^`.** `HEAD^` is the previous
     *commit*, which is wrong after a squash-merge or a force-push and would
     silently skip a build that should have run. This variable is the last
     successfully deployed commit, which is the real question being asked.
   - **`:(top)` makes the pathspec repo-root-relative**, so it behaves the same
     whether Vercel runs the command from the repo root or from the Root
     Directory.
   - **The `-n` guard fails toward building.** Empty on a first deploy → exit 1
     → build. A SHA missing from Vercel's shallow clone → git exits 128 → build.
     It can never fail into skipping.

4. **Domain**: add `cavybeauty.com` and `www.cavybeauty.com`. Set the **apex as
   primary**; `www` 301s to it. DNS is at Cloudflare Registrar, whose CNAME
   flattening removes the usual technical objection to an apex primary.

5. **Legal 301s** on `guineapigapp.co.uk` as soon as the domain resolves.
   Path-scoped to exactly three paths: `/terms`, `/privacy`, `/community` → the
   same path on `cavybeauty.com`. The shipped mobile app hardcodes those URLs,
   so following the redirect means no app release is needed.

   These are a **store-submission dependency**, so they ship before indexing.

   **Do not touch `/auth/reset` or `/auth/confirmed`.** They are registered in
   Supabase Auth → URL Configuration and are a separately sequenced migration.
   Redirecting them breaks password reset in the live app.

6. **`PUBLIC_SITE_MODE=live` — LAST, and gated on inventory, not on the domain
   resolving.**

   The seed teardown (done 7 Aug 2026) means no demo stylist can ever be
   indexed. That is a *necessary* condition, not a sufficient one. Today
   `public_stylists` returns **zero rows**, so flipping now would submit a
   sitemap of empty pages from a brand-new domain — a thin-content signal that
   is slow and awkward to undo, and it would be spent on the one asset whose
   value comes from being trusted early.

   Flip it when there are real published stylists clearing the content bar in
   `public_stylists` (published, 40+ character bio, at least one category).
   Then redeploy and submit `/sitemap.xml` in Search Console. Index the six
   national treatment pages first; city pages in tranches after that.

### Two things to know about the Hobby plan

- **The Vercel Firewall / WAF is not on Hobby.** So the per-instance limiter in
  `lib/rateLimit.ts` is the *only* control on `/api/waitlist`, not the second
  layer it was meant to be. It resets on cold start and an attacker spread
  across warm instances gets a multiple of the limit. If abuse shows up, the
  options are a Pro plan for the Firewall, a shared counter in Upstash/Vercel
  KV, or putting Cloudflare in front (the DNS is already there, and Cloudflare
  rate-limiting rules work on its free tier).

- **Hobby is licensed for non-commercial use.** Cavy charges for a model
  subscription and a stylist verification fee, so a marketing site for it is
  arguably commercial even though the site itself sells nothing. Vercel does
  enforce this, and enforcement means the site goes down. Worth resolving
  before pointing the real domain at it rather than after.

### After deploy
- The waitlist edge function's CORS allowlist still contains only the
  `guineapigapp.co.uk` origins. That is fine — `/api/waitlist` proxies
  server-side, so no `Origin` header is sent and CORS never applies. Do not
  "fix" it by calling the function from the browser.

## Indexing

`PUBLIC_SITE_MODE` gates three things together: `robots.ts` disallows
everything, `sitemap.ts` returns `[]`, and the root layout emits
`noindex, nofollow`. Vercel preview deployments must never be `live`.

City pages (`CITIES` in `lib/site.ts`) are built but **not routed**. Six
treatments × N cities of near-identical pages on a new domain is the doorway
pattern that earns a site-wide penalty. Turn them on in tranches once there is
real inventory.

## Conventions

- **Copy uses the app's words**: "stylist" and "model". Never "provider" —
  that is the database term.
- **Legal text lives in `content/legal.ts`.** It is transcribed from the live
  pages and the three edits made are documented in that file's header. Do not
  paraphrase it.
- **Palette mirrors `mobile/src/constants/Colors.ts`** (`#DB4B86` rose). Two
  other palettes exist in this repo and are both stale — see the comment in
  `app/globals.css`.
- **Phone first.** Tap targets ≥44px, no horizontal overflow at 375px, mobile
  keyboard hints on every input.
