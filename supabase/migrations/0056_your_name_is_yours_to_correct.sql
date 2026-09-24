-- ===========================================================================
-- 0056_your_name_is_yours_to_correct
--
-- A member can fix her own name. Audit item 104.
--
-- ⚠️ Apply 0055 first.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────
-- first_name and last_initial are written into auth metadata at signup and
-- copied into public.users by ensureProfile. **Nothing on either client has
-- ever changed them afterwards** — no screen, no support route, nothing.
--
-- So a member who signs up with a typo in her own name carries it on every
-- profile, every booking card, every review she leaves and every chat, for
-- the life of the account. It is the single most visible thing about her and
-- the only thing she cannot touch.
--
-- ── ⚠️ THE COLUMN WAS ALREADY MEMBER-WRITABLE, WHICH CHANGES THE JOB ─────
-- "users can update own row" is PERMISSIVE over the whole row, and 0040's
-- guard is a DENYLIST that does not name first_name. So a member could
-- already change her own name through the API today, as often as she liked,
-- with nothing recorded. There was simply no button.
--
-- That means a limit in a server action would be decoration: the action is
-- not the only way in. The rule has to live here, in the database, or it is
-- not a rule. Same reasoning 0040 records for the gates it guards.
--
-- ── WHAT DEPENDS ON A NAME, AND WHICH WAY EACH SHOULD GO ────────────────
-- Everything that matters is already a SNAPSHOT, taken when the thing
-- happened, and none of it is touched by a later change:
--
--   * reports.reported_name / reporter_name  (0004)
--   * moderation_actions.target_name          (0027, NOT NULL)
--   * session_consents.subject_name           — six-year evidence
--   * patch_tests.model_name / provider_name  (0007)
--   * notification bodies and emails already sent — frozen text
--
-- That is the correct behaviour and this migration deliberately does not
-- disturb it: a report is a record of what someone was called at the time,
-- and rewriting it to a later name would falsify the record.
--
-- Everything a member READS follows the live name, because every one of
-- those surfaces joins public_profiles at render time: reviews, booking
-- lists, chat, browse, the dashboard. So a correction takes effect
-- everywhere it should and nowhere it should not, with no backfill.
--
-- ── ⚠️ IS THIS A WAY TO ESCAPE A REPORT OR A BAD REVIEW? ────────────────
-- **Not from the system, and partly from other people. Both halves matter.**
--
-- NOT from the system. The durable identity in reports and moderation_actions
-- is the EMAIL HASH, named in 0004 as the ban-evasion signal precisely so
-- that a display name cannot be the thing that ties a record to a person.
-- Reviews hang off reviewee_id. Nothing sheds by renaming.
--
-- FROM OTHER PEOPLE, partly, and this is the real reason for a limit. What
-- one member sees of another is "Sarah B." A model warned about "Sarah B."
-- by a friend will not recognise "Emma T." That is not evasion of the record;
-- it is evasion of word of mouth, and no database column prevents it.
--
-- So: allowed, logged, and rate-limited. A typo is fixed once, within days of
-- signing up. Someone cycling through names is doing something else, and the
-- log is what makes that visible rather than the refusal.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.users') is null then
    raise exception '0056: public.users is missing.';
  end if;
  if to_regclass('public.name_changes') is not null then
    raise exception '0056: public.name_changes already exists. Read it before applying.';
  end if;
  -- The cooldown and the suspension check both lean on these.
  --
  -- ⚠️ to_regprocedure, NOT to_regproc. The first version of this file used
  -- to_regproc and the migration refused itself on a function that plainly
  -- exists.
  --
  --   to_regproc('public.is_suspended')          -- a NAME
  --   to_regprocedure('public.is_suspended(uuid)') -- a NAME AND ITS ARGUMENTS
  --
  -- Handed a signature, to_regproc cannot parse it as a plain name, and the
  -- whole to_reg* family returns NULL on failure instead of raising — which is
  -- the point of them, and is what turned "you called the wrong function" into
  -- "is_suspended(uuid) is missing". Both checks below were wrong; the first
  -- one raised, so the second was never reached.
  --
  -- Every other migration in this ledger already uses to_regprocedure,
  -- including 0044, which checks THIS EXACT FUNCTION in the same words.
  if to_regprocedure('public.is_suspended(uuid)') is null then
    raise exception '0056: public.is_suspended(uuid) is missing (suspension-enforcement.sql).';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0056: public.is_admin() is missing.';
  end if;
  -- 0040's guard runs BEFORE UPDATE on the same table. Ours must not be the
  -- only thing standing between a member and her own gates.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_guard_users_protected_columns' and not tgisinternal
  ) then
    raise exception '0056: trg_guard_users_protected_columns is missing. Apply 0040 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE LOG
