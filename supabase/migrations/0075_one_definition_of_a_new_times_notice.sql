-- ===========================================================================
-- 0075_one_definition_of_a_new_times_notice
--
-- `new_availability` becomes one definition, in the database, that both
-- clients call. Audit item 143's root cause.
--
-- ⚠️ Apply 0074 first.
--
-- ── WHY THIS EXISTS ────────────────────────────────────
-- The notice was written twice, once per client, with the same body text and
-- the same `data` shape. The web copy omitted `data.provider_id` — the field
-- that makes the body's own promise reachable — and went out that way from
-- 9 Aug 2026 for fifty-four days (item 143). Mobile's copy carries the field
-- under a comment reading, in as many words, *"don't drop it"*.
--
-- **A comment written specifically to prevent this did not prevent it**, because
-- nothing reads a comment in the file you are not editing. The counter-measure
-- that has worked every time in this codebase is a single call site: it is what
-- BOOKINGS_PATH did for five `revalidatePath` calls, what one shared helper did
-- for safeList and FeaturedStylists, and what `slotHasStarted` did for five
-- copies of `date >= today`.
--
-- There is no workspace linkage between site/ and mobile/, so a shared
-- TypeScript module would mean inventing a build step. An RPC needs none: it is
-- a call both apps can already make.
--
-- ── WHY A FUNCTION AND NOT A TRIGGER ───────────────────
-- A trigger on `availability` would be a truer single definition, and it was
-- rejected: it fires per INSERT statement, while the clients call this ONCE per
-- user save action. `applySlotsToDates` can issue several statements, so a
-- trigger would send several notices where one was sent before. **Turning one
-- notification into several is worse than the bug being fixed.**
--
-- This keeps the explicit once-per-save call the clients already have, and
-- moves only the part that drifted: the payload.
--
-- ── ⚠️ IT TAKES NO PARAMETER, ON PURPOSE ───────────────
-- The provider is derived from auth.uid(), never passed. A `p_provider_id`
-- argument would let any authenticated caller write a notification to everyone
-- who favourited any stylist. Deriving it makes that impossible rather than
-- merely unlikely, and it costs nothing: every caller is the stylist herself.
--
-- It is SECURITY DEFINER because it writes rows whose user_id is somebody
-- else's. ⚠️ **AND TODAY THAT IS NOT WHAT PERMITS THE WRITE** — the live
-- `notifications` INSERT policy is `with check (auth.uid() is not null)`, so any
-- signed-in account may already write any notification to anyone. That hole is
-- item 144 and is NOT closed here. **This function is therefore a tidier path,
-- not yet a gate** — the same shape as the session guard in 133, which was
-- bypassable because members could insert directly. Said plainly so nobody
-- reads this file as having fixed it.
--
-- ── THE BODY COPY ──────────────────────────────────────
-- Was: '{name} has new slots available — tap to view their shop'.
-- Now: '{name} has posted new times.'
--
-- Two reasons, decided with Micky before writing: "tap" is mobile's verb and
-- the web has carried it since 9 Aug, where you click; and since item 143 the
-- row is a LINK on both clients, so instructing the reader is the row's job and
-- the body was naming an action twice.
--
-- ⚠️ The body is now database-owned copy. Changing it is a migration, not an
-- edit in two files — which is the whole point, and the cost.
--
-- ── BEHAVIOUR-NEUTRAL, DELIBERATELY ────────────────────
-- It does NOT filter blocked users and does NOT exclude a stylist who
-- favourited herself. Neither is filtered today, and a refactor that quietly
-- changes who receives a notification is one nobody can review. The block gap
-- is real (Apple Guideline 1.2) and belongs with item 144.
-- ===========================================================================
begin;

do $$
begin
  if not exists (select 1 from public.schema_migrations where version = '0074') then
    raise exception '0075: apply 0074 first.';
  end if;
  if to_regclass('public.favourites') is null then
    raise exception '0075: public.favourites is missing — there is nobody to notify.';
  end if;
  if to_regclass('public.availability') is null then
    raise exception '0075: public.availability is missing.';
  end if;
end $$;

create or replace function public.notify_favourites_of_availability()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_id uuid;
  v_name        text;
  v_count       integer;
