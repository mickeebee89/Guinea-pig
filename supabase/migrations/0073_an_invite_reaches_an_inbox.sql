-- ===========================================================================
-- 0073_an_invite_reaches_an_inbox
--
-- 'stylist_invite' joins both email allowlists. One line each, one reason, and
-- BOTH IN THE SAME MIGRATION. Audit item 141.
--
-- ⚠️ Apply 0072 first.
--
-- ── WHY THE TWO LISTS ARE ONE CHANGE ───────────────────
-- There are two allowlists and they are two halves of one rule:
--
--   notify_email's WHEN clause        decides whether an email is ATTEMPTED
--   run_email_reconcile's type list   decides whether a missing attempt is NOTICED
--
-- A type in the first and not the second is emailed and never checked. That is
-- where 'admin_suspension' sat from 0061 to 0068 (item 135) — the notification
-- telling somebody their account is restricted was the one type excluded from
-- the check that catches emails that never went.
--
-- So they move together, in one file, every time. This is the third type added
-- since that was learned and the second to be done this way.
--
-- ── WHY AN INVITE NEEDS AN EMAIL AT ALL ────────────────
-- Until now 'stylist_invite' was in neither list: in-app only. On mobile that
-- was survivable, because the app has push. On the web it means a stylist's
-- invitation sits in a notifications tab the model may not open for days, and
-- the Salon Floor's whole purpose is giving a stylist something that works on
-- her first day.
--
-- Decided by Micky, 2 Oct 2026, along with: no rate limit. A stylist may invite
-- whoever she likes, as often as she likes. Worth knowing that this migration is
-- what turns that into somebody's inbox rather than a badge they can ignore.
--
-- ── ⚠️ BOTH BODIES ARE REPRODUCED FROM WHAT IS LIVE ────
-- The reconciler is 0070's text and the trigger is 0070's WHEN clause. Neither
-- is taken from 0047, whose copy of both has been stale since 0061. The guard
-- below refuses to run unless the live reconciler carries BOTH of 0070's
-- fingerprints: 'session_not_held' in its list, and its DELETE below its INSERT.
--
-- That second one matters more than it looks. From 0047 to 0069 a DELETE sat
-- between the CTE chain and the INSERT that read it, and the function raised on
-- every call it ever had (item 136). Reinstating that shape here would silently
-- re-break the only check that notices unsent email — including the invites
-- this migration is adding.
-- ===========================================================================

begin;

do $$
declare
  v_code text;
  v_con  text;
begin
  if exists (select 1 from public.schema_migrations where version = '0073') then
    raise exception 'Migration 0073 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0072') then
    raise exception '0073 expects 0072 to be applied first.';
  end if;

  -- Comments stripped before matching, for the reason 0068's guard had to learn
  -- the hard way: pg_get_functiondef returns the prose as well as the code, and
  -- these bodies discuss the very type names being tested for.
  v_code := regexp_replace(
    pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
    '--[^' || chr(10) || ']*', '', 'g');

  if v_code not like '%session_not_held%' then
    raise exception '0073: the live run_email_reconcile is not 0070''s version. Read it with pg_get_functiondef before going further.';
  end if;
  if position('delete from public.email_sends' in v_code)
     < position('insert into public.email_reconcile_runs' in v_code) then
    raise exception '0073: the live run_email_reconcile has its DELETE above its INSERT, so 0069 has been undone. Applying this would reinstate a function that raises on every call.';
  end if;
  if v_code like '%stylist_invite%' then
    raise exception '0073: run_email_reconcile already lists stylist_invite. This migration has run.';
  end if;

  -- Same guard 0061 and 0067 used before adding a type: a CHECK on
  -- notifications.type that does not allow it would fail at send time, not here.
  select pg_get_constraintdef(c.oid) into v_con
  from pg_constraint c
  where c.conrelid = 'public.notifications'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%type%';

  if v_con is not null and v_con not like '%stylist_invite%' then
    raise exception '0073: notifications.type has a CHECK that does not allow stylist_invite: %. Widen it first.', v_con;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. ATTEMPTED
