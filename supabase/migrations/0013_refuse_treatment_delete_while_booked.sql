-- ===========================================================================
-- 0013_refuse_treatment_delete_while_booked
--
-- A treatment cannot be removed while a LIVE booking uses it. Once that booking
-- is completed, cancelled or declined, it can.
--
-- ⚠️ RUN THE PRE-CHECK FIRST, AND IT IS NOT IN THIS FILE ON PURPOSE:
--      supabase/diagnostics/pre-0013-treatment-delete-guard.sql
--
--    0012 shipped its pre-check in its own comments, so "run the migration" and
--    "run the thing that must precede the migration" were the same paste. It
--    was skipped, and the baseline it was supposed to capture is gone for good.
--    A pre-check that lives inside the change it is checking will be skipped
--    sooner or later. This one is a separate file.
--
-- ── WHY THIS SHAPE AND NOT A FOREIGN KEY ──────────────────────────────────
-- sessions.treatment_id has no constraint at all, which is how the orphans in
-- mobile-treatments-orphan-bug.md happened. The obvious repair is a foreign
-- key, and both available behaviours are wrong here:
--
--   on delete restrict  — a stylist who stops doing lashes could NEVER remove
--                         Lashes, because completed bookings are permanent.
--   on delete set null  — removing a treatment silently blanks it on a live
--                         upcoming booking, so a stylist turns up to an
--                         appointment with no idea what it is for.
--
-- What is actually wanted is "refuse while it still matters, allow once it does
-- not", and no `on delete` clause expresses that. Hence a trigger.
--
-- Historical bookings deliberately KEEP their treatment_id after the treatment
-- is removed, dangling. Every read site already degrades to omitting the label,
-- and blanking a completed booking's record loses evidence for no benefit.
--
-- ── THE THIRD PROMISE THE DATABASE COULDN'T KEEP ──────────────────────────
-- The shop editor already tells stylists, in both apps:
--
--   "a booking still uses it — it'll come off once that booking is finished or
--    cancelled"
--
-- Nothing implemented that. The delete always succeeded, so the sentence could
-- never fire. This migration makes it true.
--
-- That is the third time this project has shipped a sentence with no mechanism
-- behind it:
--
--   1. `is_founding_provider` — promised on /for-stylists and in Terms §5, read
--      in four places, written by nothing (fixed in 0011).
--   2. The privacy policy described recording an IP address that was never
--      recorded (fixed in 0010, by removing the claim).
--   3. This.
--
-- The shape is identical each time: the sentence is written once and the
-- mechanism is assumed to follow. Worth checking for directly, because none of
-- the three was found by anything failing — all three were found by reading.
--
-- ── THE ERROR IS NOT THE USER-FACING COPY ─────────────────────────────────
-- This raises 23503 (foreign_key_violation) — the code a real foreign key
-- would raise for the same refusal, so clients can branch on it without
-- inventing a private convention.
--
-- The message here is for logs. The CLIENTS compose what the stylist reads,
-- because only they can say "Lashes is booked for Tuesday 12 August at 2pm" in
-- the app's own voice, and telling someone what is refused without telling them
-- what to do about it is half an error message. The rule lives here; the
-- explanation lives where the words live. If the client's lookup ever drifts
-- from this predicate the delete is still correctly refused and only the
-- wording degrades — the safe direction.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0013') then
    raise exception 'Migration 0013 has already been applied (see public.schema_migrations)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- BEFORE DELETE, so the row is still there to be refused.
--
-- Fires before 0012's AFTER DELETE strip, so a refusal means nothing was
-- stripped from availability either — the two compose in the right order by
-- construction rather than by luck.
--
-- SECURITY DEFINER so the check reads sessions regardless of who is deleting.
-- A stylist cannot see another stylist's sessions under RLS, and a guard that
-- silently passes because the checker could not see the blocking row would be
-- worse than no guard.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_treatment_delete_while_booked()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_date date;
  v_time time;
  v_count integer;
begin
  select count(*), min(s.date)
    into v_count, v_date
  from public.sessions s
  where s.treatment_id = old.id
    and s.status in ('pending', 'accepted');

  if v_count > 0 then
    select s.start_time into v_time
    from public.sessions s
    where s.treatment_id = old.id
      and s.status in ('pending', 'accepted')
      and s.date = v_date
    order by s.start_time
    limit 1;

    raise exception
      'Treatment % (%) still has % live booking(s); earliest % %',
      old.id, coalesce(old.category, '?'), v_count, v_date, coalesce(v_time::text, '')
      using errcode = '23503';
  end if;

  return old;
end;
$function$;

drop trigger if exists trg_refuse_treatment_delete_while_booked on public.provider_treatments;

create trigger trg_refuse_treatment_delete_while_booked
  before delete on public.provider_treatments
  for each row execute function public.refuse_treatment_delete_while_booked();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0013', 'refuse_treatment_delete_while_booked', '9de643443c6fe986930486e0b383750b41e1f161f18b9fbcc648c861027509da');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- One paste per block, each ending in one select.
--
-- ── BLOCK A — both triggers are present, and in the right order ──────────
--
--   BEFORE must fire before AFTER. Postgres orders same-timing triggers by
--   name, but these are different timings, so the order is guaranteed.
--
--   select tgname,
--          case when (tgtype & 2) > 0 then 'BEFORE' else 'AFTER' end as timing,
--          tgenabled
--   from pg_trigger
--   where tgrelid = 'public.provider_treatments'::regclass
--     and not tgisinternal
--   order by timing desc;
--
-- ── BLOCK B — it refuses a live booking. Rolls itself back. ──────────────
--
--   begin;
--     with p as (select id, user_id from public.providers limit 1),
--          t as (
--            insert into public.provider_treatments (provider_id, name, category)
--            select id, '__verify_0013', '__verify_0013' from p returning id, provider_id
--          )
--     insert into public.sessions (provider_id, model_user_id, model_id, date,
--                                  start_time, end_time, treatment_id, status)
--     select t.provider_id, p.user_id, p.user_id, current_date + 7,
--            '09:00', '10:00', t.id, 'accepted'
--     from t, p;
--
--     -- expect: ERROR 23503, naming the treatment and the date
--     delete from public.provider_treatments where name = '__verify_0013';
--   rollback;
--
-- ── BLOCK C — it allows a finished booking. Rolls itself back. ───────────
--
--   Same as B with status 'completed'. The delete must SUCCEED, and 0012's
--   strip must then leave no dead id behind.
--
--   begin;
--     with p as (select id, user_id from public.providers limit 1),
--          t as (
--            insert into public.provider_treatments (provider_id, name, category)
--            select id, '__verify_0013c', '__verify_0013c' from p returning id, provider_id
--          )
--     insert into public.sessions (provider_id, model_user_id, model_id, date,
--                                  start_time, end_time, treatment_id, status)
--     select t.provider_id, p.user_id, p.user_id, current_date - 7,
--            '09:00', '10:00', t.id, 'completed'
--     from t, p;
--
--     delete from public.provider_treatments where name = '__verify_0013c';
--     select count(*) as should_be_zero from public.provider_treatments
--      where name = '__verify_0013c';
--   rollback;
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
--
-- Apply, verify, THEN run this. Needs SUPABASE_SERVICE_ROLE_KEY in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
-- ===========================================================================
