-- ===========================================================================
-- 0027_revoke_verification
--
-- Verification becomes reversible, with a reason, an audit row, and the safe
-- outcome as the default rather than the option.
--
-- ⚠️ Apply 0014 and 0026 first. 0026 adds the enum label this file uses, and
-- the label cannot be added and used in the same transaction.
--
-- ── THE GAP ──────────────────────────────────────────────────────────────
-- `users.is_verified` is set true in two places in the admin console and false
-- NOWHERE in the product. Verification is one-way: a mistaken approval, a fraud
-- finding, or an account that later proves to be someone else has no remedy but
-- an UPDATE typed by hand.
--
-- ── THE DEFAULT IS THE SAFE ONE ──────────────────────────────────────────
-- Revoking cancels the stylist's future bookings. There is no override, and the
-- asymmetry is why: cancel wrongly and somebody rebooks; leave a booking
-- standing wrongly and somebody meets a person the platform has just decided it
-- cannot vouch for. The recoverable mistake is the one to make.
--
-- ── THE TRIGGER THAT SOUNDS LIKE IT ALREADY DOES THIS ────────────────────
-- `enforce_publish_requires_verified` does NOT enforce "published implies
-- verified". It fires only when a statement sets `is_published` true, so it is
-- a gate on one transition — and it is on `providers`, while `is_verified` lives
-- on `users`, so clearing verification cannot fire it whatever it checked.
--
-- Evidence: the manual resets during this audit left a shop published while
-- unverified, the same published-but-invalid state as the six blank providers.
--
-- The name is the fourth in this project to promise more than it does, after
-- `provider_profile_is_complete`. It is not renamed — it is accurate about what
-- it does at publish time — but it now carries a comment saying what it does
-- not do, and a SECOND trigger closes the actual invariant. The name is what
-- the next person will trust, so the correction goes where the name is.
--
-- ── target_name / target_email_hash BECOME NOT NULL ──────────────────────
-- They are nullable here and NOT NULL on `reports`, where 0004 made them so
-- precisely because a subject's history must not be able to read zero.
--
-- The same reasoning applies and the machinery is already identical:
-- `trg_moderation_subject` fills both before insert, the same shape as
-- `trg_report_subjects`. `target_email_hash` is documented as the ban-evasion
-- signal, and a nullable ban-evasion signal is one that can be absent exactly
-- when somebody deletes and re-registers.
--
-- This is the moment to settle it because the revoke path below is this table's
-- FIRST WRITER. Nothing has ever inserted a moderation action: the admin console
-- writes notifications, suspensions and admin_audit_log instead. So the table is
-- empty, the constraint is free, and it will be true of every row there ever is.
--
-- The trade: if `public.users` has no row for the target, the trigger fills
-- nothing and the insert is refused. That is intended — an unattributable
-- moderation action is not worth recording, and it fails loudly rather than
-- silently storing a record nobody can later match to a person.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — this table's real shape, which is not in the repo.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0027', 'column_' || lpad(ordinal_position::text, 2, '0') || '_' || column_name,
       data_type || ' | nullable=' || is_nullable || ' | default=' || coalesce(column_default, 'NONE')
from information_schema.columns
where table_schema = 'public' and table_name = 'moderation_actions';

insert into public.migration_findings (version, item, value)
select '0027', 'existing_rows', count(*)::text from public.moderation_actions;

-- ---------------------------------------------------------------------------
-- ASSERT 1 — every column this migration writes must actually exist.
--
-- 0023 created a function against a table it had never read. This is the cheap
-- version of not doing that again: name the columns, and refuse if any is
-- missing rather than failing later inside the function.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(c, ', ')
    into v_missing
  from unnest(array['admin_id', 'target_user_id', 'action', 'reason']) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'moderation_actions'
      and column_name = c
  );

  if v_missing is not null then
    raise exception
      '0027: moderation_actions is missing column(s) this migration writes: %. '
      'The real column list is in migration_findings for version 0027 — read it and '
      'adjust revoke_verification() to match.', v_missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ASSERT 2 — the enum label from 0026 must be present.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.moderation_action_type'::regtype
      and enumlabel = 'revoke_verification'
  ) then
    raise exception '0027: enum label revoke_verification is missing. Apply 0026 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The identity columns become mandatory.
