-- ===========================================================================
-- 0115_a_model_photo_can_be_marked_seen
--
-- Gives model_photos the review record it has never had, and one admin-only
-- function to write it.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────
-- Three kinds of photo reach this platform and until now only two could be
-- moderated:
--
--   users.profile_pic_url   profile_pic_reviewed_at, written by
--                           admin_mark_profile_pic_seen. 13 of 13 reviewed.
--   portfolio_items         moderation_status, a real pending/approved state
--                           machine with a queue in the console.
--   model_photos            NOTHING. No reviewed_at, no moderation_status, no
--                           admin screen. 14 rows across 3 users, not one of
--                           them ever looked at — because there was nowhere
--                           to look and nothing to write down afterwards.
--
-- ⚠️ THE PERMISSION WAS NEVER THE OBSTACLE. The storage policy
-- `model photos read` already reads
--     bucket_id = 'model-photos' AND (owner OR is_admin() OR shares_session…)
-- so an admin has been able to read every object the whole time. What was
-- missing is a place to record that they did. This migration adds only that;
-- the screen is in admin/app/moderation.
--
-- ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
-- No moderation_status, no approve/reject, no hiding. This is the WEAKER of
-- the two existing patterns on purpose: `profile_pic_reviewed_at` records
-- that a person looked, and nothing else. A model photo that should not be on
-- the platform is handled the way one is today — the member is warned,
-- suspended or banned through the existing moderation actions, which are
-- recorded in moderation_actions and survive deletion. Adding a per-photo
-- state machine would be a second way to act on the same problem.
--
-- ⚠️ EVERY EXISTING ROW STARTS UNREVIEWED, AND THAT IS NOT A BUG. All 14 go
-- into the new queue on day one, because nobody has ever looked at them.
-- Backfilling `reviewed_at = now()` would clear the list by asserting a
-- review that did not happen, which is the one thing a review column must
-- never say. The queue opens with a backlog; that backlog is true.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0114') then
    raise exception '0115 needs 0114 applied first.';
  end if;

  if to_regclass('public.model_photos') is null then
    raise exception '0115: public.model_photos is missing.';
  end if;

  -- The gate the whole file rests on.
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0115: is_admin() is missing; the function below is gated on it.';
  end if;

  -- ⚠️ THE PATTERN BEING COPIED. If the profile-picture version is gone, the
  -- shape this migration imitates no longer exists and the file should be
  -- re-read before it runs.
  if to_regprocedure('public.admin_mark_profile_pic_seen(uuid)') is null then
    raise exception '0115: admin_mark_profile_pic_seen(uuid) is missing. This migration copies '
      'its shape; if it has gone, read the header before running this.';
  end if;

  -- Not a precondition so much as a warning: a column already present means
  -- somebody has been here, and the comment below would overwrite theirs.
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='model_photos' and column_name='reviewed_at'
  ) then
    raise notice '0115: model_photos.reviewed_at already exists; this migration is additive '
      'and will leave existing values alone.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The record.
-- ---------------------------------------------------------------------------
alter table public.model_photos
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id);

comment on column public.model_photos.reviewed_at is
  'When an admin looked at this photo (0115). NULL means nobody has, which is '
  'what the Model photos queue filters on. It records that someone LOOKED, '
  'not that the photo was approved — there is no approval state here.';

comment on column public.model_photos.reviewed_by is
  'Which admin looked (0115). auth.users id, via public.users. ON DELETE is '
  'NO ACTION by the public.users default, so a deleted admin blocks nothing '
  'and the record survives — same reasoning as reports (0004).';

-- ⚠️ PARTIAL, AND THAT IS THE WHOLE POINT OF IT. The queue asks exactly one
-- question — "what has nobody looked at, oldest first" — and a partial index
-- answers it by holding only the rows that are still waiting. It shrinks to
-- nothing as the backlog clears, which a plain index on created_at would not.
-- profile_pic_reviewed_at has no equivalent; it gets away with it on 13 rows.
create index if not exists model_photos_unreviewed_idx
  on public.model_photos (created_at)
  where reviewed_at is null;

