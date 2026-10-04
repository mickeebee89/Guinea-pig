-- ===========================================================================
-- 0082_an_admin_message_reaches_an_inbox
--
-- 'admin_message' joins all three email lists. One line each, one reason, and
-- ALL THREE IN THE SAME MIGRATION. Audit item 151.
--
-- ⚠️ Apply 0081 first.
--
-- ── WHY, AND WHY NOW ───────────────────────────────────
-- Found live on 4 Oct 2026: notify_as_admin wrote its row correctly and NO
-- EMAIL ARRIVED. That was correct as built — 'admin_message' is in none of the
-- three lists — and the question was whether what was built is right.
--
-- 0047 decided it, and wrote the decision down:
--
--   "Not emailed: new_availability, stylist_invite, admin_message,
--    session_completed. The first is a mass send (one per favouriter), and the
--    rest are not worth an interruption."
--
-- ⚠️ THAT PREMISE WAS ALREADY OVERTURNED FOR A SIBLING ON THE SAME LIST.
-- 'stylist_invite' was in it, and 0073 moved it INTO the allowlist because
-- "a stylist's invitation sits in a notifications tab the model may not open
-- for days". An admin writing deliberately to ONE person is a weaker candidate
-- for "not worth an interruption" than an invitation was.
--
-- Decided by Micky, 4 Oct 2026.
--
-- ── ⚠️ THE GROUPING WAS THE WRONG AXIS ─────────────────
-- Of 0047's four "not worth an interruption" types, THREE have now been
-- questioned within six weeks: stylist_invite overturned (0073),
-- admin_message overturned here, session_completed contested and raised as its
-- own decision (item 159, undecided). Only new_availability stands, and it
-- stands on a DIFFERENT reason — it is a mass send, one email per favouriter.
--
-- Three of four overturned or contested is a sign the grouping was the wrong
-- axis, not that each case is special. "Worth an interruption" is a judgement
-- about one message to one person; it was applied to a list assembled by what
-- happened to be unemailed at the time.
--
-- ── THE THREE LISTS MOVE TOGETHER ──────────────────────
--   notify_email's WHEN clause        is an email ATTEMPTED
--   run_email_reconcile's allowlist   is a missing one NOTICED
--   copyFor() in send-email           what the member SEES
--
-- A type in the first and not the second is emailed and never checked — where
-- admin_suspension sat from 0061 to 0068 (item 135). A type in the first two
-- and not the third falls to copyFor's default — which since 0081 is a fixed
-- string rather than the row's title, but a generic heading on a deliberate
-- message from an admin is still the wrong email.
--
-- ⚠️ copyFor IS IN THE EDGE FUNCTION AND DEPLOYS SEPARATELY. It is in the same
-- commit, and check-email-type-coverage.mjs (item 151) fails if the three ever
-- disagree — so the order of apply-versus-deploy cannot be forgotten, only
-- sequenced. Deploy send-email BEFORE applying this: an email attempted with no
-- copyFor case gets a generic subject, which is worse than one not yet sent.
-- ===========================================================================
begin;

do $$
declare
  v_code text;
  v_trg  text;
begin
  if not exists (select 1 from public.schema_migrations where version = '0081') then
    raise exception '0082: apply 0081 first.';
  end if;

  -- Comments stripped: this file's own prose names the type, and 0068's guard
  -- read the prose and reported the change as already made.
  v_code := regexp_replace(
              pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
              '--[^' || chr(10) || ']*', '', 'g');
  v_trg := (select pg_get_triggerdef(oid) from pg_trigger
             where tgrelid = 'public.notifications'::regclass and tgname = 'notify_email');

  if v_trg is null then
    raise exception '0082: the notify_email trigger does not exist. Read it before going further.';
  end if;
  if v_code like '%admin_message%' then
    raise exception '0082: run_email_reconcile already lists admin_message. This migration has run.';
  end if;
  if v_trg like '%admin_message%' then
    raise exception '0082: the notify_email trigger already lists admin_message. This migration has run.';
  end if;
  if v_code not like '%stylist_invite%' then
    raise exception '0082: the live run_email_reconcile is not 0073''s version — stylist_invite is missing. Read it with pg_get_functiondef before going further.';
  end if;
  if position('delete from public.email_sends' in v_code)
     < position('insert into public.email_reconcile_runs' in v_code) then
    raise exception '0082: the live run_email_reconcile has its DELETE above its INSERT, so 0069 has been undone. Applying this would reinstate a function that raises on every call.';
  end if;
end $$;

-- ── 1. ATTEMPTED ──────────────────────────────────────────────────────────
drop trigger if exists notify_email on public.notifications;
create trigger notify_email after insert on public.notifications
  for each row
  when (new.type = any (array['session_applied', 'session_accepted', 'session_declined',
                              'session_cancelled', 'verification', 'payment_failed',
                              'admin_warning', 'admin_suspension', 'session_expired',
                              'session_not_held', 'stylist_invite', 'admin_message']))
  execute function public.tg_notify_email();