begin
  -- The caller's OWN shop. Derived, never passed — see the header.
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider_id, v_name
    from public.providers p
   where p.user_id = auth.uid();

  -- Not a stylist, or no shop yet: nothing to announce. Zero, not an error —
  -- the clients call this best-effort after a save that has already committed,
  -- and raising here would turn a non-event into a visible failure.
  if v_provider_id is null then
    return 0;
  end if;

  -- distinct is belt-and-braces: `favourites` carries a unique index on
  -- (user_id, provider_id) and no duplicate rows exist (item 94, asked and
  -- answered). The web copy deduplicated and mobile's did not, so one of them
  -- was carrying a guard against something impossible — and this is the last
  -- place that difference can live.
  insert into public.notifications (user_id, type, title, body, session_id, data)
  select distinct f.user_id,
         'new_availability',
         'New availability posted',
         v_name || ' has posted new times.',
         null,
         -- ⚠️ THE FIELD ITEM 143 WAS ABOUT. Without it the row has no session
         -- and no stylist, so neither client can link it anywhere. It is now
         -- impossible to omit, which a comment saying "don't drop it" was not.
         jsonb_build_object('provider_id', v_provider_id)
    from public.favourites f
   where f.provider_id = v_provider_id;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function public.notify_favourites_of_availability() is
  'Writes one new_availability notification per model who favourited the CALLING stylist, carrying '
  'data.provider_id so both clients can link it to her shop. Takes no argument: the provider comes '
  'from auth.uid(), so it cannot be aimed at anyone else. Returns how many rows were written. '
  'Replaces one copy per client, of which the web copy omitted provider_id for 54 days. '
  '0075, audit items 143 and 94.';

revoke all on function public.notify_favourites_of_availability() from public, anon;
grant execute on function public.notify_favourites_of_availability() to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0075', 'one_definition_of_a_new_times_notice', '61d5c8626685725759954c3ff38103b7b33420f63811da06c9a50bcaccad13d8');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0074') = 1
--       as v_0074_applied,
--     to_regclass('public.favourites') is not null    as favourites_exists,
--     to_regclass('public.availability') is not null  as availability_exists,
--     to_regprocedure('public.notify_favourites_of_availability()') is null
--       as function_is_new,
--     (select count(*) from public.favourites)        as favourite_rows;
--
--   Expect the first four true. favourite_rows is FYI: if it is 0, VERIFY block
--   (b) below cannot prove anything and says so rather than passing.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the shape of the function itself, read from the catalogue
--   select p.prosecdef                                   as is_security_definer,
--          pg_get_function_identity_arguments(p.oid)      as args,
--          p.proconfig                                    as settings,
--          has_function_privilege('authenticated', p.oid, 'execute') as authed_can_call,
--          has_function_privilege('anon', p.oid, 'execute')          as anon_can_call
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'notify_favourites_of_availability';
--
--   Expect is_security_definer t, **args EMPTY** (that empty string is the
--   security property — no argument means it cannot be aimed at another
--   stylist), settings {search_path=public,pg_temp}, authed t, anon f.
--
--   -- (b) IT ACTUALLY WRITES, AS A REAL STYLIST, ROLLED BACK.
--   --     Premise asserted first: a stylist WITH at least one favouriter. A
--   --     stylist with none returns 0, which is correct and proves nothing —
--   --     that is 0070's verify reporting a hole in a correct guard, inverted.
--   begin;
--   do $v$
--   declare
--     v_uid uuid; v_pid uuid; v_favs int; v_wrote int; v_row record;
--   begin
--     select p.user_id, p.id into v_uid, v_pid
--       from public.providers p
--      where exists (select 1 from public.favourites f where f.provider_id = p.id)
--      order by p.id
--      limit 1;
--     if v_uid is null then
--       raise exception 'ROLLED BACK, TESTED NOTHING. No stylist has a favouriter, so a return of 0 would be correct and meaningless.';
--     end if;
--     select count(*) into v_favs from public.favourites where provider_id = v_pid;
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     select public.notify_favourites_of_availability() into v_wrote;
--     execute 'reset role';
--
--     select type, title, body, session_id, data->>'provider_id' as pid
--       into v_row
--       from public.notifications
--      where type = 'new_availability' and user_id in
--            (select user_id from public.favourites where provider_id = v_pid)
--      order by created_at desc limit 1;
--
--     raise exception 'ROLLED BACK ON PURPOSE. favourites=% wrote=% | body=% | session_id=% | data.provider_id=% (expected %)',
--       v_favs, v_wrote, v_row.body, coalesce(v_row.session_id::text, 'null'), v_row.pid, v_pid;
--   end $v$;
--   rollback;
--
--   Expect wrote = favourites, body ending 'has posted new times.', session_id
--   null, and **data.provider_id equal to the expected id** — that last field is
--   the entire subject of item 143, so it is compared rather than merely shown.
--
--   -- (c) it cannot be aimed at somebody else, stated as a fact rather than a
--   --     claim in the header: there is no overload taking an argument.
--   select count(*) as overloads_with_args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'notify_favourites_of_availability'
--      and p.pronargs > 0;
--
--   Expect 0.
-- ===========================================================================
