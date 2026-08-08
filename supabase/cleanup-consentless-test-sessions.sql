-- ===========================================================================
-- cleanup-consentless-test-sessions.sql — 8 Aug 2026, one-off
--
-- Removes bookings made before consent capture existed. All of them are test
-- data: Micky's own account, or disposable-mail addresses used for testing.
--
-- WHY NOW
--   Consent capture went live on 8 Aug. Every session created before it has no
--   session_consents row and never will — nobody actually agreed to anything,
--   so there is nothing to backfill and backfilling would be fabrication.
--
--   Left in place they would pollute counts and, in a few months, get reasoned
--   about as real bookings. That is exactly what happened with the seed rows:
--   they outlived their purpose and became something to explain.
--
-- NOT A MIGRATION
--   Deliberately in supabase/, not supabase/migrations/. It changes no schema —
--   it is a one-time data cleanup against a specific set of test rows. The
--   migrations table records structural change; recording a data tidy there
--   would blur what it is for.
--
-- THE SELECTION RULE
--   "Sessions with no consent record." That excludes today's session
--   19c47ffa automatically, because it HAS one — no hardcoded id to get wrong,
--   and the rule stays correct as more real bookings appear.
--
-- SAFETY
--   Runs as ONE transaction. Ordered deletes clear every reference before the
--   sessions themselves. A guard aborts before touching anything if any
--   consent-less session belongs to an account outside the known test set, and
--   a final check aborts if any survive. Partial success is not a possible
--   outcome — the same discipline teardown.mjs now has.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. GUARD. Abort if anything outside the known test set would be caught.
--    Stated as fact by Micky; verified here anyway, because a claim that is
--    only checked by the person making it is not checked.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unexpected int;
  v_sample     text;
begin
  select count(*),
         string_agg(distinct coalesce(u.email, '(no user row)'), ', ')
    into v_unexpected, v_sample
  from public.sessions s
  left join public.users u on u.id = s.model_user_id
  where not exists (select 1 from public.session_consents c where c.session_id = s.id)
    and coalesce(u.email, '') not ilike '%@besteya.com'
    and coalesce(u.email, '') not ilike '%@bevriz.com'
    and coalesce(u.email, '') not ilike 'micky.buckfield@%';

  if v_unexpected > 0 then
    raise exception
      'ABORT: % consent-less session(s) belong to accounts outside the test set: %',
      v_unexpected, v_sample;
  end if;

  raise notice 'guard passed: every consent-less session belongs to a known test account';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The set, resolved once so every delete below targets the same rows.
-- ---------------------------------------------------------------------------
create temp table _doomed on commit drop as
select s.id
from public.sessions s
where not exists (select 1 from public.session_consents c where c.session_id = s.id);

do $$
declare n int;
begin
  select count(*) into n from _doomed;
  raise notice 'removing % consent-less session(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Ordered deletes. Every reference cleared before the sessions themselves.
--    admin_audit_log keeps its rows — only the pointer is dropped, so the
--    record of what admins did outlives the bookings it referred to.
-- ---------------------------------------------------------------------------
update public.admin_audit_log set target_session_id = null
 where target_session_id in (select id from _doomed);

delete from public.notifications where session_id in (select id from _doomed);
delete from public.reports       where session_id in (select id from _doomed);
delete from public.messages      where session_id in (select id from _doomed);
delete from public.reviews       where session_id in (select id from _doomed);
delete from public.sessions      where id         in (select id from _doomed);

-- ---------------------------------------------------------------------------
-- 4. Prove it, rather than assume it. Aborts the whole transaction if any
--    consent-less session survived — a partial clean is a failed clean.
-- ---------------------------------------------------------------------------
do $$
declare v_left int; v_total int; v_consents int;
begin
  select count(*) into v_left
    from public.sessions s
   where not exists (select 1 from public.session_consents c where c.session_id = s.id);

  if v_left > 0 then
    raise exception 'ABORT: % consent-less session(s) still present after cleanup', v_left;
  end if;

  select count(*) into v_total    from public.sessions;
  select count(*) into v_consents from public.session_consents;
  raise notice 'done: % session(s) remain, % consent record(s) — every session now has one',
    v_total, v_consents;
end $$;

commit;
