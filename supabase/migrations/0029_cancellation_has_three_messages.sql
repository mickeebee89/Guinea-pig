-- ===========================================================================
-- 0029_cancellation_has_three_messages
--
-- Cancelling a booking becomes a thing the product does, and the three ways it
-- can happen get three different messages from one place.
--
-- ⚠️ Apply 0014 first.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────
-- `enforce_session_status_transition` has always PERMITTED either participant to
-- cancel. Nothing has ever offered it: `session_cancelled` has exactly two
-- writers in the whole product and both are the block cascade. So "I need to
-- cancel my booking" — which happens in week one — has no path at all, while
-- the database has been ready for it the whole time.
--
-- ── WHY THE MESSAGES LIVE HERE AND NOT IN THE CLIENTS ───────────────────
-- Three events, three messages, and they must not converge:
--
--   block       a block cascaded the booking away. The recipient does not know
--               a block happened and MUST NOT learn it here.
--   by_stylist  the stylist cancelled. Actor named, optional reason.
--   by_model    the model cancelled. Actor named, optional reason.
--
-- The block wording is the fragile one. It is the only message of the three
-- that already exists, its silence is load-bearing, and it is the one that reads
-- as most deficient — so a shared helper is EXACTLY where someone tidies it by
-- "adding a reason for consistency". Writing all three in one function with the
-- constraint stated beside them is the point: the next person meets the reason
-- before they meet the temptation.
--
-- ── WHAT THE BLOCK MESSAGE DELIBERATELY DOES NOT SAY ────────────────────
-- Not the cause, and NOT "we can't explain why" either.
--
-- The second is the subtler error. It implies an institutional judgement that
-- did not happen: the platform decided nothing, a person did. Saying "we can't
-- share why" invites the reader to imagine a decision, a file, a finding —
-- when the truth is that someone they know chose not to see them any more, and
-- that is not ours to hint at.
--
-- Same lesson as 0028, one step further. There, a sentence defending the
-- silence drew attention to it. Here, defending it would also be untrue.
--
-- ── RECORDED, NOT SURFACED ──────────────────────────────────────────────
-- Who cancelled, when, and why are stored on the session. Nothing displays them
-- yet and nothing should without a decision. A stylist who cancels often is a
-- reliability problem models cannot see, and that judgement needs care — but the
-- data is free to keep now and impossible to reconstruct later.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — what exists before this runs.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0029', 'sessions_status_' || coalesce(status, 'null'), count(*)::text
from public.sessions group by status;

-- ---------------------------------------------------------------------------
-- ASSERT — the columns must not already exist with a different meaning.
-- ---------------------------------------------------------------------------
do $$
declare v_clash text;
begin
  select string_agg(column_name, ', ')
    into v_clash
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sessions'
    and column_name in ('cancelled_by', 'cancelled_at', 'cancellation_reason');

  if v_clash is not null then
    raise notice '0029: sessions already has %; add column if not exists will leave them alone.', v_clash;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Record who, when and why.
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists cancelled_by        uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancellation_reason text;

alter table public.sessions drop constraint if exists sessions_cancellation_reason_len;
alter table public.sessions add constraint sessions_cancellation_reason_len
  check (cancellation_reason is null or length(cancellation_reason) <= 280);

comment on column public.sessions.cancelled_by is
  'Who cancelled. NULL for a block cascade — deliberately, because storing the '
  'blocker here would put "who blocked whom" one query away from any surface that '
  'ever renders this column. ON DELETE SET NULL so the record outlives the account.';
comment on column public.sessions.cancellation_reason is
  'Free text from one user, shown to another. UGC: treat as untrusted, render as '
  'text, never as markup. Capped at 280. NULL for a block cascade.';

-- ---------------------------------------------------------------------------
-- 2. THE THREE MESSAGES. One function. Read the block case before editing it.
-- ---------------------------------------------------------------------------
create or replace function public.cancellation_notice(
  p_kind       text,          -- 'block' | 'by_stylist' | 'by_model'
  p_other_name text,
  p_date       date,
  p_reason     text default null
) returns table (title text, body text)
-- STABLE, not IMMUTABLE: to_char() on a date depends on lc_time.
language plpgsql stable
as $$
declare
  v_when text := to_char(p_date, 'FMDD FMMonth');
  v_who  text := coalesce(nullif(btrim(coalesce(p_other_name, '')), ''), 'your stylist');
  v_said text := case
                   when nullif(btrim(coalesce(p_reason, '')), '') is null then ''
                   else chr(10) || chr(10) || 'They said: "' || btrim(p_reason) || '"'
                 end;