--
-- Append-only, like reports (0006) and moderation_actions. The point of it is
-- not the individual row: it is that someone changing names repeatedly is
-- visible to an admin, which is the only control that addresses the "escaping
-- word of mouth" half of the question.
--
-- CASCADE on delete, unlike reports. The records that must survive an account
-- deletion carry their OWN name snapshots (0004, 0027) and are unaffected by
-- this table existing or not. Keeping a de-identified history of what a
-- deleted account used to be called would collect more than it can justify.
-- ---------------------------------------------------------------------------
create table public.name_changes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  old_first_name    text,
  old_last_initial  text,
  new_first_name    text not null,
  new_last_initial  text,
  -- Who made the change. Normally the member; an admin correcting something
  -- on her behalf is the other case, and the two must be tellable apart.
  changed_by        uuid,
  changed_at        timestamptz not null default now()
);

create index name_changes_user_idx on public.name_changes (user_id, changed_at desc);

comment on table public.name_changes is
  'Every change to users.first_name / last_initial, append-only. Exists so that repeated renaming '
  'is visible: a rename cannot escape a report or a review (both key on the email hash and the '
  'user id respectively), but it CAN escape being recognised by another member who was warned '
  'about you. That is what this records. 0056, audit item 104.';

alter table public.name_changes enable row level security;

-- Her own history, and an admin's view of everyone's. No insert, update or
-- delete policy for anyone: the trigger below is the only writer, and it is
-- SECURITY DEFINER so it does not need one.
create policy name_changes_select_own on public.name_changes
  as permissive for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. THE RULE
--
-- BEFORE UPDATE, and it refuses rather than silently ignoring: a member told
-- "saved" whose name did not change would be worse than one told why not.
--
-- ⚠️ THE COOLDOWN IS 30 DAYS AND THE NUMBER IS A JUDGEMENT, NOT A FINDING.
-- A typo is corrected once, within days of signing up. A marriage or a
-- transition is a handful of times in a life. Thirty days permits both and
-- makes name-cycling something an admin sees rather than something that
-- happens quietly. It is one constant, here, if it turns out to be wrong.
-- ---------------------------------------------------------------------------
create or replace function public.guard_users_name_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_last   timestamptz;
  v_first  text := nullif(btrim(coalesce(new.first_name, '')), '');
  v_init   text := nullif(btrim(coalesce(new.last_initial, '')), '');
begin
  -- Unchanged: nothing to do, and this must stay cheap because every update
  -- to a users row passes through here.
  if new.first_name is not distinct from old.first_name
     and new.last_initial is not distinct from old.last_initial then
    return new;
  end if;

  -- Not an end user: service role, SQL editor, cron, or an admin correcting
  -- something. Same test as 0040, for the same reason.
  if v_uid is null or public.is_admin() then
    return new;
  end if;

  if v_uid <> new.id then
    raise exception 'You cannot change someone else''s name.' using errcode = '42501';
  end if;

  -- ⚠️ A SUSPENDED ACCOUNT MAY NOT RE-BRAND. This is the half of the question
  -- that is about other members rather than about the record: someone under a
  -- suspension changing what they are called is the case a limit exists for.
  if public.is_suspended(v_uid) then
    raise exception
      'Your account is restricted at the moment, so your name cannot be changed. Contact support.'
      using errcode = '42501';
  end if;

  if v_first is null then
    raise exception 'Your first name cannot be empty.' using errcode = '23514';
  end if;
  if length(v_first) > 40 then
    raise exception 'That first name is too long (40 characters at most).' using errcode = '23514';
  end if;
  -- One letter, or nothing. It is displayed as "Sarah B." and anything longer
  -- is a surname, which this product deliberately does not show.
  if v_init is not null and v_init !~ '^[A-Za-z]$' then
    raise exception 'Your last initial should be a single letter, or left blank.' using errcode = '23514';
  end if;

  select max(changed_at) into v_last
  from public.name_changes where user_id = v_uid;

  if v_last is not null and v_last > now() - interval '30 days' then
    raise exception
      'You changed your name on %. You can change it again after %.',
      to_char(v_last, 'FMDD Mon YYYY'),
      to_char(v_last + interval '30 days', 'FMDD Mon YYYY')
      using errcode = '22023';
  end if;

  -- Normalised on the way in, so the stored value is what will be displayed.
  new.first_name   := v_first;
  new.last_initial := upper(v_init);
  return new;
