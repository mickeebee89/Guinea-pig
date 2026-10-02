-- ===========================================================================
-- 0072_the_wall_takes_both_roles
--
-- status_posts becomes the Salon Floor: both roles post to it, and the screen
-- learns to hold a post that contains a phone number. Audit item 141.
--
-- ⚠️ Apply 0071 first. ⚠️ AND APPLY THIS BEFORE DEPLOYING THE CLIENT: the page
-- selects author_user_id, which does not exist until this runs.
--
-- ── WHAT CHANGES, AND WHAT DOES NOT ────────────────────
-- The table was stylist-only by its primary key relationship, not by policy:
-- `provider_id uuid not null references public.providers(id)`. A model has no
-- providers row, so she could not write — while already being able to READ
-- every approved post, because status_posts_read_visible has no role condition
-- and never had one.
--
-- So this is one column and four policies, not a new table. A separate
-- wall_posts table would need its own copies of the link stripper, the screen,
-- the moderation vocabulary and the admin queue — four rules duplicated, which
-- is the fault this file has recorded five times.
--
-- ── ⚠️ WHY provider_id BECOMES NULLABLE, AND WHAT IT PROTECTS ──
-- public_stylist_status (0033) is GRANTED TO ANON — it is on cavybeauty.com —
-- and reads `join public.providers p on p.id = sp.provider_id`. A model's post
-- carries provider_id = null, so it cannot match that join and cannot reach the
-- public web.
--
-- That is safety by construction, which is exactly the kind that rots quietly
-- when somebody later makes the column NOT NULL again or changes the join to an
-- outer one. The ASSERT at the end proves it rather than trusting it.
--
-- ── THE DIGIT RULE ─────────────────────────────────────
-- A model posting "after a cut this week, text me on 07700 900123" passed every
-- existing screen: not a banned word, not a URL, not a bare domain. It would
-- have been auto-approved and visible to every member for 48 hours with nobody
-- having read it.
--
-- The rule looks for nine or more digits in a row, allowing spaces, hyphens,
-- dots, brackets and slashes between them. A LETTER ENDS THE RUN, which is what
-- makes it safe: unrelated numbers either side of a word never join into one.
--
--     free Thursday 2-4pm   -> 24           2   clean
--     £25                   -> 25           2   clean
--     07 October            -> 07           2   clean
--     01/10/2026            -> 01102026     8   clean
--     10:00-12:00           -> 00-12 only   4   clean
--     07700 900123          -> 07700900123 11   HELD
--     +44 7700 900123       -> 447700900123 12  HELD
--     0 7 7 0 0 9 0 0 1 2 3 -> 07700900123 11   HELD
--
-- The worst realistic legitimate case is 8 (a full date); every UK number is 11
-- or 12. Nine
-- sits in the gap with room either side, and the allowance for separators
-- defeats the obvious evasion of spacing the digits out.
--
-- ⚠️ IT HOLDS, IT DOES NOT REJECT. Same shape as a banned-word hit: the post
-- becomes 'pending' and a human decides. A stylist legitimately posting a
-- landline is a real case, and refusing her outright would be the product
-- deciding something it cannot know.
--
-- It will not catch "oh seven seven double oh". That is what reporting and the
-- queue are for, and missing it is better than holding up "free Thursday 2-4pm".
--
-- ── ⚠️ EXISTING POSTS ARE RE-SCREENED ONCE ─────────────
-- The triggers are BEFORE INSERT OR UPDATE, so nothing already approved would
-- ever be looked at again. A post that is live right now with a number in it
-- would stay live, which is the precise thing this migration exists to stop.
-- The one-off pass below re-runs the rule over unexpired approved posts.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0072') then
    raise exception 'Migration 0072 has already been applied (see public.schema_migrations)';
  end if;
  if not exists (select 1 from public.schema_migrations where version = '0071') then
    raise exception '0072 expects 0071 to be applied first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. AN AUTHOR, WHOEVER THEY ARE