begin
  if p_kind = 'block' then
    -- ⚠️ DO NOT ADD A REASON TO THIS ONE, AND DO NOT ADD "we can't explain why".
    --
    -- The recipient does not know a block happened and must not learn it from a
    -- notification. Any hint of cause narrows it to one person.
    --
    -- "We can't share why" is also wrong here, and not only for being coy: the
    -- platform did not decide anything. A person did. Implying an institutional
    -- judgement invites the reader to picture a file and a finding that do not
    -- exist. Silence about cause is the honest answer, not a withheld one.
    --
    -- It gains a date and a route over the line it replaces and nothing else.
    return query select
      'Your booking on ' || v_when || ' has been cancelled',
      'Your booking with ' || v_who || ' won''t be going ahead. Nothing about your '
      || 'account has changed.' || chr(10) || chr(10)
      || 'You can find another stylist in Browse.';

  elsif p_kind = 'by_stylist' then
    return query select
      v_who || ' cancelled your booking on ' || v_when,
      v_who || ' can no longer make this appointment.' || v_said || chr(10) || chr(10)
      || 'That slot has been released. You can apply to another stylist in Browse.';

  elsif p_kind = 'by_model' then
    return query select
      v_who || ' cancelled their booking on ' || v_when,
      'That slot is free again and back on your calendar.' || v_said;

  else
    raise exception 'cancellation_notice: unknown kind %', p_kind;
  end if;
end $$;

comment on function public.cancellation_notice(text, text, date, text) is
  'The only place the three cancellation messages are written. They must not '
  'converge: the block case is silent about cause on purpose and adding a reason '
  '"for consistency" would leak who blocked whom.';