-- ---------------------------------------------------------------------------
update public.moderation_actions ma
set target_name = coalesce(ma.target_name, u.first_name),
    target_email_hash = coalesce(
      ma.target_email_hash,
      encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex'))
from public.users u
where u.id = ma.target_user_id
  and (ma.target_name is null or ma.target_email_hash is null);

alter table public.moderation_actions alter column target_email_hash set not null;

comment on column public.moderation_actions.target_email_hash is
  'SHA-256 of lower(email), filled by trg_moderation_subject before insert. NOT NULL '
  'since 0027, matching reports: the durable identity must not be able to read zero, '
  'because it is also the ban-evasion signal and would otherwise be absent exactly '
  'when someone deletes and re-registers. Free to enforce because 0027 introduced '
  'this table''s first writer and it was empty until then.';

-- ---------------------------------------------------------------------------
-- 2. The comment on the misleading name.
-- ---------------------------------------------------------------------------
comment on function public.enforce_publish_requires_verified() is
  'GATE ON ONE TRANSITION, NOT AN INVARIANT. Fires only when a statement sets '
  'providers.is_published true, and lives on providers while is_verified lives on '
  'users — so clearing verification does NOT fire it and never could. It does not '
  'enforce "published implies verified" despite reading that way; '
  'trg_unpublish_on_verification_lost (0027) is what closes that. Left named as it '
  'is because it is accurate about what it does at publish time.';

-- ---------------------------------------------------------------------------
-- 3. The invariant the name implies: losing verification unpublishes.
--
-- Catches the RPC below, an admin editing by hand, and anything written later
-- that forgets. A trigger, because the guarantee should not depend on every
-- future caller remembering.
-- ---------------------------------------------------------------------------
create or replace function public.unpublish_on_verification_lost()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.is_verified is true and new.is_verified is not true then
    update public.providers set is_published = false
     where user_id = new.id and is_published is true;
  end if;
  return new;
end $$;

revoke all on function public.unpublish_on_verification_lost() from public, anon;

drop trigger if exists trg_unpublish_on_verification_lost on public.users;
create trigger trg_unpublish_on_verification_lost
  after update of is_verified on public.users
  for each row execute function public.unpublish_on_verification_lost();

-- ---------------------------------------------------------------------------
-- 4. Revocation.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_verification(
  p_user_id uuid,
  p_reason  text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin      uuid := auth.uid();
  v_cancelled  int  := 0;
  v_sess       record;
  v_name       text;
begin
  if not public.is_admin() then
    raise exception 'revoke_verification is admin-only';
  end if;

  -- A reason is mandatory and is not a formality: this removes someone's
  -- ability to trade, and "an admin decided to" is not a record.
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'revoke_verification needs a reason of at least 10 characters';
  end if;

  select nullif(btrim(coalesce(name, '')), '') into v_name
  from public.providers where user_id = p_user_id limit 1;

  -- Clear verification. The trigger above unpublishes as a consequence, so
  -- this cannot leave a published-but-unverified shop.
  update public.users set is_verified = false where id = p_user_id;

  -- Let them resubmit: with no verification_requests row, /verify already
  -- offers the submit path. No new surface needed.
  delete from public.verification_requests where user_id = p_user_id;

  -- Cancel future bookings, and tell each model. NO OVERRIDE, on purpose:
  -- cancel wrongly and somebody rebooks; leave one standing wrongly and
  -- somebody meets a person we have just decided we cannot vouch for.
  for v_sess in
    select s.id, s.model_user_id, s.date
    from public.sessions s
    join public.providers p on p.id = s.provider_id
    where p.user_id = p_user_id
      and s.status in ('pending', 'accepted')
      and s.date >= current_date
  loop
    update public.sessions set status = 'cancelled' where id = v_sess.id;
    v_cancelled := v_cancelled + 1;

    insert into public.notifications (user_id, type, title, body, session_id)
    values (
      v_sess.model_user_id,
      'session_cancelled',
      'Your booking on ' || to_char(v_sess.date, 'FMDD FMMonth') || ' has been cancelled',
      -- Written to be true without saying what is not ours to publish. It says
      -- who decided, that the model did nothing, that we will not explain, and
      -- how to raise a concern of their own — and it asserts nothing about the
      -- stylist's conduct in either direction.
      'We''ve cancelled your booking with ' || coalesce(v_name, 'your stylist') ||
      '. This was our decision, not theirs and not yours — they can''t take bookings ' ||
      'on Cavy at the moment.' || chr(10) || chr(10) ||
      'We''re not able to explain why, and we''d rather say that plainly than imply ' ||
      'something we haven''t said. Nothing about your account has changed, and this ' ||
      'isn''t a mark against you.' || chr(10) || chr(10) ||
      'If anything about this stylist has worried you, you can report it from their ' ||
      'profile — that reaches us whether or not they''re still on Cavy.' || chr(10) || chr(10) ||
      'Sorry for the disruption. You can find another stylist in Browse.',
      v_sess.id
    );
  end loop;

  -- The audit row, last, so it records what actually happened.
  insert into public.moderation_actions (admin_id, target_user_id, action, reason)
  values (v_admin, p_user_id, 'revoke_verification', btrim(p_reason));

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'cancelled_bookings', v_cancelled
  );
end $$;

comment on function public.revoke_verification(uuid, text) is
  'Admin-only. Clears users.is_verified, unpublishes via '
  'trg_unpublish_on_verification_lost, deletes the verification_requests row so the '
  'account can resubmit, cancels every future pending/accepted booking with a '
  'notification to each model, and records a moderation_actions row. One '
  'transaction: a failure anywhere leaves none of it done. There is deliberately no '
  '"keep the bookings" option — cancelling wrongly is recoverable, leaving a booking '
  'standing wrongly is not.';

revoke execute on function public.revoke_verification(uuid, text) from public, anon;
grant  execute on function public.revoke_verification(uuid, text) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0027', 'revoke_verification', 'b5c39c21535d6e005fa2e788ea8eb8ab058ea6bbb69fc6ad328886f58713115c');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Written for the Supabase SQL editor: one
-- self-contained statement per check, no temp tables, no session state.
--
-- ── BLOCK A — a reason is mandatory ─────────────────────────────────────
--
--   begin;
--     select public.revoke_verification(
--       '517c2853-50bb-4e8f-87fe-d79311bc37c0'::uuid, 'too short');
--   rollback;
--
--   Expect: needs a reason of at least 10 characters.
--
-- ── BLOCK B — the invariant, on a hand edit rather than the RPC ─────────
--
--   This is the one enforce_publish_requires_verified could never do.
--
--   begin;
--     update public.users set is_verified = true where id = '<PROVIDER-USER-ID>';
--     update public.providers set is_published = true where user_id = '<PROVIDER-USER-ID>';
--     update public.users set is_verified = false where id = '<PROVIDER-USER-ID>';
--     select is_published from public.providers where user_id = '<PROVIDER-USER-ID>';
--   rollback;
--
--   Expect is_published false. Before 0027 it stayed true, which is the
--   published-but-invalid state the six blank providers were in.
--
-- ── BLOCK C — a full revoke, rolled back ────────────────────────────────
--
--   Paste the provider's USER id (not providers.id) in both places.
--
--   begin;
--     select public.revoke_verification(
--       '<PASTE-USER-ID>'::uuid, 'Verify block C - rolled back, not a real revocation');
--     select is_verified from public.users where id = '<PASTE-USER-ID>';
--     select status, count(*) from public.sessions s
--       join public.providers p on p.id = s.provider_id
--      where p.user_id = '<PASTE-USER-ID>' group by status;
--     select action, reason, target_name, target_email_hash is not null as has_hash
--       from public.moderation_actions order by created_at desc limit 1;
--   rollback;
--
--   Expect is_verified false, future bookings cancelled, and ONE moderation row
--   with a non-null hash — the NOT NULL and the trigger that fills it working
--   together on this table's first ever row.
--
-- ── BLOCK D — read the notification a stranger actually gets ────────────
--
--   Inside the same rolled-back transaction as Block C, before the rollback:
--
--     select title, body from public.notifications
--      where type = 'session_cancelled' order by created_at desc limit 1;
--
--   Read it as the model, not as the person who wrote it. It should say what
--   happened, that it was our decision, that we will not explain, and how to
--   raise a concern — and nothing about the stylist's conduct either way.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================