end $$;

comment on function public.guard_users_name_change() is
  'Refuses a name change by a suspended account, an empty or over-long first name, a last initial '
  'that is not one letter, or a second change within 30 days. Lives in the database because '
  '"users can update own row" is permissive over the whole row and 0040''s denylist does not name '
  'first_name — so a member can already write it directly, and a limit in a server action would '
  'be decoration. 0056, audit item 104.';

revoke all on function public.guard_users_name_change() from public, anon;

drop trigger if exists trg_guard_users_name_change on public.users;
create trigger trg_guard_users_name_change
  before update on public.users
  for each row execute function public.guard_users_name_change();

-- ---------------------------------------------------------------------------
-- 3. THE LOG IS WRITTEN AFTER, NOT BEFORE
--
-- An AFTER trigger, so a change that is refused by anything downstream — a
-- constraint, another trigger, the statement rolling back — leaves no entry
-- claiming it happened. Logging from the BEFORE guard would record attempts
-- as facts, and the cooldown reads this table.
-- ---------------------------------------------------------------------------
create or replace function public.log_users_name_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.first_name is distinct from old.first_name
     or new.last_initial is distinct from old.last_initial then
    insert into public.name_changes (
      user_id, old_first_name, old_last_initial, new_first_name, new_last_initial, changed_by
    ) values (
      new.id, old.first_name, old.last_initial, new.first_name, new.last_initial, auth.uid()
    );
  end if;
  return null;
end $$;

revoke all on function public.log_users_name_change() from public, anon;

drop trigger if exists trg_log_users_name_change on public.users;
create trigger trg_log_users_name_change
  after update on public.users
  for each row execute function public.log_users_name_change();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0056', 'your_name_is_yours_to_correct', 'c4c932ff6741e93a7360b8f6e37d25e7e9145ca48cfa88dc863932c7d44fa693');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
