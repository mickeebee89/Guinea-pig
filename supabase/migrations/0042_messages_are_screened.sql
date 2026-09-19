-- ===========================================================================
-- 0042_messages_are_screened
--
-- Refuse a chat message that contains a banned word, at the database, and give
-- status posts and messages ONE copy of the rule that decides what a banned
-- word is. Audit items 15 and 17; the plan was agreed 19 Sep 2026 (option 1 of
-- the messages options, recorded under the item that holds the profile-text
-- plan).
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────
--
--   1. public.banned_words_check(text) → 'hit' | 'clean' | 'unscreenable'
--      The rule, once. Case-insensitive substring against settings.banned_words,
--      no word boundaries, strpos not regex: exactly what screen_status_post
--      did inline since 0032. 'unscreenable' means the list is missing, not
--      JSON, or not an array. What to DO about that is the caller's decision,
--      and the two callers decide differently (below).
--
--   2. screen_status_post() now calls it. BEHAVIOUR UNCHANGED, including
--      fail-closed: a hit OR an unscreenable list holds the post as 'pending';
--      only 'clean' approves. The early return for an UPDATE that leaves the
--      body alone is kept, so an admin's approval is still not undone.
--
--   3. A BEFORE INSERT trigger on messages that REFUSES a hit, with SQLSTATE
--      CV001. The sender keeps their text and is told why, in both clients.
--
-- ── MESSAGES FAIL OPEN, AND THAT IS DELIBERATE ──────────────────────────
-- For status posts, an unreadable list holds every post: a post can wait. For
-- messages the same rule would silence every conversation on the platform
-- because one settings row was edited badly — two people with a booking, one
-- of whom may be trying to say they are running late. So for messages,
-- 'unscreenable' lets the message through. Only a positive 'hit' refuses.
--
-- ── ⚠️ REFUSED ATTEMPTS LEAVE NO RECORD. THIS WAS ACCEPTED ──────────────
-- The refusal is a RAISE, and a raise rolls back the whole transaction — the
-- insert, and anything this trigger might try to write about it. Postgres has
-- no autonomous transactions, so a trigger cannot both refuse a row and log
-- that it did. There is therefore no count of refused messages, no record of
-- who tried, and nothing for moderation to look at afterwards. Micky accepted
-- that on 19 Sep 2026 in choosing refuse-on-send over deliver-and-flag, which
-- is the only one of the options that leaves a trail.
--
-- ── WHY THE TRIGGER'S NAME MATTERS ──────────────────────────────────────
-- Postgres fires triggers for the same table, timing and event in ALPHABETICAL
-- ORDER OF NAME — not in the order they were created. 0032 is the proof: its
-- comment says the link strip runs before the screen, but
-- trg_status_post_screen sorts before trg_status_post_strip_links, so the
-- screen runs first. (Recorded as its own audit item; not changed here.)
--
-- A screen must see the text as it will be STORED, so it has to fire after
-- anything that rewrites the body. This one is named
--
--   trg_messages_90_screen
--
-- so that any future BEFORE trigger that normalises or strips a message can be
-- named trg_messages_10_… through trg_messages_80_… and will run first, by
-- construction rather than by luck. Anything added after a screen must sort
-- ABOVE 90, and should say why. The ASSERT below refuses to apply if a BEFORE
-- trigger already on this table would sort after it.
--
-- ── WHO IS SCREENED ─────────────────────────────────────────────────────
-- End users only: auth.uid() is not null. The service role (seed/seed.mjs:457
-- inserts demo messages) and the SQL editor carry no user and pass. That is the
-- same boundary 0040 draws. Admins are screened like anyone else; they are not
-- parties to bookings and have no reason to send messages.
--
-- ── ⚠️ WHAT THIS DOES NOT COVER: EDITING A MESSAGE AFTER IT IS SENT ─────
-- This is BEFORE INSERT only, as agreed. But "participants can update
-- messages" (schema-snapshot-2026-08-08-policies.sql:76-79, unchanged by any
-- migration) is a PERMISSIVE UPDATE policy whose only test is that the caller
-- is a party to the booking. RLS cannot restrict columns, so either party can
-- rewrite the BODY of any message in the booking — their own after the screen
-- has passed it, or the other person's. The clients only ever update read_at.
-- A screen on insert can therefore be walked round with one PATCH. Recorded as
-- its own audit item; closing it is a separate decision (a column GRANT, or a
-- guard trigger in the style of 0040), deliberately not taken here.
--
-- ── WHO CAN CALL THE CHECKER ────────────────────────────────────────────
-- Nobody directly. EXECUTE is revoked from public, anon, authenticated and
-- service_role; the owner keeps it, and the two SECURITY DEFINER trigger
-- functions run as the owner. If it were callable over PostgREST, anyone could
-- probe it one word at a time and read the banned list back out of it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — the shape this was written against.
-- ---------------------------------------------------------------------------
do $$
declare
  v_after text;
