# Cavy website (`cavybeauty.com`)

Public, unauthenticated marketing and SEO site. Separate Next 16 app, separate
Vercel project, same Supabase backend as the app and the admin console.

This is **not** part of the admin app at the repo root. It cannot be: `proxy.ts`
there matches every path with no allowlist and redirects anyone without an
`is_admin()` session to `/login`, so marketing routes in that tree would bounce
visitors and Googlebot alike. Route groups do not help — they do not appear in
the URL.

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
   **Root Directory = `site`**. Do not reuse the admin project.
2. Set the three environment variables above. `PUBLIC_SITE_MODE=preview` until
   step 6.
3. Set **Ignored Build Step** on *both* projects so a push touching only
   `site/` does not rebuild the admin app, and vice versa. Today every push to
   `main` rebuilds everything.
4. **Domain**: add `cavybeauty.com` and `www.cavybeauty.com`. Set the **apex as
   primary**; `www` 301s to it. DNS is at Cloudflare Registrar, whose CNAME
   flattening removes the usual technical objection to an apex primary.
5. **Run the seed teardown** — `node seed/teardown.mjs` from the repo root.
   Demo stylists must not be indexed. The view already excludes them via the
   reserved `.invalid` TLD, so this is belt and braces, but do it anyway.
6. Flip `PUBLIC_SITE_MODE=live` and redeploy. Submit `/sitemap.xml` in Search
   Console.
7. **Legal 301s** on `guineapigapp.co.uk`, path-scoped to exactly three paths:
   `/terms`, `/privacy`, `/community` → the same path on `cavybeauty.com`.
   The shipped mobile app hardcodes those URLs, so following the redirect means
   no app release is needed.

   **Do not touch `/auth/reset` or `/auth/confirmed`.** They are registered in
   Supabase Auth → URL Configuration and are a separately sequenced migration.
   Redirecting them breaks password reset in the live app.

### After deploy

- Rate limiting in `lib/rateLimit.ts` is per-instance memory and resets on cold
  start. Add a **Vercel Firewall** rule on `/api/waitlist` as the real control.
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
