# If the public site goes dark

_Written 7 Sep 2026, before `0034` — while `PUBLIC_SITE_MODE` is preview and
nothing is deployed, so the blast radius is the smallest it will ever be. That
is the right moment to write a recovery down, not the moment to skip it._

**The failure this covers:** `public_stylists` (or `public_stylist_status`) loses
its grant to `anon`. The likeliest cause is a `drop view` + `create view` without
reissuing — `create or replace view` cannot drop a column, so any change that
removes one forces the drop, and **a dropped view does not keep its grants.**

---

## What breaks

Seven pages, one query path (`site/lib/stylists.ts`):

| Page | Reads via | ISR window |
|---|---|---|
| `/` | `FeaturedStylists`, `countByCategory` | `revalidate = 3600` |
| `/hair-models` and the other five | `stylistsByCategory`, `countByCategory` | `revalidate = 900` |

**Not** `/stylist/[id]` — that is behind auth and reads base tables directly. A
public `/stylist/[slug]` is phase 2 and does not exist yet.

---

## Why nobody would notice

Two reasons, and they compound.

**1. It does not error.** `lib/stylists.ts` wraps every query: on failure it logs
`query failed, returning none` and returns `[]`. The pages render **200 with
their empty state**. No 500, no error page, no alert.

**2. That empty state is what they render today anyway.** The six treatment
pages are already empty for an unrelated reason — `public_stylists` requires a
40-character bio and the one published stylist has 13 (audit item 11). So the
broken state and the current correct state are **byte-for-byte identical**.

The only signal is a `console.warn` in the server log — Vercel function logs, or
the dev server's stdout. Nothing surfaces it.

**And it is not immediate.** Statically generated with ISR, so cached pages keep
serving correct content until their window lapses — up to 15 minutes for a
treatment page, up to an hour for the homepage. A deploy regenerates at build
time and makes it instant. So "it looked fine after I ran the migration" means
nothing for the first 15 minutes.

---

## Recovery — one statement, no deploy

```sql
grant select on public.public_stylists to anon, authenticated;
notify pgrst, 'reload schema';
```

Add `public_stylist_status` if that view is also affected:

```sql
grant select on public.public_stylist_status to anon, authenticated;
```

Effective immediately for new queries. The pages themselves recover on their
next revalidation — **up to an hour for the homepage** — or at once if you
redeploy to force regeneration. There is no on-demand purge; that is phase 2.

---

## Confirming it, rather than assuming

Reading the grant back is the point. Three checks, cheapest first.

**1. The catalogue.**

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('public_stylists', 'public_stylist_status')
order by table_name, grantee;
```

Expect `SELECT` for `anon` and `authenticated` on both. You will also see
`postgres` and `service_role` with the full privilege set — Supabase's standard
ownership grants, on every object, not something a migration created.

**2. As anon, which is the role that actually matters.**

```sql
begin;
  set local role anon;
  select count(*) from public.public_stylists;
rollback;
```

A number is a pass, including `0`. A permission error is the failure.

**3. The page.** `curl -s https://cavybeauty.com/hair-models | grep -c 'rounded-full bg-soft-pink'`
— the stylist-card avatar class. **This one is only meaningful once item 11 is
fixed**, because the page renders zero cards today for the bio-bar reason. Until
then, checks 1 and 2 are the only ones that can tell you anything.

---

## The rule this came from

`drop view` + `create view` loses grants; `create or replace view` keeps them but
cannot drop a column. **Any migration that removes a column from a public view
must reissue the grant in the same transaction, and verify it from
`information_schema` rather than trusting the line ran.**

Same family as the rest of this project's near-misses: the statement runs, no
error appears, and the thing it was supposed to guarantee quietly is not true.