begin
  if to_regclass('public.settings') is null then
    raise exception '0042: public.settings is missing — banned_words lives there.';
  end if;

  if to_regprocedure('public.screen_status_post()') is null then
    raise exception '0042: public.screen_status_post() is missing — apply 0032 first.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_status_post_screen' and not tgisinternal
  ) then
    raise exception '0042: trg_status_post_screen is missing — the status-post screen this rewrites is not wired.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'body'
  ) then
    raise exception '0042: public.messages.body is missing — the column this screens.';
  end if;

  -- A BEFORE trigger already on messages that would fire AFTER the screen could
  -- rewrite the body once it has been judged. Refuse rather than guess.
  select string_agg(t.tgname, ', ') into v_after
  from pg_trigger t
  where t.tgrelid = 'public.messages'::regclass
    and not t.tgisinternal
    and (t.tgtype & 2) = 2                       -- BEFORE
    and t.tgname <> 'trg_messages_90_screen'
    and t.tgname > 'trg_messages_90_screen';
  if v_after is not null then
    raise exception '0042: BEFORE trigger(s) on messages would fire after the screen: %. Rename them, or this screen, before applying.', v_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE — every trigger on messages today, so the record says what the new
-- one was placed among.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0042', 'messages_trigger_' || t.tgname,
       case when (t.tgtype & 2) = 2 then 'BEFORE' else 'AFTER' end
from pg_trigger t
where t.tgrelid = 'public.messages'::regclass and not t.tgisinternal;

