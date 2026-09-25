-- ===========================================================================
-- 0060_something_looks_at_what_gets_published
--
-- A bar that mash can clear is not a bar, and a profile picture nobody has
-- ever looked at is not moderated. Audit items 115 and 100.
--
-- ⚠️ Apply 0059 first.
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────
-- It is not an approve/reject queue for anything new. With one admin and no
-- queue, a human gate is a stranding design, and 0032 settled that argument in
-- August for status posts: "Manual-only review would mean an ordinary post
-- approved twelve hours late is worthless, so the feature would be pointless
-- rather than merely slow. The screen promotes clean posts immediately and
-- queues only what it flags."
--
-- Same reasoning, same machinery, two more surfaces.
--
-- ── 1. THE BIO BAR IS A LENGTH TEST, AND LENGTH IS NOT THE THING ──────
-- public_stylists has required `length(btrim(bio)) >= 40` since 0034. Item 93
-- proved what that buys: a published shop whose bio was keyboard mash, on six
-- indexable treatment pages, because mash is long.
--
-- The replacement keeps the 40 characters and adds what mash actually fails:
-- six words, five of them distinct, and no single run longer than 25
-- characters. Deliberately conservative — its job is to exclude the NEARLY
-- EMPTY and the NONSENSICAL, not to judge anybody's writing. A short, plain,
-- badly punctuated bio by a real person passes, and should.
--
-- ── ⚠️ AND IT RETURNS A SENTENCE, NOT A BOOLEAN ─────────────────
-- `bio_publish_problem()` returns NULL when the bio is fine and the stylist's
-- own explanation when it is not, so the view and the dashboard cannot
-- disagree about why she is not on the public site. The site's
-- `websiteBlockers` calls this function rather than reimplementing the rule
-- — the drift between two copies of one rule is this repo's most repeated
-- bug (location/location_text, the types stamp, the cancel copy).
--
-- It never names the banned word it matched. Telling someone which word to
-- change is how a filter teaches evasion.
--
-- ── 2. THE BANNED-WORD MATCH HAD TWO COPIES. NOW ITS SQL HALF HAS ONE ──
-- 0032 put matching in the trigger and in admin/app/moderation/page.tsx, and
-- said plainly: the trigger is authoritative, the TypeScript is an advisory
-- retrospective search. That stays true.
--
-- What changes is that the SQL half is now a FUNCTION both callers share.
-- Adding a third copy for bios and leaving `screen_status_post` with its own
-- loop is exactly how the semantics drift apart, and 0032 warned about that in
-- its own header. `screen_status_post` is rewritten to call it, so a word that
-- flags a status post flags a bio, by construction rather than by care.
--
-- Three states, kept from 0032 and now in one place:
--
--   list present, hit         the matched word
--   list present, no hit      '' (empty string)
--   list missing/unparseable  NULL — CANNOT SCREEN
--
-- NULL is not "clean". Every caller must treat it as "hold", which is what
-- makes an unreadable list loud instead of silent.
--
-- ── 3. A PROFILE PICTURE NOBODY HAS LOOKED AT ───────────────────
-- It is live the moment it is uploaded, on the open web, and until now nothing
-- recorded that a human had ever seen it. Verification looks once (item 98 put
-- the picture beside the selfie), and a picture can change the next day.
--
-- ⚠️ THIS DOES NOT GATE IT, AND THE REASON IS SPECIFIC. A word screen has no
-- opinion about an image, and there is no image classifier anywhere in this
-- stack. So the only available gate is a human one, and since item 101 an
-- avatar is a PRECONDITION FOR THE ID CHECK — holding it back would strand
-- someone from getting verified at all, which is a wider harm than the one it
-- prevents.
--
-- So: it records. `profile_pic_updated_at` and `profile_pic_reviewed_at` turn
-- an unbounded, invisible blind spot into a bounded, visible, AGEING one. The
-- console shows how long each has been waiting, because a number somebody can
-- see is what stops three days becoming three weeks.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- ⚠️ to_regprocedure, NOT to_regproc. 0056 refused itself on that (item 108).
  if to_regprocedure('public.screen_status_post()') is null then
    raise exception '0060: screen_status_post() is missing. Apply 0032 first.';
  end if;

  v_def := pg_get_functiondef('public.screen_status_post()'::regprocedure);
  if v_def not like '%banned_words%' then
    raise exception '0060: the live screen_status_post() does not read banned_words. Read it before applying.';
  end if;
  if v_def like '%banned_word_hit%' then
    raise exception '0060: screen_status_post() already calls banned_word_hit. This migration has run.';
  end if;

  if to_regclass('public.settings') is null then
    raise exception '0060: public.settings is missing.';
  end if;
  if to_regclass('public.users') is null then
    raise exception '0060: public.users is missing.';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'users'
               and column_name = 'profile_pic_reviewed_at') then
    raise exception '0060: users.profile_pic_reviewed_at already exists. This migration has run.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'users'
                   and column_name = 'profile_pic_url') then
    raise exception '0060: users.profile_pic_url is missing — the trigger below has nothing to watch.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE BANNED-WORD MATCH, ONCE
