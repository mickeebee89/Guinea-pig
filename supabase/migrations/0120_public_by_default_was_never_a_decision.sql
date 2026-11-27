-- 0120_public_by_default_was_never_a_decision.sql
--
-- WHAT THIS CLOSES
-- model_demand_summary() was callable without a session. Measured by calling
-- it as `anon` on 27 Nov 2026: it returned models_total 90, models_placed 61
-- and three named postcode areas with counts and centroids. The anon key is in
-- the client bundle, so that is a public endpoint.
--
-- 0112 built this function carefully to expose clusters rather than
-- individuals -- a >= 3 threshold, centroids, no rows for a single person.
-- That care is why the leak is small. It is still not what 0112 intended: it
-- granted EXECUTE to `authenticated` and said nothing about PUBLIC.
--
-- ⚠️ THE GRANT TO REMOVE IS PUBLIC, NOT anon, AND THAT DISTINCTION IS THE
-- WHOLE FIX. The live ACL read:
--     =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
-- The leading bare `=X` is PUBLIC. There was never an anon grant, so
-- `revoke ... from anon` alone is a no-op that leaves anon's access intact
-- through PUBLIC and reports success. Postgres grants EXECUTE on every new
-- function to PUBLIC on creation, so this is the default nobody chose.
-- Caught by Claude Code reading the ACL rather than the instruction.
--
-- WHY THIS IS SAFE, MEASURED NOT ASSUMED
-- One caller in the entire repo: site/lib/queries/shop.ts getSignedUpModelCount,
-- called only from site/app/(app)/dashboard/page.tsx and only when
-- `setup && !setup.isPublished`. That route sits under site/app/(app)/, whose
-- layout calls requireUser(), which redirects to /sign-in without a user. No
-- edge function, cron, route handler or SQL file calls it. admin/ and mobile/
-- have no callers. So the only caller is a signed-in stylist looking at her
-- own setup panel, and `authenticated` keeps EXECUTE.
--
-- TWO MORE FROM THE SAME FEATURE, included because they share the cause.
-- invitable_models and invite_model are also PUBLIC-by-default. Neither leaks:
-- called without a session, auth.uid() is null, so invitable_models matches no
-- `me` row and returns nothing, and invite_model raises 42501. They are closed
-- anyway -- an endpoint that is harmless because of a check inside it is one
-- edit away from being harmful, and there is no reason for either to be
-- reachable without a session.
--
-- AND ONE OF MY OWN. narrow_model_role_predicates(), added in 0119 four
-- minutes ago, was created with no grant statement and so is PUBLIC too. It
-- reads pg_proc, which is world-readable, so it discloses nothing a determined
-- caller could not already read -- but nothing decided that, which is the
-- exact fault this migration is about. It is an operational guard for
-- migrations, so it goes to postgres and service_role only.
--
-- ⚠️ WHAT THIS DOES NOT FIX, STATED SO IT IS NOT MISTAKEN FOR DONE.
-- 115 functions in `public`. 45 are anon-callable: 42 of them by this same
-- PUBLIC default and only 3 by an explicit anon grant. This migration closes
-- four. The remaining 38 have not been read, and some of them SHOULD be open
-- -- the public shop pages need them. Nothing here should be read as a claim
-- that the pattern has been swept.

begin;

do $guard$
begin
  -- If PUBLIC has already gone, something else has touched these and this
  -- migration is not describing the database it is being applied to.
  if not has_function_privilege('anon',
       'public.model_demand_summary(double precision,double precision)', 'execute') then
    raise exception '0120: model_demand_summary is already closed to anon -- read the ACL before re-applying';
  end if;
end
$guard$;

revoke execute on function
  public.model_demand_summary(double precision, double precision)
  from public, anon;

revoke execute on function
  public.invitable_models(double precision, double precision, double precision)
  from public, anon;

revoke execute on function
  public.invite_model(uuid, text)
  from public, anon;

revoke execute on function
  public.narrow_model_role_predicates()
  from public, anon, authenticated;

do $verify$
declare
  v_rec record;
begin
  -- 1. Nothing on the list is reachable without a session any more.
  for v_rec in
    select unnest(array[
      'public.model_demand_summary(double precision,double precision)',
      'public.invitable_models(double precision,double precision,double precision)',
      'public.invite_model(uuid,text)',
      'public.narrow_model_role_predicates()'
    ]) as sig
  loop
    if has_function_privilege('anon', v_rec.sig, 'execute') then
      raise exception '0120 verify: anon can still execute %', v_rec.sig;
    end if;
  end loop;

  -- 2. THE THREE THE APP CALLS MUST STILL WORK. This is the half of the change
  -- that can break a signed-in stylist, and a revoke that overshoots looks
  -- identical to one that lands until she opens her dashboard.
  for v_rec in
    select unnest(array[
      'public.model_demand_summary(double precision,double precision)',
      'public.invitable_models(double precision,double precision,double precision)',
      'public.invite_model(uuid,text)'
    ]) as sig
  loop
    if not has_function_privilege('authenticated', v_rec.sig, 'execute') then
      raise exception '0120 verify: authenticated LOST execute on % -- the dashboard and the model directory are broken', v_rec.sig;
    end if;
  end loop;

  -- 3. The guard function is for migrations, so postgres keeps it and nobody
  --    else has it.
  if has_function_privilege('authenticated', 'public.narrow_model_role_predicates()', 'execute') then
    raise exception '0120 verify: narrow_model_role_predicates is still open to authenticated';
  end if;
  if not has_function_privilege('postgres', 'public.narrow_model_role_predicates()', 'execute') then
    raise exception '0120 verify: postgres cannot run the guard -- the next migration will fail';
  end if;

  -- 4. The sweep 0119 installed must still be clean. Revoking from the guard
  --    itself is the one change that could make it unreadable.
  if (select count(*) from public.narrow_model_role_predicates()) <> 0 then
    raise exception '0120 verify: the role sweep is no longer clean';
  end if;

  raise notice '0120: four functions closed to PUBLIC, three still open to authenticated, sweep clean';
end
$verify$;
-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum, applied_by)
values ('0120', 'public_by_default_was_never_a_decision',
        'bc31adae74aecf2d2d54759be6151181109d67002018f0a3724ddce36229144d', 'claude-opus-5');

commit;
