-- ===========================================================================
-- 0068_the_suspension_email_was_never_checked
--
-- Adds 'admin_suspension' to run_email_reconcile's list. One line, one reason.
-- Audit item 135.
--
-- ⚠️ Apply 0067 first.
--
-- ── THE GAP ────────────────────────────────────────────
-- There are two allowlists of notification types that get emailed:
--
--   1. the notify_email trigger's WHEN clause — decides whether an email is
--      ATTEMPTED;
--   2. run_email_reconcile's `n.type in (…)` — decides whether a missing
--      attempt is NOTICED.
--
-- 0061 added 'admin_suspension' to the first and not the second. So since
-- 25 Sep the notification telling somebody their account has been suspended or
-- banned has been emailed like any other — and excluded from the one check
-- that catches an email that never went.
--
-- run_email_reconcile's own comment describes what that check is for:
-- `no_attempt > 0` means "the trigger never reached the function — the failure
-- the log itself cannot" see. A suspension email that silently failed to send
-- would be invisible to it, because the row was never in scope.
--
-- ── WHY IT MATTERS MORE THAN THE OTHERS ON THE LIST ────
-- Every other type on that list is a thing somebody can discover by opening
-- the app: a booking accepted, a payment failed. A suspension is the one where
-- the member's access to the app is itself the thing that changed, and 0061
-- went to some trouble to make sure she is TOLD rather than left to work it
-- out — a notification and an email, with a message field added specifically
-- so the reason could be given safely.
--
-- An email nobody checked was delivered is a thin version of that promise.
--
-- ── WHY IT IS ITS OWN MIGRATION ────────────────────────
-- Found while adding 'session_expired' to both lists in 0067. It could have
-- ridden along in one line and been invisible in that file's history. One
-- change, one reason, so `git log` can answer "when did suspension emails
-- start being reconciled, and why were they not before".
--
-- ── ⚠️ WHERE THIS BODY COMES FROM ──────────────────────
-- 0067 replaced this function minutes ago, so the live body is 0067's text
-- plus nothing. That is an assumption, and assumptions about live function
-- bodies are what the rule about pg_get_functiondef exists for — so it is
-- ASSERTED below rather than trusted: the migration refuses to run unless the
-- live body already contains 'session_expired' (0067 ran) and does not yet
-- contain 'admin_suspension' (this has not).
--
-- Everything else is character-for-character 0067's version.
-- ===========================================================================

begin;

do $$
declare
  v_def  text;
  v_code text;
begin
  if exists (select 1 from public.schema_migrations where version = '0068') then
    raise exception 'Migration 0068 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0067') then
    raise exception '0068 expects 0067 to be applied first.';
  end if;

  v_def := pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure);

  -- ⚠️ COMMENTS STRIPPED BEFORE MATCHING, AND THE FIRST VERSION OF THIS GUARD
  -- DID NOT DO IT. pg_get_functiondef returns the comments as well as the
  -- code, and 0067's body carries the sentence "'admin_suspension' is STILL
  -- MISSING and that is a known gap". A plain like '%admin_suspension%'
  -- therefore matched the DESCRIPTION OF THE GAP and concluded the gap was
  -- closed — so this migration refused to run, and its preflight reported the
  -- fix as already applied, on evidence that was a sentence about it not being
  -- applied.
  --
  -- Exactly 0028's lesson, which is quoted in the VERIFY block at the foot of
  -- this same file: the artefact of a fix must not be able to satisfy the test
  -- for the fix. The defence was written there and not here, twelve lines
  -- apart, on the same afternoon.
  v_code := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  if v_code not like '%session_expired%' then
    raise exception '0068: the live run_email_reconcile does not mention session_expired, so it is not 0067''s version. Read it with pg_get_functiondef before going further.';
  end if;
  if v_code like '%admin_suspension%' then
    raise exception '0068: the live run_email_reconcile already lists admin_suspension. This migration has run.';
  end if;
end $$;

create or replace function public.run_email_reconcile(p_hours integer default 24)
returns public.email_reconcile_runs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.email_reconcile_runs;
  v_since timestamptz := now() - make_interval(hours => p_hours);
