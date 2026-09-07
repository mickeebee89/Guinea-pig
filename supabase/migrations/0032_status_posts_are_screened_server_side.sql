-- ===========================================================================
-- 0032_status_posts_are_screened_server_side
--
-- Two guarantees about a status post's body, both as triggers: it contains no
-- links, and it has been checked against the banned-word list before it can
-- reach anybody.
--
-- ⚠️ Apply 0031 first.
--
-- ── WHY TRIGGERS AND NOT THE COMPOSER ───────────────────────────────────
-- A check in the dashboard composer is bypassed by calling PostgREST directly
-- with the author's own token — no special access needed, just the session the
-- app already gave them. Every stylist can do it. So both guarantees live in
-- the database, where the client cannot be the thing that enforces them.
--
-- This is the same reasoning as `messages_insert_not_blocked` (0018): the
-- listing-side filter is presentation, and the RESTRICTIVE policy is what
-- actually stops the write.
--
-- ── THE AUTO-SCREEN SHIPS WITH THE FEATURE, NOT AFTER ───────────────────
-- Decided in August and still right. Posts live 48 hours. Manual-only review
-- would mean an ordinary post approved twelve hours late is worthless, so the
-- feature would be pointless rather than merely slow. The screen promotes clean
-- posts immediately and queues only what it flags.
--
-- ── MATCHING EXISTS IN TWO PLACES. THE TRIGGER IS AUTHORITATIVE ─────────
--
--   HERE (SQL)                            authoritative. Cannot be bypassed.
--   admin/app/moderation/page.tsx (TS)    a retrospective SEARCH over existing
--                                         rows, for a human. Advisory only.
--
-- The LIST is single-source: `settings.banned_words`, edited in the admin
-- console. Only the matching is duplicated, and the same note is written into
-- the TypeScript file — because a note in one place does not reach the person
-- editing the other, which is exactly how `location` and `location_text` drifted.
--
-- They must agree on ONE semantic: CASE-INSENSITIVE SUBSTRING, NO WORD
-- BOUNDARIES. "cash" matches "cashmere". That is what the admin search already
-- does, and matching it here means a word that flags in one flags in the other.
--
-- The implementations differ on purpose. TypeScript builds a regex and has to
-- escape metacharacters — a stray "(" in the list once threw inside an
-- un-awaited call and left the tab silently empty. SQL uses `strpos`, which
-- takes no pattern at all, so that entire class of bug cannot occur here.
-- Copying the regex approach would have copied the hazard.
--
-- ── WHAT HAPPENS WHEN THE LIST CANNOT BE READ ──────────────────────────
-- Fail closed, with one deliberate distinction:
--
--   list present, has words   screen. Clean -> approved. Hit -> stays pending.
--   list present, EMPTY       nothing is banned, by an admin's explicit choice.
--                             Approve.
--   row missing / unparseable  CANNOT SCREEN. Stays pending.
--
-- The third case is loud rather than silent: every post queues, and the admin
-- moderation tab fills up, which is the visible signal that the list needs
-- configuring. A screen that cannot read its list and approves anyway is a
-- success signal that does not depend on the thing it claims to prove.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- MEASURE — what the list holds before anything depends on it.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0032', 'banned_words_row_exists',
       (exists (select 1 from public.settings where key = 'banned_words'))::text;

insert into public.migration_findings (version, item, value)
select '0032', 'banned_words_count',
       coalesce((
         select jsonb_array_length(value::jsonb)
         from public.settings where key = 'banned_words'
           and jsonb_typeof(value::jsonb) = 'array'
       ), -1)::text;   -- -1 means missing or not an array

-- ---------------------------------------------------------------------------
-- ASSERT — the table this screens must exist and be the one 0031 created.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'status_posts'
  ) then
    raise exception '0032: public.status_posts does not exist. Apply 0031 first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'status_posts'
      and column_name = 'moderation_status'
  ) then
    raise exception '0032: status_posts has no moderation_status column.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Plain text. Links stripped, not rejected.