--
-- 0032's loop, lifted verbatim in behaviour: case-insensitive SUBSTRING with
-- NO word boundaries, via strpos. "cash" matches "cashmere". That is what the
-- admin console's retrospective search does, and matching it here is the whole
-- point of there being one of these.
--
-- strpos takes no pattern, so the entire class of bug that a regex approach
-- carries -- a stray "(" in the list throwing inside the call -- cannot occur.
-- 0032 made that choice deliberately and it is kept deliberately.
-- ---------------------------------------------------------------------------
create or replace function public.banned_word_hit(p_text text)
returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_raw   text;
  v_words jsonb;
  v_word  text;
begin
  -- Nothing to screen is not the same as clean, but it cannot be a hit either.
  if p_text is null or btrim(p_text) = '' then
    return '';
  end if;

  select value into v_raw from public.settings where key = 'banned_words';

  -- NULL means CANNOT SCREEN. Callers must hold, not approve. 0032's header:
  -- "A screen that cannot read its list and approves anyway is a success
  -- signal that does not depend on the thing it claims to prove."
  if v_raw is null then
    return null;
  end if;

  begin
    v_words := v_raw::jsonb;
  exception when others then
    return null;
  end;

  if jsonb_typeof(v_words) <> 'array' then
    return null;
  end if;

  for v_word in select btrim(w) from jsonb_array_elements_text(v_words) w loop
    if v_word <> '' and strpos(lower(p_text), lower(v_word)) > 0 then
      return v_word;
    end if;
  end loop;

  -- An empty list is an admin's explicit "nothing is banned", which is NOT the
  -- same as being unable to read the list. Clean.
  return '';
end $$;