-- ---------------------------------------------------------------------------
-- 3. A participant cancels.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(
  p_session_id uuid,
  p_reason     text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me         uuid := auth.uid();
  v_s          record;
  v_is_model   boolean;
  v_other      uuid;
  v_other_name text;
  v_my_name    text;
  v_notice     record;
  v_reason     text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_me is null then
    raise exception 'cancel_booking: not signed in';
  end if;

  select s.id, s.status, s.date, s.model_user_id, s.provider_id
    into v_s
  from public.sessions s where s.id = p_session_id;

  if v_s.id is null then
    raise exception 'cancel_booking: booking not found';
  end if;
  if v_s.status not in ('pending', 'accepted') then
    raise exception 'cancel_booking: this booking is already %', v_s.status;
  end if;

  v_is_model := (v_s.model_user_id = v_me);
  if not v_is_model and not exists (
    select 1 from public.providers p where p.id = v_s.provider_id and p.user_id = v_me
  ) then
    raise exception 'cancel_booking: not a participant of this booking';
  end if;

  if v_reason is not null and length(v_reason) > 280 then
    v_reason := left(v_reason, 280);
  end if;

  -- Who to tell, and what to call the person who cancelled.
  if v_is_model then
    select p.user_id, p.name into v_other, v_other_name
    from public.providers p where p.id = v_s.provider_id;
    select nullif(btrim(coalesce(u.first_name, '')), '') into v_my_name
    from public.users u where u.id = v_me;
  else
    v_other := v_s.model_user_id;
    select nullif(btrim(coalesce(u.first_name, '')), '') into v_my_name
    from public.users u where u.id = v_me;
    select p.name into v_other_name from public.providers p where p.id = v_s.provider_id;
  end if;

  update public.sessions
     set status = 'cancelled',
         cancelled_by = v_me,
         cancelled_at = now(),
         cancellation_reason = v_reason
   where id = p_session_id;

  -- The name in the message is the CANCELLER's, because the message tells the
  -- other party who cancelled on them.
  select * into v_notice from public.cancellation_notice(
    case when v_is_model then 'by_model' else 'by_stylist' end,
    coalesce(v_my_name, case when v_is_model then 'The model' else v_other_name end),
    v_s.date, v_reason);

  if v_other is not null then
    insert into public.notifications (user_id, type, title, body, session_id)
    values (v_other, 'session_cancelled', v_notice.title, v_notice.body, p_session_id);
  end if;

  -- One transaction: the status change and the telling cannot come apart.
  return jsonb_build_object('ok', true, 'session_id', p_session_id,
                            'notified', v_other is not null);
end $$;

revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant  execute on function public.cancel_booking(uuid, text) to authenticated;

comment on function public.cancel_booking(uuid, text) is
  'Cancel a booking you are party to. Records who/when/why, and notifies the other '
  'party in the same transaction so a cancellation can never happen silently. No '
  'time cut-off, deliberately: a hard limit stops the person who most needs out, '
  'which is the same asymmetry as the revocation default. The client warns instead.';

-- ---------------------------------------------------------------------------
-- 4. The block cascade, moved server-side.
--
-- It was two statements in each client — update, then insert notifications —
-- so a failure between them cancelled bookings and told nobody. Now one
-- transaction, and it takes its wording from the same function as the other two.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sessions_for_block(p_other_user_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_me      uuid := auth.uid();
  v_count   int  := 0;
  v_sess    record;
  v_notice  record;
  v_name    text;
begin
  if v_me is null then
    raise exception 'cancel_sessions_for_block: not signed in';
  end if;

  for v_sess in
    select s.id, s.date, s.model_user_id, s.provider_id
    from public.sessions s
    where s.status in ('pending', 'accepted')
      and (
        (s.model_user_id = p_other_user_id
          and exists (select 1 from public.providers p
                       where p.id = s.provider_id and p.user_id = v_me))
        or
        (s.model_user_id = v_me
          and exists (select 1 from public.providers p
                       where p.id = s.provider_id and p.user_id = p_other_user_id))
      )
  loop
    -- cancelled_by stays NULL: recording the blocker here would put "who blocked
    -- whom" one query away from anything that ever renders the column.
    update public.sessions
       set status = 'cancelled', cancelled_at = now()
     where id = v_sess.id;
    v_count := v_count + 1;

    select nullif(btrim(coalesce(p.name, '')), '') into v_name
    from public.providers p where p.id = v_sess.provider_id;

    select * into v_notice
    from public.cancellation_notice('block', v_name, v_sess.date, null);

    insert into public.notifications (user_id, type, title, body, session_id)
    values (p_other_user_id, 'session_cancelled', v_notice.title, v_notice.body, v_sess.id);
  end loop;

  return jsonb_build_object('ok', true, 'cancelled', v_count);
end $$;

revoke execute on function public.cancel_sessions_for_block(uuid) from public, anon;
grant  execute on function public.cancel_sessions_for_block(uuid) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0029', 'cancellation_has_three_messages', 'c3a3550902d2ced4dee9635e4bf696f9c02787e661b8f35217ce33d57e0fe0a1');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Written for the Supabase SQL editor: one
-- self-contained statement per check; guards satisfied where they apply; and
-- matching the message, not the commentary about it.
--
-- ── BLOCK A — the three messages, side by side ──────────────────────────
--
--   Read them together. This is the check that they have not converged.
--
--   select kind, n.title, n.body from (
--     values ('block'), ('by_stylist'), ('by_model')
--   ) k(kind), lateral public.cancellation_notice(
--     k.kind, 'Sam', current_date + 12, 'car trouble, so sorry') n;
--
--   Expect: 'block' shows NO reason even though one was passed — that argument
--   is ignored for that kind, by design. The other two include it.
--
--   ⚠️ If 'block' ever renders the reason, someone has tidied the three into one
--   template and a blocked person can now infer who blocked them.
--
-- ── BLOCK B — the block wording says nothing about cause ────────────────
--
--   select body ~* '(reason|why|because|explain|cancelled by|blocked)' as leaks_cause
--   from public.cancellation_notice('block', 'Sam', current_date + 12, null);
--
--   Expect false. Deliberately includes 'why' and 'explain': "we can't explain
--   why" is as wrong here as naming the cause, because the platform decided
--   nothing and implying otherwise invents a judgement.
--
-- ── BLOCK C — a real cancel, rolled back ────────────────────────────────
--
--   Needs a participant's auth.uid(), not an admin's — cancel_booking is gated
--   on being party to the booking. Copy a live session id and the id of one of
--   its participants.
--
--     select s.id as session_id, s.model_user_id, s.date, p.user_id as stylist_user_id
--     from public.sessions s join public.providers p on p.id = s.provider_id
--     where s.status in ('pending','accepted') and s.date >= current_date limit 5;
--
--   begin;
--     set local request.jwt.claims = '{"sub":"<PASTE-PARTICIPANT-USER-ID>","role":"authenticated"}';
--     select auth.uid() as acting_as;
--     select public.cancel_booking('<PASTE-SESSION-ID>'::uuid, 'Verify block C');
--     select status, cancelled_by is not null as recorded, cancellation_reason
--       from public.sessions where id = '<PASTE-SESSION-ID>'::uuid;
--     select title, body from public.notifications
--      where session_id = '<PASTE-SESSION-ID>'::uuid order by created_at desc limit 1;
--   rollback;
--
-- ── BLOCK D — a non-participant cannot cancel ───────────────────────────
--
--   begin;
--     set local request.jwt.claims = '{"sub":"ff06d568-8936-45fa-ad5f-0b88c150ec30","role":"authenticated"}';
--     select public.cancel_booking('<A-SESSION-MICKY-IS-NOT-IN>'::uuid, 'should refuse');
--   rollback;
--
--   Expect 'not a participant of this booking'. Note admins are NOT exempt here:
--   an admin cancelling someone's booking is a different act and should have its
--   own path if it is ever wanted.
--
-- ── BLOCK E — the slot frees itself ─────────────────────────────────────
--
--   Availability is DERIVED from session status (booking-guard.sql: "the slot
--   re-opens once its booking ends"), so there is no is_taken bookkeeping to
--   get wrong. Confirm inside Block C's transaction, before the rollback:
--
--     select * from public.taken_slots('<PROVIDER-ID>'::uuid);
--
--   The cancelled slot must be absent.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================