-- ── 2. NOTICED ────────────────────────────────────────────────────────────
-- Reproduced from the live definition, with 'admin_message' added to the type
-- list and nothing else changed.
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
                     'session_not_held', 'stylist_invite', 'admin_message')
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
values ('0082', 'an_admin_message_reaches_an_inbox', 'df86af7ed780dd84e5128a29e3eda3128feb5858a450db3fe1f4e77ff3cdcf6f');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
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
--     (select count(*) from public.schema_migrations where version = '0081') = 1
--       as v_0081_applied,
--     code not like '%admin_message%'  as reconciler_needs_it,
--     trg  not like '%admin_message%'  as trigger_needs_it,
--     code like '%stylist_invite%'     as reconciler_is_0073s,
--     position('delete from public.email_sends' in code)
--       > position('insert into public.email_reconcile_runs' in code)
--                                      as delete_is_below_insert
--   from f;
--
--   Expect all five true.
--
--   ⚠️ AND DEPLOY send-email FIRST: npx supabase functions deploy send-email
--   --no-verify-jwt. Its copyFor case for admin_message is in the same commit
--   as this file. Applying this before deploying means the first admin message
--   is emailed with copyFor's generic default subject — worse than one not yet
--   sent, and not undoable once it has gone.
-- ===========================================================================
--
-- ── VERIFY — ONE BLOCK ──────────────────────────────────────────────────
--
--   Conventions (scripts/migration-status.mjs): one paste; sections in their own
--   begin/exception subtransactions; every variable declared; one `%` fed one
--   concatenated string; scalar subqueries, never `select ... into`; and every
--   read-back proves the row is NEW.
--
--   begin;
--   do $v$
--   declare
--     v_admin uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_model uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_before uuid[];
--     v_new    uuid;
--     r_a text := 'not run';
--     r_b text := 'not run';
--     r_c text := 'not run';
--   begin
--     -- (a) all three lists now carry it, read from the LIVE objects
--     begin
--       r_a := 'trigger=' || (select case when pg_get_triggerdef(oid) like '%admin_message%'
--                                         then 'yes' else 'NO' end
--                               from pg_trigger
--                              where tgrelid = 'public.notifications'::regclass
--                                and tgname = 'notify_email')
--              || ' reconciler=' || (case when regexp_replace(
--                     pg_get_functiondef('public.run_email_reconcile(integer)'::regprocedure),
--                     '--[^' || chr(10) || ']*', '', 'g') like '%admin_message%'
--                   then 'yes' else 'NO' end);
--     exception when others then r_a := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     -- (b) the reconciler still RUNS. 0069 is why this is here: a body that
--     --     parses is not a body that works, and this one spent nine days
--     --     raising on every call while looking fine.
--     begin
--       r_b := 'emailable=' || (select emailable from public.run_email_reconcile(24));
--     exception when others then r_b := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     -- (c) an admin message now fires the trigger. The row is proven NEW.
--     begin
--       v_before := array(select n.id from public.notifications n
--                          where n.user_id = v_model and n.type = 'admin_message');
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
--       execute 'set local role authenticated';
--       perform public.notify_as_admin(v_model, '0082 verify', 'Rolled back.');
--       execute 'reset role';
--       v_new := (select n.id from public.notifications n
--                  where n.user_id = v_model and n.type = 'admin_message'
--                    and not (n.id = any (v_before)));
--       if v_new is null then
--         r_c := 'NO NEW ROW — notify_as_admin wrote nothing. An older admin_message is NOT evidence.';
--       else
--         r_c := 'new row: yes | queued sends for it: '
--                || (select count(*) from public.email_sends
--                     where kind = 'notification' and ref_id = v_new);
--       end if;
--     exception when others then r_c := 'SECTION ERRORED: ' || sqlerrm; end;
--
--     raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
--       || '(a) lists   : ' || r_a || chr(10)
--       || '(b) reconciler runs: ' || r_b || chr(10)
--       || '(c) admin msg: ' || r_c;
--   end $v$;
--   rollback;
--
--   EXPECT (a) trigger=yes reconciler=yes; (b) a number and no error — 0 is a
--   legitimate answer on a quiet day and is exactly what could not be told from
--   a crash before 0069; (c) new row: yes.
--
--   ⚠️ (c)'s send count will be 0, and that is CORRECT rather than a failure:
--   pg_net dispatches after COMMIT and this rolls back, so nothing is sent and
--   email_sends gets no row. Item 152 established that a rolled-back
--   transaction cannot deliver — net.wake() takes no arguments, so the queue row
--   is the only channel and an uncommitted row is invisible to the worker.
--   **The real proof is one admin message sent from the console afterwards.**
-- ===========================================================================