-- ---------------------------------------------------------------------------
-- 1. THE CHECKER — the rule, once.
-- ---------------------------------------------------------------------------
create or replace function public.banned_words_check(p_text text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw   text;
  v_words jsonb;
  v_word  text;
begin
  -- The list first, so an unreadable list reports as unreadable whatever the
  -- text. screen_status_post relied on that order, and it is kept.
  select value into v_raw from public.settings where key = 'banned_words';

  if v_raw is null then
    return 'unscreenable';
  end if;

  begin
    v_words := v_raw::jsonb;
  exception when others then
    return 'unscreenable';
  end;

  if jsonb_typeof(v_words) <> 'array' then
    return 'unscreenable';
  end if;

  if p_text is null then
    return 'clean';
  end if;

  -- An empty array is an admin's explicit "nothing is banned": clean, not
  -- unscreenable.
  for v_word in select btrim(w) from jsonb_array_elements_text(v_words) w loop
    if v_word <> '' and strpos(lower(p_text), lower(v_word)) > 0 then
      return 'hit';
    end if;
  end loop;

  return 'clean';
end $$;

comment on function public.banned_words_check(text) is
  'THE banned-words rule, once (0042). Returns hit, clean or unscreenable. Case-insensitive '
  'substring against settings.banned_words, no word boundaries, strpos not regex so a stray '
  'metacharacter in the list cannot break it. unscreenable = the list is missing, not JSON, or '
  'not an array; each caller decides what that means (status posts hold, messages pass). Not '
  'callable by any client role: over PostgREST it would let anyone read the list back one word '
  'at a time. admin/app/moderation/page.tsx runs a retrospective search for a human and must '
  'keep the same semantic.';

revoke all on function public.banned_words_check(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. STATUS POSTS — same behaviour, one copy of the rule.
--
-- Before 0042 this function held the rule inline. Replaced so the two callers
-- cannot drift. What it does is unchanged: fail-closed, hit or unscreenable
-- both hold; the early return for an unchanged body is kept.
-- ---------------------------------------------------------------------------
create or replace function public.screen_status_post()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- Only screen when the body is new or has changed. Without this guard an
  -- admin approving a post would re-trigger the screen and have their decision
  -- overwritten by it — the review would be undone by the thing that queued it.
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  -- FAIL CLOSED. A post can wait, so an unreadable list holds it exactly as a
  -- hit does, and the moderation tab shows it.
  new.moderation_status :=
    case when public.banned_words_check(new.body) = 'clean' then 'approved' else 'pending' end;
  return new;
end $$;

comment on function public.screen_status_post() is
  'Screens a status post body with banned_words_check (0042; the rule was inline here from 0032). '
  'FAIL-CLOSED: hit or unscreenable -> pending, clean -> approved. AUTHORITATIVE: the copy in '
  'admin/app/moderation/page.tsx is a retrospective search for a human and cannot gate anything.';

-- ---------------------------------------------------------------------------
-- 3. MESSAGES — refuse a hit, pass everything else.
-- ---------------------------------------------------------------------------
create or replace function public.screen_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- End users only — the same boundary 0040 draws. Service role and the SQL
  -- editor carry no user.
  if auth.uid() is null then
    return new;
  end if;

  -- FAIL OPEN: only a positive hit refuses. 'unscreenable' passes, so a broken
  -- settings row cannot silence every conversation.
  if public.banned_words_check(new.body) = 'hit' then
    raise exception 'This message contains words that are not allowed on Cavy.'
      using errcode = 'CV001',
            hint    = 'Refused by trg_messages_90_screen (0042). Edit the message and send again.';
  end if;

  return new;
end $$;

comment on function public.screen_message() is
  'BEFORE INSERT on messages (0042). Refuses a message containing a banned word with SQLSTATE CV001, '
  'which both clients map to "That message can''t be sent because it contains words we don''t '
  'allow. Edit it and try again." FAIL-OPEN: an unscreenable list passes. End users only. A refused '
  'attempt leaves NO record — the raise rolls back the transaction, and that was accepted. Does NOT '
  'cover edits: "participants can update messages" lets either party rewrite a body after sending.';

revoke all on function public.screen_message() from public, anon, authenticated;

drop trigger if exists trg_messages_90_screen on public.messages;
create trigger trg_messages_90_screen
  before insert on public.messages
  for each row execute function public.screen_message();

-- What the list looks like to the checker at the moment this applied: clean
-- (readable) or unscreenable. Never the words.
insert into public.migration_findings (version, item, value)
values ('0042', 'banned_words_state_at_apply', public.banned_words_check(''));

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0042', 'messages_are_screened', '22a4c781c2a6f23cdbcfc5982bcd802dab69eba3761e30c270d68646106d3053');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY — after applying. Each block is one self-contained paste.
--
-- ── BLOCK A — the list is readable, and no client can call the checker ──
--
--   select public.banned_words_check('') as list_state,
--          has_function_privilege('anon', 'public.banned_words_check(text)', 'execute')          as anon_can_call,
--          has_function_privilege('authenticated', 'public.banned_words_check(text)', 'execute') as authenticated_can_call,
--          has_function_privilege('service_role', 'public.banned_words_check(text)', 'execute')  as service_role_can_call;
--
--   Expect clean, false, false, false. 'unscreenable' means the settings row is
--   broken: every status post will queue and every message will pass.
--
-- ── BLOCK B — a listed word is a hit, without printing the word ─────────
--
--   select public.banned_words_check(
--            'verify 0042 ' || (
--              select btrim(w)
--              from jsonb_array_elements_text((select value::jsonb from public.settings
--                                              where key = 'banned_words')) w
--              where btrim(w) <> '' limit 1)) as should_be_hit;
--
--   Expect hit. NULL or clean means the list is empty, and a hit cannot be
--   exercised against it — say so rather than reading it as a pass.
--
-- ── BLOCK C — status posts behave exactly as before. Rolls itself back ──
--
--   do $$
--   declare v_p uuid; v_w text; v1 text; v2 text;
--   begin
--     select id into v_p from public.providers order by id limit 1;
--     select btrim(w) into v_w
--       from jsonb_array_elements_text((select value::jsonb from public.settings
--                                       where key = 'banned_words')) w
--      where btrim(w) <> '' limit 1;
--     insert into public.status_posts (provider_id, body)
--       values (v_p, 'verify 0042 ' || coalesce(v_w, '')) returning moderation_status into v1;
--     insert into public.status_posts (provider_id, body)
--       values (v_p, 'verify 0042 plain control') returning moderation_status into v2;
--     raise exception E'ROLLED BACK ON PURPOSE.\nwith a listed word: %  (expect pending)\nplain control:      %  (expect approved)', v1, v2;
--   end $$;
--
-- ── BLOCK D — a real participant is refused with CV001, and a plain
--               message still sends. Rolls itself back ─────────────────────
--
-- Uses the model test account (b0df9c2f…, CLAUDE.md) and its most recent
-- booking. The plain control, if RLS lets it in, fires message_push. That is
-- an AFTER INSERT trigger queuing through pg_net, which is transactional, so
-- the rollback discards it (INFERRED from how pg_net queues; not observed).
--
--   do $$
--   declare
--     v_user uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_sess uuid; v_w text; v_log text := '';
--   begin
--     select id into v_sess from public.sessions
--      where model_user_id = v_user order by date desc limit 1;
--     if v_sess is null then
--       raise exception 'No booking for the model test account — Block D cannot run.';
--     end if;
--     select btrim(w) into v_w
--       from jsonb_array_elements_text((select value::jsonb from public.settings
--                                       where key = 'banned_words')) w
--      where btrim(w) <> '' limit 1;
--
--     perform set_config('request.jwt.claims',
--       format('{"sub":"%s","role":"authenticated"}', v_user), true);
--     set local role authenticated;
--
--     begin
--       insert into public.messages (session_id, sender_id, body)
--         values (v_sess, v_user, 'verify 0042 ' || v_w);
--       v_log := v_log || E'\nlisted word:   INSERTED  <-- NOT SCREENED';
--     exception
--       when sqlstate 'CV001' then v_log := v_log || E'\nlisted word:   refused, CV001 (correct)';
--       when others then v_log := v_log || format(E'\nlisted word:   refused %s (%s)  <-- wrong code', sqlstate, sqlerrm);
--     end;
--
--     begin
--       insert into public.messages (session_id, sender_id, body)
--         values (v_sess, v_user, 'verify 0042 plain control');
--       v_log := v_log || E'\nplain control: inserted (correct)';
--     exception
--       when sqlstate 'CV001' then v_log := v_log || E'\nplain control: refused CV001  <-- FALSE REFUSAL';
--       when others then v_log := v_log || format(E'\nplain control: refused %s (%s) — by RLS, not the screen', sqlstate, sqlerrm);
--     end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.%', v_log;
--   end $$;
--
--   Expect "refused, CV001" and "inserted". A BEFORE trigger fires before RLS
--   checks the row, so the listed word reports CV001 even on a booking RLS
--   would refuse. The control can still be refused by RLS (a cancelled or
--   blocked booking); that line then says so and is not a screening failure.
--
-- ── BLOCK E — the trigger is where the name says it is ──────────────────
--
--   select tgname, tgenabled,
--          (tgtype & 2) = 2  as before,
--          (tgtype & 4) = 4  as on_insert,
--          (tgtype & 16) = 16 as on_update
--   from pg_trigger
--   where tgrelid = 'public.messages'::regclass and not tgisinternal
--   order by tgname;
--
--   Expect trg_messages_90_screen: enabled O, before true, on_insert true,
--   on_update false, alongside message_push (AFTER).
-- ===========================================================================


-- ===========================================================================
-- ⚠️ STAMP BEFORE YOU APPLY — NOT AFTER
--
--   node scripts/migration-status.mjs --stamp     <- BEFORE pasting this file
--   (paste the whole file into the Supabase SQL editor)
--   node scripts/migration-status.mjs             <- confirm: applied, no drift
--
-- WHY THE ORDER MATTERS. A new file's footer carries the placeholder checksum
-- (the pending sentinel), and --stamp replaces it with the real one. Apply
-- first and the database records the placeholder, which the checksum written
-- afterwards can never match, so the ledger reads DRIFTED from then on. 0040
-- was applied that way on 11 Sep 2026 and needed a reconcile by hand.
--
-- ⚠️ THIS BLOCK DELIBERATELY DOES NOT SPELL THE SENTINEL OUT. --stamp replaces
-- the FIRST occurrence of it in any file that contains it
-- (scripts/migration-status.mjs:139-140). Every migration from 0001 to 0041
-- carries it in this comment since the 13 Sep sweep (item 41), so a --stamp
-- run rewrites all 41 comments. Found 19 Sep, when stamping this file did
-- exactly that; the 41 were reverted before anything was committed.
--
-- The status report is still worth running last. It catches what no verify
-- block can: a migration written, committed, and never applied at all. It
-- needs the service-role key in the shell:
--   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--
-- Editing this block on an APPLIED migration is safe: it sits BELOW the
-- MIGRATION FOOTER line, and the checksum covers only what is above it.
-- ===========================================================================