-- ---------------------------------------------------------------------------
alter table public.status_posts
  add column if not exists author_user_id uuid references auth.users(id) on delete cascade;

-- Every existing post is a stylist's. Backfill from the provider before the
-- NOT NULL below, or the constraint fails on the first row.
update public.status_posts sp
   set author_user_id = p.user_id
  from public.providers p
 where p.id = sp.provider_id
   and sp.author_user_id is null;

do $$
declare v_orphans int;
begin
  select count(*) into v_orphans from public.status_posts where author_user_id is null;
  if v_orphans > 0 then
    raise exception '0072: % status_posts row(s) have no author after backfill. A provider with a null user_id would do this. Resolve before continuing.', v_orphans;
  end if;
end $$;

alter table public.status_posts alter column author_user_id set not null;
alter table public.status_posts alter column provider_id drop not null;

comment on column public.status_posts.author_user_id is
  'Who wrote it, whichever role they are. The Salon Floor takes posts from both '
  '(0072). Always set.';
comment on column public.status_posts.provider_id is
  'The shop, when a stylist wrote it. NULL for a model''s post — which is also '
  'what keeps model posts off cavybeauty.com, because public_stylist_status '
  'inner-joins providers on it (0033). Nullable since 0072.';

create index if not exists status_posts_author_created_idx
  on public.status_posts (author_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. THE POLICIES FOLLOW THE AUTHOR, NOT THE SHOP
--
-- status_posts_read_visible is UNCHANGED and is quoted here only so the next
-- reader does not go looking: `moderation_status = 'approved' and expires_at >
-- now()`, with no role condition. Every member sees every approved post. That
-- is the Salon Floor's whole shape and it is deliberate.
-- ---------------------------------------------------------------------------
drop policy if exists status_posts_read_own on public.status_posts;
create policy status_posts_read_own
  on public.status_posts as permissive for select to authenticated
  using (author_user_id = auth.uid());

-- ⚠️ TWO CONDITIONS, AND THE SECOND IS THE ONE THAT MATTERS. Anyone may post as
-- themselves; nobody may post as a shop that is not theirs. Without the second
-- clause a model could insert with another stylist's provider_id and put words
-- in her mouth ON THE PUBLIC WEBSITE, via public_stylist_status.
drop policy if exists status_posts_insert_own on public.status_posts;
create policy status_posts_insert_own
  on public.status_posts as permissive for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and (
      provider_id is null
      or exists (
        select 1 from public.providers p
        where p.id = status_posts.provider_id and p.user_id = auth.uid()
      )
    )
  );

drop policy if exists status_posts_delete_own on public.status_posts;
create policy status_posts_delete_own
  on public.status_posts as permissive for delete to authenticated
  using (author_user_id = auth.uid());

-- Still NO author UPDATE policy, for 0031's reason: an approved post silently
-- becoming different text is the hole that makes moderation decorative.

-- ---------------------------------------------------------------------------
-- 3. THE SCREEN LEARNS DIGITS
--
-- Brought forward from 0032's body. The banned-word loop is unchanged; one
-- check is added before the verdict.
-- ---------------------------------------------------------------------------
create or replace function public.looks_like_a_phone_number(p_text text)
returns boolean
language sql
immutable
as $$
  -- ONE PATTERN, ONE PASS: nine or more digits, each allowed to be followed by
  -- separators. `(\d[ \t\-\.\(\)\/]*){9,}` reads as "a digit, then any run of
  -- spacing, nine times over" — so a number survives being written 07700 900123,
  -- 07700-900123, (07700) 900123 or 0 7 7 0 0 9 0 0 1 2 3, and a letter ends the
  -- run because letters are not in the class.
  --
  -- ⚠️ IT WAS WRITTEN AS COLLAPSE-THEN-MEASURE FIRST, and that was wrong.
  -- regexp_replace with 'g' does not re-examine the characters it has consumed,
  -- so a single pass over "0 7 7 0 0" joins alternate pairs and leaves gaps;
  -- fully closing eleven spaced digits would have needed four passes, and three
  -- were written. It looked right and would have let the most obvious evasion
  -- through.
  --
  -- A COLON IS NOT A SEPARATOR HERE, deliberately: it keeps "10:00-12:00" to a
  -- longest run of four rather than eight, which leaves more room under the
  -- threshold for the commonest legitimate cluster in this product.
  select coalesce(p_text ~ '(\d[ \t\-\.\(\)\/]*){9,}', false);
