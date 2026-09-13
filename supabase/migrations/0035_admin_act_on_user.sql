-- ===========================================================================
-- 0035_admin_act_on_user
--
-- One transaction for a moderation decision and the record of it.
--
-- ── WHY (audit items 27 and 29) ─────────────────────────────────────────
-- `admin/app/users/page.tsx` performed the state change and then called
-- logAction() unconditionally, so a suspension RLS refused was written into
-- admin_audit_log as having happened. That was fixed on 8 Sep by checking the
-- write first — but the two writes are still separate, so the action can land
-- and the audit insert fail, leaving an action in force with nothing saying who
-- did it or why. admin_audit_log is retained six years as the evidence for a
-- ban (0005, 0006).
--
-- The precedent is exact: apply_subscription_state (0023–0025) exists so
-- users.subscription_status and subscriptions cannot disagree, and no caller is
-- allowed to write either table directly. Same argument, on the evidence trail.
--
-- ── ⚠️ THESE THREE SENTENCES ARE WHY THIS EXISTS ────────────────────────
-- They are already in the product, in admin/app/verification/page.tsx, written
-- by someone who understood the shape of the problem exactly and mitigated it in
-- copy because there was nowhere else to put it:
--
--   :81  "Couldn't verify this user: {err}\n\nNothing else was changed."
--
--   :87  "The user was verified, but their shop could not be published: {err}
--         \n\nThe request has been left pending — try again."
--
--   :97  "This user is verified{ and published}, but the request could not be
--         closed: {err}\n\nIt will still show as pending — approve it again to
--         clear it."
--
-- Only the first describes a clean failure. The second and third describe states
-- where the system is HALF CHANGED, and they exist because the code cannot
-- prevent them. That is the design admitting in prose that it cannot be
-- consistent. (Those routes are covered by a later migration — see SCOPE.)
--
-- ── SCOPE: ONE FUNCTION, AND WHY NOT FIVE ───────────────────────────────
-- Item 29 scoped five functions. This migration writes ONE, because the columns
-- for the other four have not been read out of the database yet:
--
--   admin_act_on_report        needs public.reports
--   admin_decide_status_post   needs public.status_posts
--   admin_act_on_provider      needs public.portfolio_items
--   admin_decide_verification  needs public.notifications
--   'warn' on this function    needs public.notifications — see below
--
-- 0023 guessed at a table's columns twice and hit a NOT NULL both times; 0024
-- was the migration that stopped guessing. Writing four functions against files
-- rather than against the database would repeat that exactly.
--
-- ⚠️ NO CLIENT IS REPOINTED UNTIL ALL FIVE EXIST. The seam item 29 warns about
-- is created by repointing some surfaces and not others, not by landing the
-- functions in more than one migration. Nothing calls this yet.
--
-- ── ⚠️ 'warn' IS DELIBERATELY NOT HANDLED HERE, AND IT REVISITS A SETTLED
--      DECISION ───────────────────────────────────────────────────────────
-- Item 29 settled that notifications sit OUTSIDE the transaction, because a
-- failed notification must not roll back a ban. That is right for every action
-- except one.
--
-- For 'warn' there IS no state change. The notification IS the action. Sending
-- it outside the transaction would mean an audit row reading "warned" for a
-- warning that was never delivered — the false entry this whole item exists to
-- remove, arriving through the exception rather than the rule.
--
-- So 'warn' needs its notification INSIDE, which needs public.notifications
-- confirmed, and it is left out rather than half-done. Flagged rather than
-- absorbed: it is a real amendment to a decision that was taken deliberately.
--
-- ── ⚠️ WHAT THIS MIGRATION DOES NOT DO ──────────────────────────────────
-- It does NOT lock down suspensions or admin_audit_log with RLS. Item 29's
-- second decision was that the client should lose direct write access to both,
-- the way apply_subscription_state's rule works. That must land AFTER the
-- console is repointed, or the console breaks the moment this is applied.
-- Additive only. Nothing existing changes behaviour.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the shape this function was written against.
--
-- Every column named below was read from information_schema on 8 Sep 2026, not
-- from a migration file. These assertions fail loudly if the database has moved
-- since, rather than letting the function fail at its first real use.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0035: public.is_admin() is missing — this function gates on it.';
  end if;

  -- suspensions: reason is NOT NULL, banned is NOT NULL, suspended_until is not.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'suspensions'
      and column_name = 'reason' and is_nullable = 'NO'
  ) then
    raise exception '0035: suspensions.reason is not NOT NULL any more — the reason guard below assumes it is.';
  end if;

  -- The four booleans this function flips must all still be NOT NULL, or
  -- `not <col>` silently yields NULL and the toggle stops toggling.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('is_verified', 'fraud_flagged', 'provider_fee_waived', 'subscription_waived')
      and is_nullable = 'YES'
  ) then
    raise exception '0035: one of the users booleans is nullable now — read-and-flip would produce NULL.';
  end if;

  -- admin_audit_log.action is TEXT, not an enum. Confirmed 8 Sep. If it ever
  -- becomes an enum, every action label here needs adding before it can be
  -- used, and that is a two-migration job (PG lets you ADD VALUE in a
  -- transaction but not USE it until commit).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'admin_audit_log'
      and column_name = 'action' and data_type <> 'text'
  ) then
    raise exception '0035: admin_audit_log.action is no longer text — see the note above.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The function.