begin
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ THIS LIST MUST MATCH THE notify_email TRIGGER'S WHEN CLAUSE.
      -- They are two halves of one rule: the trigger decides whether an email
      -- is attempted, this decides whether a missing attempt is noticed. A
      -- type in the first and not the second is emailed and never checked.
      --
      -- 'admin_suspension' was in that state from 0061 (25 Sep) to 0068
      -- (1 Oct) — the notification telling somebody their account is
      -- restricted was the one type excluded from the check that catches
      -- emails that never went.
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired')
  ),
  attempts as (
    select e.id,
           max(case when s.status = 'sent'    then 1 else 0 end) as sent,
           max(case when s.status = 'failed'  then 1 else 0 end) as failed,
           max(case when s.status = 'skipped' then 1 else 0 end) as skipped,
           count(s.id)                                           as tries
    from emailable e
    left join public.email_sends s on s.kind = 'notification' and s.ref_id = e.id
    group by e.id
  )
  -- 90 days, because that is what the Privacy policy now says: "A record that
  -- we sent you an email … kept for 90 days". Deleted here rather than in
  -- run_retention_purge so the promise is kept by the job that runs nightly,
  -- not monthly. The reconcile only ever looks at the last 24 hours.
  delete from public.email_sends where created_at < now() - interval '90 days';

  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  return v_row;
end $$;

comment on function public.run_email_reconcile(integer) is
  'Counts notifications that should have been emailed in the last p_hours and '
  'how many actually were. no_attempt > 0 means the trigger never reached the '
  'send function. ⚠️ Its type list must match the notify_email trigger''s WHEN '
  'clause — a type in one and not the other is emailed and never checked, which '
  'is where admin_suspension sat from 0061 to 0068. Audit item 135.';

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0068', 'the_suspension_email_was_never_checked', 'd9d6c6d77dc5eb81f7bf280d3a9e90d80e155f79fb5e6193700096670a8aad75');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING. Without that, these read the
--   comments inside the function as though they were code — 0067's body says
--   "'admin_suspension' is STILL MISSING", so a plain LIKE reports the fix as
--   already applied. See the note above the ASSERT in the body.
--
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as code
--   )
--   select
--     (select count(*) from public.schema_migrations where version = '0067') = 1
--       as v_0067_applied,
--     code like '%session_expired%'       as live_body_is_0067s,
--     code not like '%admin_suspension%'  as not_already_done,
--     (select count(*) from public.notifications
--       where type = 'admin_suspension')  as suspensions_ever_sent
--   from f;
--
--   Expect the first three true. The fourth is FYI — it is how many rows have
--   been outside the reconciler's sight since 25 Sep.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the two lists now agree. Both read from the LIVE objects, with
--   --     line comments stripped first: pg_get_functiondef returns the
--   --     comments too, and matching them instead of the code is how 0028's
--   --     verify reported a removed sentence as still present.
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as body,
--            (select pg_get_triggerdef(oid) from pg_trigger
--              where tgrelid = 'public.notifications'::regclass
--                and tgname = 'notify_email') as trg
--   )
--   select
--     body like '%admin_suspension%' as reconciler_lists_it,
--     trg  like '%admin_suspension%' as trigger_lists_it,
--     body like '%session_expired%'  as reconciler_still_has_0067s,
--     trg  like '%session_expired%'  as trigger_still_has_0067s
--   from f;
--
--   Expect all four true. Two falses that match each other would mean the
--   lists agree with one another but not with what these migrations intended.
--
--   -- (b) behavioural, and side-effect free. Runs the reconciler over a long
--   --     window and checks that suspensions are now IN SCOPE.
--   --
--   --     ⚠️ IT DOES NOT INSERT A NOTIFICATION. Inserting one fires the
--   --     notify_email trigger, which calls out through pg_net — a real email
--   --     to a real member, and not obviously undone by a rollback. A verify
--   --     block must not be able to message somebody.
--   begin;
--     select emailable, no_attempt
--     from public.run_email_reconcile(p_hours => 24 * 365);
--   rollback;
--
--   Compare `emailable` against:
--
--     select count(*) from public.notifications
--     where created_at >= now() - interval '365 days'
--       and type in ('session_applied', 'session_accepted', 'session_declined',
--                    'session_cancelled', 'verification', 'payment_failed',
--                    'admin_warning', 'admin_suspension', 'session_expired');
--
--   The two must be equal. If the preflight's suspensions_ever_sent was 0,
--   this proves the plumbing but not the fix — say so rather than reading it
--   as proof, and (a) is then the check that carries the weight.
-- ===========================================================================
