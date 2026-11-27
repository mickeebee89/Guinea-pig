-- 0119_the_sweep_is_the_guard.sql
--
-- WHY THERE IS A 0119 AT ALL
-- 0118 was applied directly through the Supabase connector while Claude Code
-- was independently building its own 0118 from the same brief. Two files, one
-- number. The applied one wins because it is applied; Code's file is discarded
-- rather than merged, and this migration carries the three things Code's
-- version had that the applied one did not. 0118 is not edited: it ran.
--
-- The collision was avoidable and the rule that would have avoided it already
-- exists in this project -- do not act while a prompt covering the same work
-- is outstanding. Written down here because the ledger is where it will be
-- read next time.
--
-- WHAT 0118 ACTUALLY CHANGED ON SCREEN, which its own header understated.
-- It reported the nine availability audiences as unchanged, which is true and
-- was the only thing measured. Two user-visible numbers did move:
--   * model_demand_summary.models_total 89 -> 90. Read live by
--     getSignedUpModelCount for the setup panel's "N models have signed up".
--   * invitable_models 89 -> 90 for every published stylist, so the model
--     directory now lists the `both` account and an invite to it succeeds
--     where it previously raised 42501.
-- Both are the test account. "Blast radius nil" was wider than the evidence
-- for it: audiences were measured, the panel and the directory were not.
--
-- THREE THINGS THIS ADDS
--  1. The catalogue sweep, as a permanent guard rather than a one-off check.
--  2. notify_verification_approved widened -- title emoji only.
--  3. An assertion that verification_approval_body still speaks to a `both`
--     account as a shop owner, because that one must NOT be widened.

begin;

-- 1. THE SWEEP, AND THE TWO BUGS THAT MAKE IT HARDER THAN IT LOOKS.
--
-- prokind = 'f' is load-bearing: pg_get_functiondef raises on aggregates, so
-- the unfiltered sweep aborts with an error about array_agg and nothing to do
-- with roles. Found by Code running the query against the live catalogue
-- before putting it in a migration.
--
-- Comments are stripped, because a comment explaining the old predicate is not
-- the old predicate -- guard_users_protected_columns matches on its comment
-- alone and is not a finding.
--
-- p_role is masked, because verification_approval_body and
-- notify_verification_approved test a PARAMETER naming which announcement to
-- make, not the users column. Without the mask this guard would fail forever
-- on two functions that are correct.
create or replace function public.narrow_model_role_predicates()
  returns table(fn text)
  language sql stable
  set search_path to 'public', 'pg_temp'
as $fn$
  select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g'),
           'p_role', 'PARAM', 'g')
         ~ 'role[[:space:]]*=[[:space:]]*''model'''
   order by 1;
$fn$;

comment on function public.narrow_model_role_predicates() is
  'Functions still testing role = ''model'' instead of role in (''model'',''both''). '
  'Must return zero rows. site/lib/roles.ts is the definition this enforces. '
  'Call it from the guard block of any migration that adds a function reading users.role.';

-- 2. The title emoji. A `both` account held 0 verification_requests and there
-- are 0 pending anywhere, and both gates are off, so nobody can receive this
-- today. Preventive, and one line.
create or replace function public.notify_verification_approved(
  p_user_id uuid, p_role text, p_shops jsonb)
  returns void
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.is_admin() then
    raise exception 'notify_verification_approved: only an admin can announce a verification'
      using errcode = '42501';
  end if;
  if p_user_id is null then
    return;                 -- nobody to tell; the caller decided that, not this
  end if;

  insert into public.notifications (user_id, type, title, body)
  values (
    p_user_id,
    'verification',
    -- 0119: a `both` account gets the model tick. The two titles differ only
    -- by emoji, so this is cosmetic -- but the body it sits above speaks to
    -- her as a shop owner, and that seam is deliberate: both statements are
    -- true of her. It is not one voice, and the alternative is worse.
    case when p_role in ('model','both') then 'You''re verified! ✅' else 'You''re verified! 🎉' end,
    public.verification_approval_body(p_role, p_shops)
  );
end
$fn$;

-- 3. Verify
do $verify$
declare
  v_narrow text;
  v_body   text;
begin
  -- The sweep must be clean, and it is now a function so the next migration
  -- can call it in one line.
  select string_agg(fn, ', ') into v_narrow from public.narrow_model_role_predicates();
  if v_narrow is not null then
    raise exception '0119 verify: still narrow: %', v_narrow;
  end if;

  -- The emoji arm.
  if (select pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'notify_verification_approved')
     not like '%p_role in (''model'',''both'')%' then
    raise exception '0119 verify: notify_verification_approved was not widened';
  end if;

  -- THE ONE THAT MUST NOT BE WIDENED. Called, not read: a `both` account with
  -- an unpublished shop has to be told about the shop. If somebody widens
  -- verification_approval_body later, she silently gets the model sentence
  -- instead and is never told the one fact she is waiting on.
  v_body := public.verification_approval_body(
    'both',
    '[{"published":false,"has_name":true,"has_categorised_treatment":true}]'::jsonb);
  if v_body not like '%not public yet%' then
    raise exception '0119 verify: a `both` account no longer hears about its shop: %', v_body;
  end if;

  -- And a plain model still gets the short sentence.
  if public.verification_approval_body('model', '[]'::jsonb) not like '%badge is live%' then
    raise exception '0119 verify: the model sentence changed';
  end if;

  raise notice '0119: sweep clean, emoji widened, shop sentence intact';
end
$verify$;

-- ⚠️ ONE THING LEFT ALONE, DELIBERATELY, AND IT IS A COPY DECISION NOT A BUG
-- FIX. verification_approval_body says "Your identity check passed". Terms §7
-- was renamed to "account checks" on 30 Oct and now says it is NOT an identity
-- check against a document. Those two disagree. Nobody can receive the message
-- today because both verification gates are off, so there is no urgency, and
-- choosing the replacement wording is Micky's call rather than a migration's.

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum, applied_by)
values ('0119', 'the_sweep_is_the_guard',
        '4ce3ee688465cb20bb8799d4ac4439cb92a52c3c87cce1de6e3cef31952e5914', 'claude-opus-5');

commit;