--
-- SECURITY DEFINER so it can write admin_audit_log once RLS is tightened in a
-- later migration, and so the whole decision commits or none of it does.
--
-- search_path is pinned. A SECURITY DEFINER function with a caller-controlled
-- search_path is the classic privilege-escalation hole: an unqualified table
-- name could be resolved to a table the caller created.
-- ---------------------------------------------------------------------------
create or replace function public.admin_act_on_user(
  p_user_id       uuid,
  p_action        text,
  p_reason        text default null,
  p_duration_days integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := auth.uid();
  v_new   boolean;
begin
  -- ── Who ──────────────────────────────────────────────────────────────
  -- is_admin() first, because it is the authorisation. The null check is
  -- separate and NOT redundant: it is what stops an audit row being written
  -- with admin_id null, which the column still permits.
  if not public.is_admin() then
    raise exception 'admin_act_on_user: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_act_on_user: no auth.uid(), so the action could not be attributed'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'admin_act_on_user: no user %', p_user_id using errcode = 'P0002';
  end if;

  -- ── What ─────────────────────────────────────────────────────────────
  case p_action

    -- ⚠️ suspensions HAS NO UNIQUE CONSTRAINT ON user_id (confirmed 8 Sep:
    -- only a PK on id and an FK to users). So today, banning someone already
    -- suspended INSERTS A SECOND LIVE ROW and nothing decides which one counts.
    --
    -- This function replaces rather than stacks, and that is a decision, not an
    -- inheritance. Two things made it:
    --   * `reinstate` already deletes EVERY row for the user, so the product
    --     already treats this table as current state rather than as history.
    --   * admin/app/users reads it through activeSuspension(rows[]), which
    --     picks one — with two live rows the answer depends on row order.
    -- History lives in admin_audit_log, which is what it is for.
    --
    -- The constraint itself is NOT added here: there may be duplicate rows
    -- already, and an ALTER that fails takes the whole migration with it. VERIFY
    -- BLOCK B counts them so that can be decided on evidence.
    when 'suspend' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'admin_act_on_user: suspend needs a reason' using errcode = '22023';
      end if;
      if p_duration_days is null or p_duration_days <= 0 then
        raise exception 'admin_act_on_user: suspend needs a positive duration' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason)
      values (p_user_id, now() + make_interval(days => p_duration_days), false, p_reason);

    when 'ban' then
      if coalesce(btrim(p_reason), '') = '' then
        raise exception 'admin_act_on_user: ban needs a reason' using errcode = '22023';
      end if;
      delete from public.suspensions where user_id = p_user_id;
      insert into public.suspensions (user_id, suspended_until, banned, reason)
      values (p_user_id, null, true, p_reason);

    when 'reinstate' then
      delete from public.suspensions where user_id = p_user_id;

    when 'verify' then
      update public.users set is_verified = true where id = p_user_id;

    -- ── The three toggles READ AND FLIP IN HERE ──────────────────────────
    -- They used to compute `!current` in the client from a row fetched earlier.
    -- Same class as the current_period_end near-miss: computing from a value you
    -- read a moment ago is computing from a guess. The new value is returned
    -- into the audit row so the log says what it became, not what was intended.
    when 'flag' then
      update public.users set fraud_flagged = not fraud_flagged
      where id = p_user_id returning fraud_flagged into v_new;

    when 'waive' then
      update public.users set provider_fee_waived = not provider_fee_waived
      where id = p_user_id returning provider_fee_waived into v_new;

    when 'comp' then
      update public.users set subscription_waived = not subscription_waived
      where id = p_user_id returning subscription_waived into v_new;

    else
      -- An action with no branch is a bug, not a no-op to be logged. This is the
      -- database half of the same guard added to doAction() on 8 Sep, where
      -- collapsing eight ifs into a switch revealed that a new action string
      -- would previously have fallen through to an audit row for something that
      -- never ran.
      raise exception 'admin_act_on_user: unknown action %', p_action using errcode = '22023';
  end case;

  -- ── The record, in the same transaction as the thing it records ──────
  insert into public.admin_audit_log (action, target_user_id, admin_id, admin_note, details)
  values (
    p_action,
    p_user_id,
    v_admin,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'duration_days', p_duration_days,
      'new_value',     v_new,
      'via',           'admin_act_on_user'
    ))
  );