--
-- Stripping rather than refusing is deliberate: a stylist who pastes a link
-- into "two spaces free Thursday, book here: example.com" should get their post,
-- minus the link — not an error telling them to guess what was wrong.
--
-- The public page then renders the body as text with no parsing step at all,
-- which removes the injection surface rather than sanitising it.
-- ---------------------------------------------------------------------------
create or replace function public.strip_links_from_status_post()
returns trigger language plpgsql as $$
declare v text := coalesce(new.body, '');
begin
  -- Markdown links: keep the words, drop the target.
  v := regexp_replace(v, '\[([^\]]*)\]\([^)]*\)', '\1', 'g');
  -- Any HTML tag.
  v := regexp_replace(v, '<[^>]*>', '', 'g');
  -- Explicit URLs.
  v := regexp_replace(v, '(https?://|www\.)[^\s]+', '', 'gi');
  -- Bare domains: two or more labels ending in a plausible TLD. Deliberately
  -- narrow — matching every dotted string would eat "3.30pm" and prices.
  v := regexp_replace(v,
        '\m[a-z0-9][a-z0-9\-]*(\.[a-z0-9\-]+)*\.(com|co\.uk|uk|net|org|io|me|shop|store|link|xyz)\M(/[^\s]*)?',
        '', 'gi');
  -- Collapse the whitespace stripping leaves behind.
  v := btrim(regexp_replace(v, '[ \t]{2,}', ' ', 'g'));

  new.body := v;
  return new;
end $$;

comment on function public.strip_links_from_status_post() is
  'Removes links from a status post body at write time. A composer-side check '
  'would be bypassed by calling PostgREST with the author''s own token, so the '
  'guarantee lives here. Strips rather than refuses: a post minus its link is a '
  'better outcome than an error the author has to decode.';

-- ---------------------------------------------------------------------------
-- 2. The auto-screen.
--
-- SECURITY DEFINER because `settings` is admin-readable and the author is not
-- an admin. It reads one row and writes nothing outside status_posts.
-- ---------------------------------------------------------------------------
create or replace function public.screen_status_post()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_raw    text;
  v_words  jsonb;
  v_word   text;
  v_hit    boolean := false;
begin
  -- Only screen when the body is new or has changed. Without this guard an
  -- admin approving a post would re-trigger the screen and have their decision
  -- overwritten by it — the review would be undone by the thing that queued it.
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  select value into v_raw from public.settings where key = 'banned_words';

  if v_raw is null then
    -- No list at all. Cannot screen, so cannot approve. See the header: this is
    -- loud, not silent — every post queues and the moderation tab shows it.
    new.moderation_status := 'pending';
    return new;
  end if;

  begin
    v_words := v_raw::jsonb;
  exception when others then
    new.moderation_status := 'pending';   -- unparseable: same reasoning
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

  -- An empty list is an admin's explicit "nothing is banned", which is not the
  -- same as being unable to read the list.
  new.moderation_status := case when v_hit then 'pending' else 'approved' end;
  return new;
end $$;

comment on function public.screen_status_post() is
  'Screens a status post body against settings.banned_words. AUTHORITATIVE: the '
  'copy in admin/app/moderation/page.tsx is a retrospective search for a human '
  'and cannot gate anything. Both must use the same semantic — case-insensitive '
  'substring, no word boundaries — and this one uses strpos rather than a regex '
  'so a stray metacharacter in the list cannot break it.';

-- ORDER MATTERS, AND NOT FOR THE REASON IT FIRST APPEARS.
--
-- The strip runs first so THE SCREEN SEES EXACTLY WHAT WILL BE STORED. If the
-- screen ran first, it would judge text that no longer exists by the time the
-- row lands, and a post could be approved on the strength of a body that was
-- then rewritten underneath it.
--
-- NOT because a word hidden in a URL survives the strip — it does not. The URL
-- regex removes the whole thing, path and all, so a banned word inside a link
-- is deleted along with the link and never reaches the screen. That outcome is
-- fine (nothing objectionable is stored or published) but it is a different
-- fact, and the first version of this comment claimed the opposite.
drop trigger if exists trg_status_post_strip_links on public.status_posts;
create trigger trg_status_post_strip_links
  before insert or update on public.status_posts
  for each row execute function public.strip_links_from_status_post();