-- ---------------------------------------------------------------------------
-- 2. The only thing allowed to write it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_model_photo_seen(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- ⚠️⚠️ THE GUARD COMES BEFORE THE WORK, NOT AFTER IT. SECURITY DEFINER means
  -- this function runs with the owner's rights, so without this line any
  -- signed-in member could mark any photo as reviewed. "It is SECURITY
  -- DEFINER" is a statement about power, not about safety.
  if not public.is_admin() then
    raise exception 'admin_mark_model_photo_seen: admins only'
      using errcode = '42501';
  end if;

  if p_photo_id is null then
    raise exception 'admin_mark_model_photo_seen: no photo id'
      using errcode = '22023';
  end if;

  -- ⚠️ reviewed_at IS NOT OVERWRITTEN ONCE SET. Pressing the button twice
  -- should not move the record of when it was first looked at, and a second
  -- admin opening a stale list should not quietly take credit for the first
  -- one's work.
  update public.model_photos
     set reviewed_at = coalesce(reviewed_at, now()),
         reviewed_by = coalesce(reviewed_by, auth.uid())
   where id = p_photo_id;
end
$function$;

grant execute on function public.admin_mark_model_photo_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_pred text;
  v_id   uuid;
  v_code text;
  v_was  timestamptz;
begin
  -- (a) Both columns, both nullable. NOT NULL would be a lie about 14 rows.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='model_photos'
       and column_name='reviewed_at' and is_nullable='YES'
  ) then
    raise exception '0115: model_photos.reviewed_at is missing or NOT NULL. Rolled back.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='model_photos' and column_name='reviewed_by'
  ) then
    raise exception '0115: model_photos.reviewed_by is missing. Rolled back.';
  end if;

  -- (b) ⚠️ THE INDEX IS PARTIAL, checked by reading its PREDICATE rather than
  --     its name. An index called _unreviewed_ that covers every row would
  --     pass a name check and answer the queue's question slowly forever.
  select pg_get_expr(i.indpred, i.indrelid) into v_pred
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'model_photos_unreviewed_idx';
  if v_pred is null then
    raise exception '0115: model_photos_unreviewed_idx is missing or is not partial. Rolled back.';
  end if;
  if v_pred not ilike '%reviewed_at is null%' then
    raise exception '0115: model_photos_unreviewed_idx has predicate %, which is not '
      '"reviewed_at is null". Rolled back.', v_pred;
  end if;

  -- (c) The function exists, is DEFINER, and authenticated can call it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='admin_mark_model_photo_seen' and p.prosecdef
  ) then
    raise exception '0115: admin_mark_model_photo_seen is missing or not SECURITY DEFINER. Rolled back.';
  end if;
  if not has_function_privilege('authenticated',
       'public.admin_mark_model_photo_seen(uuid)', 'EXECUTE') then
    raise exception '0115: authenticated cannot execute admin_mark_model_photo_seen. Rolled back.';
  end if;

  -- (d) ⚠️⚠️ THE GATE ACTUALLY REFUSES. This is the assertion the whole file
  --     rests on, and the three checks above do not make it: a DEFINER
  --     function that is granted to authenticated and does NOT check
  --     is_admin() would pass every one of them, and would let any signed-in
  --     member mark any photo reviewed.
  --
  --     So the function is CALLED as the `authenticated` role. auth.uid() is
  --     null without a request JWT, is_admin() is therefore false, and the
  --     refusal must arrive as 42501.
  --
  --     ⚠️ AND THE ROW MUST BE UNCHANGED AFTERWARDS. A function that raises
  --     after writing is a function that wrote.
  select id, reviewed_at into v_id, v_was from public.model_photos limit 1;

  if v_id is null then
    -- Nothing to aim at. Said out loud rather than passing: an unexercised
    -- gate is not a proven one.
    raise notice '0115: model_photos is empty, so the admin gate could not be exercised '
      'against a real row. The function exists and is DEFINER; that it REFUSES is untested.';
  else
    begin
      execute 'set local role authenticated';
      perform public.admin_mark_model_photo_seen(v_id);
      execute 'reset role';
      raise exception '0115: admin_mark_model_photo_seen ACCEPTED a call from a non-admin. '
        'Rolled back.';
    exception
      when insufficient_privilege then
        execute 'reset role';
        -- The refusal we wanted.
      when others then
        get stacked diagnostics v_code = returned_sqlstate;
        execute 'reset role';
        if v_code = 'P0001' then
          -- A bare `raise exception` from the check above: the call succeeded.
          raise exception '0115: admin_mark_model_photo_seen ACCEPTED a call from a non-admin. '
            'Rolled back.';
        end if;
        raise exception '0115: a non-admin call failed with SQLSTATE % rather than 42501. '
          'Read the function before trusting the gate. Rolled back.', v_code;
    end;

    if (select reviewed_at from public.model_photos where id = v_id) is distinct from v_was then
      raise exception '0115: the refused call still changed reviewed_at. Rolled back.';
    end if;
  end if;

  raise notice '0115: model_photos can now be marked seen, by admins only. % row(s) waiting.',
    (select count(*) from public.model_photos where reviewed_at is null);
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0115', 'a_model_photo_can_be_marked_seen', '4bf3502cb8b0aef7c4d3168352f4fef3b28e01cca8d1cbcc048cee8b4c03a49c');

commit;

notify pgrst, 'reload schema';

-- ⚠️ TO UNDO: drop function public.admin_mark_model_photo_seen(uuid);
-- drop index public.model_photos_unreviewed_idx;
-- alter table public.model_photos drop column reviewed_by, drop column
-- reviewed_at; then delete the '0115' row. Dropping the columns discards every
-- record of who looked at what, which is the thing worth hesitating over —
-- the photos themselves are untouched either way.