-- ---------------------------------------------------------------------------
drop trigger if exists notify_email on public.notifications;
create trigger notify_email after insert on public.notifications
  for each row
  when (new.type = any (array['session_applied', 'session_accepted', 'session_declined',
                              'session_cancelled', 'verification', 'payment_failed',
                              'admin_warning', 'admin_suspension', 'session_expired',
                              'session_not_held', 'stylist_invite']))
  execute function public.tg_notify_email();

-- ---------------------------------------------------------------------------
-- 2. NOTICED
-- ---------------------------------------------------------------------------
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
  -- ⚠️ NOTHING MAY COME BETWEEN THIS `with` AND THE `insert` BELOW IT.
  -- A CTE attaches to the single statement that follows it. From 0047 to 0069
  -- a DELETE sat here and this function raised 42P01 on every call it ever had,
  -- nightly, while appearing to be a working monitor (item 136).
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ MUST MATCH THE notify_email TRIGGER'S WHEN CLAUSE. The trigger
      -- decides whether an email is attempted; this decides whether a missing
      -- attempt is noticed. A type in one and not the other is emailed and
      -- never checked — where admin_suspension sat from 0061 to 0068.
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired',
                     'session_not_held', 'stylist_invite')
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
  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  -- 90 days, per the Privacy policy. Position is load-bearing: see above.
  delete from public.email_sends where created_at < now() - interval '90 days';

  return v_row;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0073', 'an_invite_reaches_an_inbox', '7d2653c4fb3bf3e715d8baa34f328247cba730da980100b1148815e228a14139');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   Comments stripped before matching: the bodies discuss the type names, so a
--   plain LIKE reads the prose and reports the change as already made. That is
--   what 0068's guard did on its first attempt.
--
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as code,
--            (select pg_get_triggerdef(oid) from pg_trigger
--              where tgrelid = 'public.notifications'::regclass
--                and tgname = 'notify_email') as trg
--   )
--   select
--     (select count(*) from public.schema_migrations where version = '0072') = 1
--       as v_0072_applied,
--     code like '%session_not_held%'      as reconciler_is_0070s,
--     code not like '%stylist_invite%'    as reconciler_needs_it,
--     trg  not like '%stylist_invite%'    as trigger_needs_it,
--     position('delete from public.email_sends' in code)
--       > position('insert into public.email_reconcile_runs' in code)
--                                         as delete_is_below_insert
--   from f;
--
--   Expect all five true.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the two halves agree, read from the LIVE objects with comments
--   --     stripped. Two falses that MATCH each other would mean the lists
--   --     agree with one another but not with what this migration intended.
--   with f as (
--     select regexp_replace(
--              pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
--              '--[^' || chr(10) || ']*', '', 'g') as code,
--            (select pg_get_triggerdef(oid) from pg_trigger
--              where tgrelid = 'public.notifications'::regclass
--                and tgname = 'notify_email') as trg
--   )
--   select
--     code like '%stylist_invite%'   as reconciler_lists_it,
--     trg  like '%stylist_invite%'   as trigger_lists_it,
--     code like '%session_not_held%' as reconciler_kept_0070s,
--     trg  like '%session_not_held%' as trigger_kept_0070s
--   from f;
--
--   Expect all four true.
--
--   -- (b) the reconciler still RUNS. 0069 is the reason this is here: a body
--   --     that parses is not a body that works, and this function spent nine
--   --     days raising on every call while looking fine.
--   begin;
--     select window_hours, emailable, no_attempt from public.run_email_reconcile(24);
--   rollback;
--
--   Expect one row and no error. emailable may be 0 on a quiet day — that is a
--   legitimate answer and is exactly what could not be told apart from a crash
--   before 0069.
--
--   -- (c) count the two lists rather than eyeballing them.
--   select
--     (select count(*) from regexp_matches(
--        (select pg_get_triggerdef(oid) from pg_trigger
--          where tgrelid = 'public.notifications'::regclass and tgname = 'notify_email'),
--        '''[a-z_]+''::text', 'g'))                        as types_in_trigger;
--
--   Expect 11.
-- ===========================================================================