$$;

comment on function public.looks_like_a_phone_number(text) is
  'TRUE when the text contains nine or more digits in a row, allowing spaces, '
  'hyphens, dots, brackets and slashes between them. Catches UK numbers (11-12 '
  'digits) and the spaced-out evasion; clears dates, times and prices. Used to '
  'HOLD a post for review, never to reject one. 0072, audit item 141.';

create or replace function public.screen_status_post()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_raw    text;
  v_words  jsonb;
  v_word   text;
  v_hit    boolean := false;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  -- ⚠️ 0072. Checked FIRST and independently of the word list: a phone number
  -- must be held even when the list is missing or unreadable, because those
  -- paths already end in 'pending' and this one must not be able to downgrade
  -- that to 'approved'.
  if public.looks_like_a_phone_number(new.body) then
    new.moderation_status := 'pending';
    return new;
  end if;

  select value into v_raw from public.settings where key = 'banned_words';
  if v_raw is null then
    new.moderation_status := 'pending';
    return new;
  end if;
  begin
    v_words := v_raw::jsonb;
  exception when others then
    new.moderation_status := 'pending';
    return new;
  end;
  if jsonb_typeof(v_words) <> 'array' then
    new.moderation_status := 'pending';
    return new;
  end if;

  for v_word in select btrim(w) from jsonb_array_elements_text(v_words) w loop
    if v_word <> '' and strpos(lower(new.body), lower(v_word)) > 0 then
      v_hit := true;
      exit;
    end if;
  end loop;

  new.moderation_status := case when v_hit then 'pending' else 'approved' end;
  return new;
end $$;

comment on function public.screen_status_post() is
  'Screens a status post body: a phone-number shape (0072) or a banned word '
  '(0032) holds it at ''pending'' for a human. AUTHORITATIVE: the copy in '
  'admin/app/moderation/page.tsx is a retrospective search for a human and '
  'cannot gate anything.';

-- ---------------------------------------------------------------------------
-- 4. THE ONE-OFF RE-SCREEN
--
-- Only live posts: expired ones are invisible either way, and rewriting their
-- status would churn the record for nothing.
-- ---------------------------------------------------------------------------
do $$
declare v_held int;
begin
  update public.status_posts
     set moderation_status = 'pending'
   where moderation_status = 'approved'
     and expires_at > now()
     and public.looks_like_a_phone_number(body);
  get diagnostics v_held = row_count;
  raise notice '0072: % live post(s) held for review by the new digit rule.', v_held;
end $$;

