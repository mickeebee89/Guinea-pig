-- ===========================================================================
-- 0028_revocation_notice_says_less
--
-- One sentence removed from the revocation notice. Nothing else changes.
--
-- ⚠️ Apply 0027 first.
--
-- ── WHAT WENT ───────────────────────────────────────────────────────────
--   "We're not able to explain why, and we'd rather say that plainly than
--    imply something we haven't said."
--
-- becomes
--
--   "We're not able to explain why."
--
-- ── WHY ─────────────────────────────────────────────────────────────────
-- The removed half was the AUTHOR'S REASONING, printed inside the message. It
-- explains our editorial position to someone who did not ask for it and is not
-- in a state to care: a model reading, unprompted, that a booking with a
-- stranger is off.
--
-- "We're not able to explain why" is stronger standing alone. Adding a defence
-- of the silence draws attention to the silence, and a reader who was not
-- suspicious now has a sentence inviting them to wonder what we are not saying.
--
-- Worth naming as a category, because it is easy to write again: notes-to-self
-- that reach the user. The code comment explaining a decision belongs in the
-- code; it does not belong in the notification, and the two were written at the
-- same moment by the same person, which is how it got there.
--
-- The rest of the wording stands as reviewed: who decided, that the model did
-- nothing, that we will not explain, how to raise a concern of their own, and
-- nothing about the stylist's conduct in either direction.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the function must exist and be the one 0027 created.
--
-- create or replace on a function that does not exist would silently create a
-- new one, which is not what this migration is for.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'revoke_verification'
  ) then
    raise exception '0028: public.revoke_verification does not exist. Apply 0027 first.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'revoke_verification'
      and pg_get_functiondef(p.oid) like '%rather say that plainly%'
  ) then
    raise notice '0028: the sentence being removed is already absent - nothing to change, '
                 'but the function is replaced anyway so the definition is known.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The function, identical to 0027 apart from the notification body.
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

  -- Clear verification. trg_unpublish_on_verification_lost unpublishes as a
  -- consequence, so this cannot leave a published-but-unverified shop.
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
      -- True without saying what is not ours to publish: who decided, that the
      -- model did nothing, that we will not explain, and how to raise a concern
      -- of their own. Nothing about the stylist's conduct in either direction.
      --
      -- 0028 removed "and we'd rather say that plainly than imply something we
      -- haven't said" — the author's reasoning, printed to a reader who did not
      -- ask for it. Defending the silence draws attention to the silence.
      'We''ve cancelled your booking with ' || coalesce(v_name, 'your stylist') ||
      '. This was our decision, not theirs and not yours — they can''t take bookings ' ||
      'on Cavy at the moment.' || chr(10) || chr(10) ||
      'We''re not able to explain why. Nothing about your account has changed, and ' ||
      'this isn''t a mark against you.' || chr(10) || chr(10) ||
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

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0028', 'revocation_notice_says_less', '0cf8ea5ef3dbcb95bc25e0244797e6144fc9d4c0d60c1008a17e4519c07b9270');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- Same admin-claim shape as 0027's blocks: is_admin() gates this function, so a
-- block that does not satisfy that guard tests nothing but the guard.
--
-- ── BLOCK A — the sentence is gone from the BODY, not just somewhere ──
--
-- ⚠️ THE FIRST VERSION OF THIS BLOCK REPORTED A FALSE FAILURE, and the way it
-- failed is worth keeping. It matched `%rather say that plainly%` against
-- pg_get_functiondef(), which returns the WHOLE definition — including the
-- comment above the notification explaining that the sentence was removed.
--
-- So the check said the sentence was still present. The cut had worked. What it
-- had actually found was its own documentation: THE ARTEFACT OF THE FIX BROKE
-- THE TEST FOR THE FIX.
--
-- Fifth block this month reporting something other than what it claims, and the
-- cleanest example of the shape. A check must distinguish the thing from the
-- commentary about the thing. Recorded in scripts/migration-status.mjs.
--
-- Two INDEPENDENT discriminators below, because either alone could be fooled:
--
--   code_*  strips every `--` comment line before matching. Safe here because
--           the body contains no `--` sequence of its own (em dashes are a
--           different character), but it would need care in a function whose
--           strings did.
--
--   lit_*   matches the DOUBLED apostrophe `we''d`, which only ever appears
--           inside a SQL string literal. A comment writes `we'd` with one. This
--           discriminates on syntax rather than on position, so it holds even
--           if the comment is reworded or moved.
--
-- One statement, no impersonation needed: it reads the stored definition rather
-- than calling the function.
--
--   select
--     regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
--       like '%rather say that plainly%'                    as code_has_old,
--     regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
--       like '%not able to explain why. Nothing about%'     as code_has_new,
--     pg_get_functiondef(p.oid) like '%we''''d rather say that plainly%'
--                                                          as lit_has_old,
--     pg_get_functiondef(p.oid) like '%rather say that plainly%'
--                                                          as anywhere_incl_comments
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'revoke_verification';
--
--   Expect:  code_has_old  false
--            code_has_new  true
--            lit_has_old   false
--            anywhere_incl_comments  TRUE — and that is correct, not a failure.
--                It is the comment above the body describing the removal. It is
--                selected deliberately so the column that fooled the first
--                version is visible beside the ones that do not.
--
-- ── BLOCK B — read it as the model again ────────────────────────────────
--
--   begin;
--     set local request.jwt.claims = '{"sub":"ff06d568-8936-45fa-ad5f-0b88c150ec30","role":"authenticated"}';
--     select public.is_admin() as must_be_true;
--     select public.revoke_verification(
--       '<PASTE-USER-ID>'::uuid, 'Verify 0028 block B - rolled back, not a real revocation');
--     select body from public.notifications
--      where type = 'session_cancelled' order by created_at desc limit 1;
--   rollback;
--
--   Needs the provider to have a future pending/accepted booking, or there is
--   nobody to notify and this returns nothing — which is not a failure.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================