end
$$;

comment on function public.admin_act_on_user(uuid, text, text, integer) is
  'One transaction for a moderation decision and its admin_audit_log row, so the '
  'action and the evidence for it cannot disagree. Replaces rather than stacks '
  'suspensions (that table has no unique constraint on user_id). Toggles read and '
  'flip inside. Does NOT handle ''warn'': the notification is the action there, so '
  'it has to be inside the transaction, which needs public.notifications confirmed. '
  'Audit items 27 and 29.';

-- Same posture as every other function here: nothing for anon, and the
-- is_admin() gate inside does the real work.
revoke all on function public.admin_act_on_user(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_act_on_user(uuid, text, text, integer) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0035', 'admin_act_on_user', 'a39e50fa8c5205423fad9397c0af478c944366eb527477b22a3db776d28589fd');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying.
--
-- ⚠️ THE FUNCTION ITSELF CANNOT BE EXERCISED FROM THE SQL EDITOR.
-- It gates on is_admin(), which reads auth.uid(); in the editor there is no
-- end-user session, so auth.uid() is null and the guard refuses. That is the
-- guard working. Blocks A–C below check what CAN be checked from here, and the
-- function has to be tested from the admin console once it is repointed.
-- Saying so rather than shipping a verify block that cannot pass.
--
-- ── BLOCK A — it exists, and with the properties that matter ────────────
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef                               as security_definer,
--          p.proconfig                               as settings
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'admin_act_on_user';
--
--   Expect one row: security_definer true, settings containing
--   search_path=public, pg_temp. A SECURITY DEFINER function without a pinned
--   search_path is a privilege-escalation hole, so this is the line to read.
--
-- ── BLOCK B — are there already duplicate live suspensions? ─────────────
--
--   This decides whether a unique constraint on suspensions.user_id is worth
--   adding in a later migration. The function replaces from now on; existing
--   duplicates are untouched and would still confuse activeSuspension().
--
--   select user_id, count(*) as rows
--   from public.suspensions
--   group by user_id
--   having count(*) > 1
--   order by rows desc;
--
--   Zero rows means the constraint could be added safely. Any rows are
--   pre-existing ambiguity that predates this function.
--
-- ── BLOCK C — how many audit rows do not say who ────────────────────────
--
--   admin_audit_log.admin_id is nullable with no default, while
--   moderation_actions.admin_id is NOT NULL DEFAULT auth.uid(). Two tables
--   recording who did something, one of which permits not saying. This function
--   refuses to write a null; existing rows are what they are.
--
--   select count(*) filter (where admin_id is null) as anonymous,
--          count(*)                                  as total
--   from public.admin_audit_log;
--
--   A non-zero `anonymous` is a fact about the past, not a failure of this
--   migration. It decides whether NOT NULL can ever be added.
--
-- ── BLOCK D — the guard refuses an unknown action ───────────────────────
--
--   Runs as the editor's role, so it should fail on the ADMIN guard, not the
--   action guard. If you see 'not an admin', that is the correct result here.
--
--   begin;
--     select public.admin_act_on_user(
--       '00000000-0000-0000-0000-000000000000'::uuid, 'nonsense');
--   rollback;
--
--   Expect: ERROR admin_act_on_user: not an admin.
-- ===========================================================================


-- ===========================================================================
-- ⚠️ STAMP BEFORE YOU APPLY — NOT AFTER
--
--   node scripts/migration-status.mjs --stamp     <- BEFORE pasting this file
--   (paste the whole file into the Supabase SQL editor)
--   node scripts/migration-status.mjs             <- confirm: applied, no drift
--
-- WHY THE ORDER MATTERS. A new file's footer says PENDING_CHECKSUM, and
-- --stamp replaces it with the real checksum. Apply first and the database
-- records the literal string PENDING_CHECKSUM, which the checksum written
-- afterwards can never match, so the ledger reads DRIFTED from then on. 0040
-- was applied that way on 11 Sep 2026 and needed a reconcile by hand.
--
-- This block used to say "LAST STEP, EVERY TIME" and name only the status
-- report. That was correct about the report and SILENT about stamping — which
-- is how a migration written by copying the nearest file gets applied
-- unstamped. Swept across every migration on 13 Sep 2026, audit item 41.
--
-- The status report is still worth running last. It catches what no verify
-- block can: a migration written, committed, and never applied at all. 0009 sat
-- in that state for a day and was noticed by eye. A check that depends on
-- someone noticing is not a check. It needs the service-role key in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--
-- Editing this block on an APPLIED migration is safe, and that is measured
-- rather than assumed: it sits BELOW the MIGRATION FOOTER line, the checksum
-- covers only what is above that line, and every body checksum in this
-- directory was recomputed before and after the sweep.
-- ===========================================================================