-- ---------------------------------------------------------------------------
-- 5. ⚠️ PROVE A MODEL'S POST CANNOT REACH THE PUBLIC WEBSITE
--
-- Not a comment claiming it. The migration refuses to commit if the public view
-- would carry a post with no provider.
-- ---------------------------------------------------------------------------
do $$
declare v_leaked int;
begin
  if to_regclass('public.public_stylist_status') is null then
    raise exception '0072: public_stylist_status is missing. It is what model posts must not reach, so its absence is not a free pass.';
  end if;
  select count(*) into v_leaked
  from public.public_stylist_status v
  join public.status_posts sp on sp.id = v.id
  where sp.provider_id is null;
  if v_leaked > 0 then
    raise exception '0072: % post(s) with no provider are visible in public_stylist_status. A model''s post would reach cavybeauty.com.', v_leaked;
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0072', 'the_wall_takes_both_roles', 'd92d4fe3b876155f976cd6693401247aa39a88e9c1ad248259e9fd83e2484714');

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN THIS BEFORE THE MIGRATION. Read-only, changes nothing.
--
--   select
--     (select count(*) from public.schema_migrations where version = '0071') = 1
--       as v_0071_applied,
--     (select count(*) from information_schema.columns
--       where table_schema = 'public' and table_name = 'status_posts'
--         and column_name = 'author_user_id') = 0          as column_not_there_yet,
--     (select count(*) from public.status_posts)           as posts_total,
--     (select count(*) from public.status_posts
--       where moderation_status = 'approved' and expires_at > now())
--                                                          as posts_live_now,
--     (select count(*) from public.status_posts sp
--       left join public.providers p on p.id = sp.provider_id
--      where p.user_id is null)                            as rows_that_cannot_backfill;
--
--   Expect true, true, and rows_that_cannot_backfill = 0. If it is not 0 the
--   migration stops rather than writing a post with no author.
-- ===========================================================================
--
-- ── VERIFY ──────────────────────────────────────────────────────────────
--
--   -- (a) the digit rule, against the cases it must get right both ways.
--   select body, public.looks_like_a_phone_number(body) as held
--   from (values
--     ('free Thursday 2-4pm'),      ('£25'),          ('07 October'),
--     ('3.30pm'),                   ('01/10/2026'),   ('10:00-12:00'),
--     ('two spaces free, £25 each'),
--     ('07700 900123'),             ('07700900123'),  ('+44 7700 900123'),
--     ('0161 496 0000'),            ('0 7 7 0 0 9 0 0 1 2 3')
--   ) t(body);
--
--   Expect false for the first seven and true for the last five. Read every
--   row: a rule that holds "£25" is worse than one that misses a number,
--   because it trains people to post nothing.
--
--   -- (b) a model can post, and it is held when it carries a number.
--   --     Runs as the model test account (CLAUDE.md), rolled back.
--   begin;
--   do $v$
--   declare v_me uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--           v_clean uuid; v_phone uuid; v_a text; v_b text; v_report text;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     if auth.uid() is null or public.is_admin() then
--       raise exception 'ROLLED BACK, TESTED NOTHING. actor auth.uid()=% is_admin=%.',
--         coalesce(auth.uid()::text, 'NULL'), public.is_admin();
--     end if;
--
--     insert into public.status_posts (author_user_id, provider_id, body)
--     values (v_me, null, 'after a cut this week, anything considered')
--     returning id into v_clean;
--     insert into public.status_posts (author_user_id, provider_id, body)
--     values (v_me, null, 'after a cut, text me on 07700 900123')
--     returning id into v_phone;
--
--     select moderation_status into v_a from public.status_posts where id = v_clean;
--     select moderation_status into v_b from public.status_posts where id = v_phone;
--     execute 'reset role';
--     v_report := 'clean post=' || v_a || ' | with a number=' || v_b;
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_report;
--   end $v$;
--   rollback;
--
--   Expect approved, then pending.
--
--   -- (c) she cannot post as somebody else's shop.
--   begin;
--   do $v$
--   declare v_me uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--           v_prov uuid; v_state text;
--   begin
--     select id into v_prov from public.providers where user_id <> v_me limit 1;
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
--     execute 'set local role authenticated';
--     begin
--       insert into public.status_posts (author_user_id, provider_id, body)
--       values (v_me, v_prov, 'two spaces free Thursday');
--       v_state := 'NO ERROR - she posted as another shop, which reaches the public site';
--     exception when others then
--       v_state := sqlstate || ' ' || sqlerrm;
--     end;
--     execute 'reset role';
--     raise exception 'ROLLED BACK ON PURPOSE. %', v_state;
--   end $v$;
--   rollback;
--
--   Expect 42501 — the RLS check refuses it.
-- ===========================================================================