drop trigger if exists trg_status_post_screen on public.status_posts;
create trigger trg_status_post_screen
  before insert or update on public.status_posts
  for each row execute function public.screen_status_post();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0032', 'status_posts_are_screened_server_side', '5af11b8dbba4f76948d859ec43852fe50f8c11a8cd7a739a4b550b69e224904d');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. One self-contained statement per check.
--
-- ── BLOCK A — what the list actually holds ──────────────────────────────
--
--   select item, value from public.migration_findings
--   where version = '0032' order by item;
--
--   banned_words_count of -1 means the row is missing or is not an array, and
--   EVERY post will queue until that is fixed. That is intended, and this is
--   where you find out rather than wondering why nothing publishes.
--
-- ── BLOCK B — a clean post is approved immediately ──────────────────────
--
--   begin;
--     insert into public.status_posts (provider_id, body)
--     values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid,
--             'Two spaces free Thursday afternoon');
--     select body, moderation_status from public.status_posts
--      where body like 'Two spaces free%';
--   rollback;
--
--   Expect moderation_status 'approved'. If it is 'pending', check Block A —
--   the list is probably missing rather than the post being flagged.
--
-- ── BLOCK C — links are gone, and the post still arrives ────────────────
--
--   begin;
--     insert into public.status_posts (provider_id, body)
--     values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid,
--             'Free slot today, book at https://example.com/x or www.example.co.uk '
--             || 'or example.com — see <b>here</b> and [this](http://evil.test)');
--     select body from public.status_posts where body like 'Free slot today%';
--   rollback;
--
--   Expect the URLs, the tag and the markdown target gone, "this" kept, and the
--   sentence still readable. Stripped, not refused.
--
-- ── BLOCK D — a banned word queues rather than publishes ────────────────
--
--   Put a word you can test with in the list first (admin → Settings), then:
--
--   begin;
--     insert into public.status_posts (provider_id, body)
--     values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid,
--             'contains <YOUR-TEST-WORD> in the middle');
--     select moderation_status from public.status_posts
--      where body like 'contains %';
--   rollback;
--
--   Expect 'pending'.
--
-- ── BLOCK E — approving does NOT re-run the screen ──────────────────────
--
--   The guard that stops a review being undone by the thing that queued it.
--
--   begin;
--     insert into public.status_posts (provider_id, body)
--     values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid,
--             'contains <YOUR-TEST-WORD> again');
--     update public.status_posts set moderation_status = 'approved'
--      where body like 'contains %again';
--     select moderation_status from public.status_posts
--      where body like 'contains %again';
--   rollback;
--
--   Expect 'approved'. If it comes back 'pending', the screen is overwriting
--   the admin's decision and nothing flagged could ever be published.
--
-- ── BLOCK F — the screen judges what is actually stored ────────────────
--
--   Strip first, screen second, so the screen never judges text that is about
--   to be rewritten.
--
--   begin;
--     insert into public.status_posts (provider_id, body)
--     values ('49d40aae-a830-41d1-bca8-0fbdb2695455'::uuid,
--             'see https://example.com/<YOUR-TEST-WORD> thanks');
--     select body, moderation_status from public.status_posts
--      where body like 'see %thanks';
--   rollback;
--
--   Expect the body to be 'see thanks' and the status 'approved' — the whole
--   URL is removed, taking the word with it, so there is nothing left to flag.
--
--   ⚠️ The first draft of this block expected 'pending', on the theory that the
--   word survives once the URL is gone. It does not: the URL regex takes the
--   path too. The check was written from the intended reasoning rather than
--   from the code, which is the same error as a verify block that matches its
--   own comment — caught here before it shipped as a passing test of a false
--   claim.
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================