comment on function public.banned_word_hit(text) is
  'The matched banned word, '''' when clean, or NULL when the list could not be '
  'read or parsed. ⚠️ NULL IS NOT CLEAN — every caller must treat it as hold, which '
  'is what makes a misconfigured list loud instead of silent. Case-insensitive '
  'substring with no word boundaries, via strpos, matching what the admin '
  'console''s retrospective search does. SECURITY DEFINER because settings is '
  'not readable by members. 0060; the SQL half of 0032''s two copies.';

revoke all on function public.banned_word_hit(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. screen_status_post() NOW CALLS IT
--
-- 0032's body with the inline loop replaced. Every branch it had is preserved:
-- the body-unchanged guard (without which an admin approving a post has their
-- decision overwritten by the screen that queued it), and all three list
-- states.
-- ---------------------------------------------------------------------------
create or replace function public.screen_status_post()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_hit text;
begin
  -- Only screen when the body is new or has changed. Without this guard an
  -- admin approving a post would re-trigger the screen and have their decision
  -- overwritten by it -- the review would be undone by the thing that queued it.
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  v_hit := public.banned_word_hit(new.body);

  -- NULL = could not read or parse the list. Cannot screen, so cannot approve.
  -- Loud, not silent: every post queues and the moderation tab shows it.
  new.moderation_status := case
    when v_hit is null then 'pending'
    when v_hit <> ''   then 'pending'
    else 'approved'
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. WHAT STOPS A BIO REACHING THE PUBLIC WEBSITE
--
-- Returns NULL when there is nothing wrong. Otherwise it returns the sentence
-- the STYLIST reads, so the view and her dashboard cannot disagree.
--
-- ⚠️ Consequence, unchanged by this migration: failing this keeps her off
-- cavybeauty.com. It does NOT stop a model booking her, and browse uses a
-- deliberately narrower bar (browse.ts:110) because the reason for this one --
-- thin content on an indexable domain -- does not exist behind the auth gate.
-- ---------------------------------------------------------------------------
create or replace function public.bio_publish_problem(p_bio text)
returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v      text := btrim(coalesce(p_bio, ''));
  v_norm text;
  v_words text[];
  v_kept  text[];
  v_hit   text;
begin
  if v = '' then
    return 'Your shop needs an "about" before it can appear on cavybeauty.com.';
  end if;

  -- The 40 characters are KEPT. The new tests are additive: item 93's mash was
  -- long, so length was never wrong, only insufficient.
  if length(v) < 40 then
    return 'Your "about" is a little short for the public site — around 40 characters or more does it.';
  end if;

  v_norm := btrim(regexp_replace(lower(v), '\s+', ' ', 'g'));
  v_words := regexp_split_to_array(v_norm, ' ');

  -- Words worth counting. Punctuation-only fragments are not words.
  select array_agg(w) into v_kept
  from unnest(v_words) w
  where length(regexp_replace(w, '[^a-z0-9]', '', 'g')) >= 2;

  -- ONE UNBROKEN RUN IS THE SHAPE OF MASH. A real sentence has spaces in it,
  -- and no English word runs to 25 characters.
  if exists (select 1 from unnest(v_words) w where length(w) > 25) then
    return 'That does not look like a description yet — try a sentence or two about what you do.';
  end if;

  if v_kept is null or cardinality(v_kept) < 6 then
    return 'That does not look like a description yet — try a sentence or two about what you do.';
  end if;

  -- "asd asd asd asd asd asd" clears a word count and clears a length. It does
  -- not clear this.
  if (select count(distinct w) from unnest(v_kept) w) < 5 then
    return 'That does not look like a description yet — try a sentence or two about what you do.';
  end if;

  v_hit := public.banned_word_hit(v);

  -- ⚠️ The word is never named. Telling somebody which word to change is how a
  -- filter teaches evasion. Same sentence for a hit and for an unreadable list,
  -- because the difference is ours to fix, not hers.
  if v_hit is null or v_hit <> '' then
    return 'Your "about" needs a quick look from us before it goes on the public site. Nothing else is affected — models can still find and book you.';
  end if;

  return null;
end $$;

comment on function public.bio_publish_problem(text) is
  'NULL when a bio may appear on the public website, otherwise the sentence the '
  'STYLIST reads. Used by public_stylists AND by the dashboard''s websiteBlockers '
  'so the two cannot disagree about why she is not listed. Replaced 0034''s bare '
  'length(bio) >= 40, which keyboard mash cleared on six indexable pages (items 93, '
  '115) — the 40 is kept and the word tests are additive. Never names the matched '
  'banned word. Failing it keeps her off cavybeauty.com only: she stays bookable, '
  'and browse uses a narrower bar on purpose. 0060.';

revoke all on function public.bio_publish_problem(text) from public, anon;
grant execute on function public.bio_publish_problem(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A PROFILE PICTURE THAT AGES VISIBLY
--
-- Records, does not gate. See the header for why an image cannot be screened
-- and why gating the avatar specifically would strand people out of the ID
-- check (item 101).
-- ---------------------------------------------------------------------------
alter table public.users add column profile_pic_updated_at  timestamptz;
alter table public.users add column profile_pic_reviewed_at timestamptz;
alter table public.users add column profile_pic_reviewed_by uuid
  references auth.users(id) on delete set null;

comment on column public.users.profile_pic_updated_at is
  'When profile_pic_url last changed, set by trg_profile_pic_needs_a_look. The '
  'clock the console counts from. 0060, audit item 100.';
comment on column public.users.profile_pic_reviewed_at is
  'When an admin last confirmed they had LOOKED at the current picture. NULL means '
  'nobody has seen this one. It gates nothing — an avatar is a precondition for the '
  'ID check (item 101), so holding it would strand people. 0060.';

create or replace function public.mark_profile_pic_unreviewed()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  -- A new picture is a new thing to look at, even from someone whose last one
  -- was fine. Reviewing the account is not reviewing the image.
  if tg_op = 'INSERT' then
    if new.profile_pic_url is not null then
      new.profile_pic_updated_at  := now();
      new.profile_pic_reviewed_at := null;
      new.profile_pic_reviewed_by := null;
    end if;
    return new;
  end if;

  if new.profile_pic_url is distinct from old.profile_pic_url then
    if new.profile_pic_url is null then
      -- Removed. Nothing to look at, so it must not sit in the queue for ever.
      new.profile_pic_updated_at  := null;
      new.profile_pic_reviewed_at := null;
      new.profile_pic_reviewed_by := null;
    else
      new.profile_pic_updated_at  := now();
      new.profile_pic_reviewed_at := null;
      new.profile_pic_reviewed_by := null;
    end if;
  end if;

  return new;
end $$;

-- ⚠️ BEFORE, not AFTER: it writes to NEW rather than issuing its own UPDATE,
-- so it cannot recurse and costs nothing.
create trigger trg_profile_pic_needs_a_look
  before insert or update on public.users
  for each row execute function public.mark_profile_pic_unreviewed();

-- Ordered oldest-first, which is the one query the console makes.
create index if not exists users_profile_pic_unreviewed_idx
  on public.users (profile_pic_updated_at)
  where profile_pic_url is not null and profile_pic_reviewed_at is null;

-- ---------------------------------------------------------------------------
-- 5. MARKING ONE AS SEEN
--
-- Deliberately not called "approve". There is no reject: the way to reject a
-- picture is to remove it, and that is a different decision with its own
-- consequences. This records that a human looked.
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_profile_pic_seen(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_admin uuid := auth.uid();
  v_url   text;
begin
  if not public.is_admin() then
    raise exception 'admin_mark_profile_pic_seen: not an admin' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'admin_mark_profile_pic_seen: no auth.uid(), so it could not be attributed'
      using errcode = '42501';
  end if;

  select u.profile_pic_url into v_url from public.users u where u.id = p_user_id;
  if not found then
    raise exception 'admin_mark_profile_pic_seen: no user %', p_user_id using errcode = 'P0002';
  end if;
  if v_url is null then
    raise exception 'admin_mark_profile_pic_seen: that account has no picture, so there is nothing to mark as seen'
      using errcode = '55000';
  end if;

  -- ⚠️ The trigger fires on this UPDATE too. profile_pic_url is unchanged, so
  -- its `is distinct from` guard does nothing and the review is not undone by
  -- the thing that recorded it -- the same trap 0032 guards in screen_status_post.
  update public.users
     set profile_pic_reviewed_at = now(),
         profile_pic_reviewed_by = v_admin
   where id = p_user_id;

  insert into public.admin_audit_log (action, target_user_id, admin_id, details)
  values ('profile_pic_seen', p_user_id, v_admin,
          jsonb_build_object('media_url', v_url, 'via', 'admin_mark_profile_pic_seen'));

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end $$;

comment on function public.admin_mark_profile_pic_seen(uuid) is
  'Records that an admin LOOKED at the current profile picture. Not an approval: '
  'nothing is gated on it, and the way to reject a picture is to remove it. Writes '
  'an admin_audit_log row carrying the URL, because that URL is what was actually '
  'judged and the picture can change a minute later. 0060, audit item 100.';

revoke all on function public.admin_mark_profile_pic_seen(uuid) from public, anon;
grant execute on function public.admin_mark_profile_pic_seen(uuid) to authenticated;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0060', 'something_looks_at_what_gets_published', 'b54ee2f17ff9fe9587e8636942fde463e4929b5a69ee4b5ecfc60915a24d45a1');

commit;

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select 'screen_status_post() exists' as needs,
--          to_regprocedure('public.screen_status_post()') is not null as present
--   union all
--   select 'its live body reads banned_words',
--          pg_get_functiondef('public.screen_status_post()'::regprocedure) like '%banned_words%'
--   union all
--   select 'it does NOT already call banned_word_hit',
--          pg_get_functiondef('public.screen_status_post()'::regprocedure) not like '%banned_word_hit%'
--   union all
--   select 'settings and users exist',
--          to_regclass('public.settings') is not null and to_regclass('public.users') is not null
--   union all
--   select 'users.profile_pic_url exists',
--          exists (select 1 from information_schema.columns
--                  where table_schema='public' and table_name='users' and column_name='profile_pic_url')
--   union all
--   select 'users.profile_pic_reviewed_at does NOT exist yet',
--          not exists (select 1 from information_schema.columns
--                      where table_schema='public' and table_name='users' and column_name='profile_pic_reviewed_at');
-- ===========================================================================
--
-- ===========================================================================
-- DEPLOY
--
--   ⚠️ THE VIEW FILE IS A SEPARATE, MANUAL STEP, exactly as with item 105.
--   public-web-views.sql is not a migration and is not applied by anything.
--   Until it is re-run by hand, public_stylists still uses the bare 40-character
--   bar and item 115 is NOT closed, however green everything else looks.
--
--   1. Preflight above.
--   2. Apply this migration.
--   3. RE-RUN supabase/public-web-views.sql BY HAND. ← the step that closes 115
--   4. node scripts/gen-supabase-types.mjs --applied 0060
--   5. Deploy site and admin.
--   6. Blocks A, B and C below.
-- ===========================================================================
--
-- ── BLOCK A — mash fails, a real bio passes. Reads nothing, changes nothing ─
--
--   select label, public.bio_publish_problem(bio) as problem
--   from (values
--     ('mash, 40+ chars, one run',
--      'asdkjhasdkjhasdkjhasdkjhasdkjhasdkjhasdkjhasd'),
--     ('mash with spaces',
--      'asd asd asd asd asd asd asd asd asd asd asd asd'),
--     ('too short', 'I do hair.'),
--     ('empty', ''),
--     ('a real, plain bio',
--      'I have been doing balayage and colour corrections for six years in Chatham and I am building a portfolio of lived-in blondes.')
--   ) as t(label, bio);
--
--   Expect: a sentence for the first four, NULL for the last. ⚠️ If the last one
--   is not NULL the bar is too tight and a real stylist is being excluded — that
--   is a worse failure than the one this fixes, so stop and loosen it.
--
-- ── BLOCK B — the three list states, and NULL is not clean ────────────
--
--   select public.banned_word_hit('nothing to see here') as clean_or_hit,
--          public.banned_word_hit(null)                  as null_input_is_clean,
--          (select count(*) from public.settings where key = 'banned_words') as list_rows;
--
--   If list_rows is 0 the first column is NULL — CANNOT SCREEN — and every bio
--   will be held with the "needs a quick look" sentence. That is the designed
--   loud failure, not a bug, and configuring the list is the fix.
--
-- ── BLOCK C — a changed picture goes back in the queue. Rolls back ──────
--
--   do $blk$
--   declare
--     v_admin  uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_member uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_after_change record;
--     v_after_seen   record;
--     v_after_again  record;
--   begin
--     update public.users set profile_pic_url = 'https://example.invalid/one.jpg' where id = v_member;
--     select profile_pic_updated_at, profile_pic_reviewed_at into v_after_change
--       from public.users where id = v_member;
--
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     set local role authenticated;
--     perform public.admin_mark_profile_pic_seen(v_member);
--     reset role;
--
--     select profile_pic_updated_at, profile_pic_reviewed_at into v_after_seen
--       from public.users where id = v_member;
--
--     update public.users set profile_pic_url = 'https://example.invalid/two.jpg' where id = v_member;
--     select profile_pic_updated_at, profile_pic_reviewed_at into v_after_again
--       from public.users where id = v_member;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\n\nafter upload   reviewed_at: %   <-- MUST be null\nafter marking  reviewed_at: %   <-- MUST be set\nafter a NEW picture reviewed_at: %   <-- MUST be null again\n\nand marking it seen did not reset its own clock: %   <-- MUST be true',
--       v_after_change.profile_pic_reviewed_at,
--       v_after_seen.profile_pic_reviewed_at,
--       v_after_again.profile_pic_reviewed_at,
--       v_after_seen.profile_pic_updated_at = v_after_change.profile_pic_updated_at;
--   end $blk$;
--
-- ── WHAT NONE OF THEM PROVES ────────────────────────────────
-- That public_stylists uses the new bar. It will not until the view file is
-- re-run by hand (step 3). After that:
--
--   select count(*) from public.public_stylists;
-- ===========================================================================