-- The ASSERT block is code, and on 24 Sep 2026 it was WRONG: it used
-- to_regproc where it needed to_regprocedure, and refused the migration on a
-- function that plainly existed. The migration was blamed for the database
-- being wrong when the truth was the reverse.
--
-- An ASSERT that has never been run is an untested claim about the schema. So
-- every precondition it tests is repeated here as a SELECT that ANSWERS rather
-- than raises. Four rows, all of which must say yes:
--
--   select 'is_suspended(uuid)' as needs,
--          to_regprocedure('public.is_suspended(uuid)') is not null as present
--   union all
--   select 'is_admin()',
--          to_regprocedure('public.is_admin()') is not null
--   union all
--   select 'trg_guard_users_protected_columns (0040)',
--          exists (select 1 from pg_trigger
--                  where tgname = 'trg_guard_users_protected_columns'
--                    and not tgisinternal)
--   union all
--   select 'name_changes does NOT exist yet',
--          to_regclass('public.name_changes') is null;
--
-- If any `present` is false, STOP and find out why before changing the
-- migration — the answer is as likely to be in the check as in the database.
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   Additive. Safe to apply against the build that is live now: nothing calls
--   the new table, and the guard only fires on an update that changes a name,
--   which no shipped code does.
--
--   0. The PREFLIGHT block above. It takes ten seconds and it is the step that
--      would have caught the to_regproc mistake without applying anything.
--   1. Apply this migration.
--   2. node scripts/gen-supabase-types.mjs
--   3. ⚠⚠ WIRE "Your name" BACK INTO SETTINGS. It is built and deliberately
--      NOT wired: settings/page.tsx reads `name_changes` for the cooldown
--      note, and that table is not in the generated types until step 1 has
--      run. Committing it wired would have pushed a tree that cannot build.
--      The comment in settings/page.tsx marks the spot. Three things:
--        * import { NameSection } from './NameSection'
--        * the `lastChange` read (her own rows; RLS permits exactly that)
--        * the <section> with NameSection, above "Where you are"
--   4. npm run verify --prefix site, then push.
--   5. Blocks A to C below.
--
--   ⚠️ An admin correcting a name from the SQL editor or the console is NOT
--   rate-limited and IS logged, with changed_by recording who did it.
-- ===========================================================================
--
-- ── BLOCK A — the rules, as a real member. Rolls back ────────────────────
--
--   ⚠️ Supabase SQL editor. `set local role authenticated` plus the JWT claim
--   is what makes the guard see an end user; as the owner auth.uid() is null
--   and every rule below is skipped, so this block would prove nothing.
--
--   do $$
--   declare
--     v_me uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';   -- model test account
--     v_ok text; v_empty text; v_long_init text; v_second text;
--     v_logged integer;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     update public.users set first_name = 'Corrected', last_initial = 'z' where id = v_me;
--     v_ok := 'accepted (correct)';
--
--     begin
--       update public.users set first_name = '   ' where id = v_me;
--       v_empty := 'ACCEPTED <-- WRONG, an empty first name must be refused';
--     exception when others then v_empty := 'refused (correct)';
--     end;
--
--     begin
--       update public.users set last_initial = 'Bxx' where id = v_me;
--       v_long_init := 'ACCEPTED <-- WRONG, the initial is one letter';
--     exception when others then v_long_init := 'refused (correct)';
--     end;
--
--     begin
--       update public.users set first_name = 'Again' where id = v_me;
--       v_second := 'ACCEPTED <-- WRONG, the 30-day cooldown is not holding';
--     exception when others then v_second := 'refused (correct): ' || sqlerrm;
--     end;
--
--     select count(*) into v_logged from public.name_changes where user_id = v_me;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nfirst change: %\nempty name: %\nlong initial: %\nsecond change: %\nrows logged: %  (must be 1 — only the change that SUCCEEDED)',
--       v_ok, v_empty, v_long_init, v_second, v_logged;
--   end $$;
--
--   ⚠️ READ "rows logged". It must be 1, not 4. The log is an AFTER trigger so
--   that refused attempts do not appear in it as facts — and the cooldown
--   reads this table, so a spurious row would lock her out for a month.
--
-- ── BLOCK B — the initial is normalised, and someone else's name is not
--    yours to change. Rolls back ─────────────────────────────────────────
--
--   do $$
--   declare
--     v_me    uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_other uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_init text; v_other_result text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--
--     update public.users set first_name = 'Casing', last_initial = 'q' where id = v_me;
--     select last_initial into v_init from public.users where id = v_me;
--
--     begin
--       update public.users set first_name = 'Hijacked' where id = v_other;
--       -- RLS should stop this before the guard ever sees it; either is a pass.
--       v_other_result := 'no error raised — CHECK ROW COUNT, RLS may have matched 0 rows';
--     exception when others then v_other_result := 'refused (correct): ' || sqlerrm;
--     end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nstored initial: %  (must be Q, upper-cased)\nchanging another account: %',
--       coalesce(v_init, '(null)'), v_other_result;
--   end $$;
--
-- ── BLOCK C — what a rename does NOT touch. Read-only, nothing to roll back
--
--   The whole safety argument is that the records key on something other than
--   the display name. This shows it rather than asserting it.
--
--   select 'reports'            as record, count(*) filter (where reported_email_hash is not null) as keyed_on_hash, count(*) as total from public.reports
--   union all
--   select 'moderation_actions', count(*) filter (where target_email_hash is not null), count(*) from public.moderation_actions;
--
--   keyed_on_hash must equal total on both rows. If it does not, some record
--   is identified only by a name, and a rename would detach it.
-- ===========================================================================
