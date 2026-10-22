-- ===========================================================================
-- 0101_one_message_to_many_people_without_a_new_way_to_send_it
--
-- ⚠️ Apply 0100 first. One email to many members, from the admin console.
-- NOTHING UNDERNEATH IT CHANGES: not tg_notify_email, not send-email's
-- sending, unsubscribe handling or preferences, not email_sends. A broadcast
-- is a paced loop over a new RPC that writes the same kind of notification row
-- everything else already writes.
--
-- ── ⚠️ WHY A SIBLING AND NOT A PARAMETER ON notify_as_admin ───────────────
-- notify_as_admin hardcodes 'admin_message' as a literal, so it cannot write a
-- new type. Adding parameters in place is impossible: `create or replace
-- function` CANNOT change the argument list, and dropping and recreating it
-- with defaults would make `notify_as_admin()` ambiguous (42725) — 0099 lived
-- through exactly that. So this is a new function beside it, and the live
-- single-send path in admin/app/messages/page.tsx is not touched at all.
--
-- A broadcast also has semantics a single send does not: a broadcast id, a
-- dedupe, and a partial run that must be resumable. Those belong in their own
-- function rather than as defaulted arguments on one that needs none of them.
--
-- ── ⚠️⚠️ THE NEW TYPE GOES IN FOUR PLACES, AND THE FOURTH DECIDED THE SHAPE
-- ── OF THIS WHOLE FILE ────────────────────────────────────────────────────
-- check-email-type-coverage.mjs compares FOUR axes:
--   1. notify_email's WHEN clause        is an email ATTEMPTED    (step 4)
--   2. run_email_reconcile's allowlist   is a missing one NOTICED (step 5)
--   3. copyFor() in send-email           what the member SEES     (deployed)
--   4. every type anything WRITES        was this decided at all
--
-- ⚠️⚠️ AND THE FIRST DRAFT OF THIS MIGRATION BROKE AXIS 2 OUTRIGHT. Every
-- other recent migration builds function bodies from `chr(10)` so that item
-- 190's LF-to-CRLF rewriting on paste cannot change what lands, and asserts an
-- md5 afterwards. Done here, the reconciler's type list becomes
-- `chr(10) || '      and n.type in (''session_applied'', …'` — and the scanner,
-- which reads the migration TEXT, could no longer find the list at all. It
-- failed loudly: *"found run_email_reconcile in 0101 but not its type list.
-- Shape changed — read it before trusting this."*
--
-- ✅ IT WAS RIGHT TO REFUSE, AND THE SCANNER IS NOT THE THING THAT SHOULD BEND.
-- So all three bodies here are PLAIN DDL, and the md5 assertions are gone with
-- them. That is a deliberate trade, stated rather than quietly made:
--
--   * What is given up: proof that the bytes that landed are the bytes sent.
--     It is worth little for three objects whose exact bytes nothing depends
--     on, and the reconciler's live body is ALREADY CRLF (46/46) — it was
--     pasted once before, so CRLF is its normal state, not a corruption.
--   * What is kept: a check that can read this file. Axis 2 exists to catch
--     precisely the drift this migration creates, and a defence that blinds it
--     costs more than it saves.
--   * What replaces md5: assertions on SHAPE and CONTENT in step 6 — the
--     return signature, SECURITY DEFINER, search_path, the ACL, and every one
--     of the thirteen types present in BOTH lists, read from the catalogue.
--
-- Audit item 220 records the blind spot; this file is where it was paid for.
--
-- ── ⚠️⚠️ THE SUBJECT IS THE ADMIN'S OWN TITLE, AND THAT IS NOW SAFE ──────
-- copyFor hardcodes admin_message's subject because, it says, "until item
-- 144's stage F, the open INSERT policy means a MEMBER can write an
-- admin_message row too."
--
-- STAGE F HAS LANDED. Read live: the only INSERT policy on notifications is
-- `notifications_insert_denied [RESTRICTIVE] with check (false)`. Nothing
-- inserts directly; only SECURITY DEFINER functions can, and both writers of
-- admin types check is_admin() first. So an admin_broadcast title is provably
-- admin-authored and can be the subject line — which a broadcast needs,
-- because "A message from Cavy" in an inbox list tells nobody what arrived.
-- Step 0 ASSERTS that policy: if it ever loosens, this migration's premise is
-- gone and the refusal is where it shows up.
--
-- ⚠️ admin_message's own hardcoded subject is NOT changed here. Its stated
-- reason is stale (item 219) but the behaviour is fine, and a live single-send
-- path is not something to alter in passing.
--
-- ── ⚠️⚠️ PACING IS PROTECTION, NOT POLITENESS ────────────────────────────
-- Resend allows 10 requests per second per team. pg_net.batch_size is 200
-- (read live) and notify_email fires per row, so N rows inserted together
-- become N near-simultaneous sends and anything past the tenth in a second
-- takes a 429.
--
-- ⚠️ AND run_email_reconcile DOES NOT RETRY. Read live: it counts into
-- email_reconcile_runs and deletes rows over 90 days. It NOTICES a failure; it
-- never resends one. So a 429 is permanent, not deferred, and the client-side
-- delay between calls is the only thing preventing it. That is why this
-- function takes ONE recipient rather than an array: a set-based insert cannot
-- be paced, and pacing is the protection.
--
-- ── ⚠️ SENDING TWICE IS PREVENTED BY AN INDEX, NOT BY THE CLIENT ─────────
-- The existing dedupe does not cover this: email_sends_one_per_notification is
-- unique on ref_id where kind='notification' and status='sent', and ref_id is
-- the NOTIFICATION id — a second broadcast makes new rows with new ids and
-- would send again. So every row carries data->>'broadcast_id' and
-- notifications_one_per_broadcast is unique on (user_id, that) for this type.
-- A double click, a reload, or resuming a half-finished run all converge on
-- the same set, and the function reports was_new=false rather than failing.
--
-- ── ⚠️⚠️ admin_signin_facts READS auth.users ─────────────────────────────
-- It is the most sensitive thing in this migration and is built that way. The
-- console runs on the ANON key with the admin's own session, so it cannot read
-- auth.users at all; "never signed in" has no other source, and deriving it
-- from created_at would be inventing data. It returns THREE COLUMNS, checks
-- is_admin() in its own body, pins search_path with pg_temp last, and is
-- revoked from public and anon — a new DEFINER function starts at EXECUTE TO
-- PUBLIC (0097, third time).
--
-- ⚠️ AND IT SELECTS EXACTLY ONE ROW TODAY, so neither of us mistakes it for a
-- useful filter yet: of 40 members, last_sign_in_at is null for one, and that
-- one is also the only unconfirmed address — confirmed-but-never-signed-in is
-- ZERO. It earns its place as the list grows. Audit item 221.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0100') then
    raise exception '0101 needs 0100 applied first.';
  end if;

  if to_regprocedure('public.is_admin()') is null then
    raise exception '0101 needs is_admin() and it does not exist.';
  end if;

  if to_regprocedure('public.notify_as_admin(uuid,text,text)') is null then
    raise exception '0101 expects notify_as_admin to exist and be left alone; it is missing.';
  end if;

  if to_regprocedure('public.run_email_reconcile(integer)') is null then
    raise exception '0101 replaces run_email_reconcile and it does not exist.';
  end if;

  -- ⚠️ THE PREMISE OF THE SUBJECT LINE. See the header.
  if not exists (
    select 1 from pg_policy p
    where p.polrelid = 'public.notifications'::regclass
      and p.polname = 'notifications_insert_denied'
      and not p.polpermissive
      and coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '') = 'false'
  ) then
    raise exception '0101 assumes notifications is closed to direct INSERT (item 144 '
      'stage F). That policy is not as expected, so an admin_broadcast title may not '
      'be admin-authored and must not become a subject line.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'data'
  ) then
    raise exception '0101 needs notifications.data to carry the broadcast id.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The dedupe. An index, so two racing clicks cannot both win.
--
--    NOT `if not exists`: nothing has ever written this type, so an index that
--    already exists is a surprise and should stop the migration rather than be
--    absorbed by it. 0093's lesson, applied the other way round.
-- ---------------------------------------------------------------------------
create unique index notifications_one_per_broadcast
  on public.notifications (user_id, ((data ->> 'broadcast_id')))
  where type = 'admin_broadcast';

-- ---------------------------------------------------------------------------
-- 2. The writer. One recipient per call, because pacing is the protection.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_as_admin(
  p_user_id      uuid,
  p_title        text,
  p_body         text,
  p_broadcast_id uuid
)
returns table(notification_id uuid, was_new boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'broadcast_as_admin: not an admin' using errcode = '42501';
  end if;
  if p_user_id is null or p_broadcast_id is null then
    raise exception 'broadcast_as_admin: a recipient and a broadcast id are both needed'
      using errcode = '22023';
  end if;
  -- The console refuses an empty one too. Enforced here because the console is
  -- not the only possible caller once this exists -- notify_as_admin's reason,
  -- and it holds for the same reason.
  if v_title is null or v_body is null then
    raise exception 'broadcast_as_admin: a message needs a title and a body'
      using errcode = '22023';
  end if;

  -- ⚠️ THE DEDUPE IS THE INDEX, NOT A CHECK-THEN-INSERT. Two clicks racing
  -- each other both pass a check; only one of them can win a unique index.
  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, 'admin_broadcast', v_title, v_body,
          jsonb_build_object('broadcast_id', p_broadcast_id))
  on conflict (user_id, ((data ->> 'broadcast_id'))) where type = 'admin_broadcast'
  do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  -- Already written for this person in this broadcast. Return the row that
  -- exists rather than nothing, so a resumed run reports it as already sent
  -- instead of as a failure.
  select n.id into v_id
  from public.notifications n
  where n.user_id = p_user_id
    and n.type = 'admin_broadcast'
    and n.data ->> 'broadcast_id' = p_broadcast_id::text;

  return query select v_id, false;
end
$fn$;

comment on function public.broadcast_as_admin(uuid, text, text, uuid) is
  'One recipient of one broadcast. Idempotent per (user, broadcast_id) via '
  'notifications_one_per_broadcast. Called in a paced loop: Resend allows 10 '
  'requests/second and run_email_reconcile does not retry, so a 429 is permanent.';

-- ---------------------------------------------------------------------------
-- 3. The sign-in read. Three columns, admin only. See the header.
-- ---------------------------------------------------------------------------
create or replace function public.admin_signin_facts()
returns table(user_id uuid, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not public.is_admin() then
    raise exception 'admin_signin_facts: not an admin' using errcode = '42501';
  end if;

  -- ⚠️ THREE COLUMNS AND NO MORE. This is the only thing in the product that
  -- reads auth.users for display. It returns the two timestamps the console
  -- asks about and nothing else: no address, no token, no provider identity,
  -- no recovery fields. Widening it is a decision, not a convenience.
  return query
    select au.id, au.last_sign_in_at, au.email_confirmed_at
    from auth.users au
    join public.users u on u.id = au.id;
end
$fn$;

comment on function public.admin_signin_facts() is
  'Admin-only. The only read of auth.users in the product: three columns, for '
  'the broadcast audience list. Gated on is_admin() in the body, not by RLS.';

-- ---------------------------------------------------------------------------
-- 4. ⚠️ BOTH NEW FUNCTIONS START AT EXECUTE TO PUBLIC. 0097, third time.
-- ---------------------------------------------------------------------------
revoke all on function public.broadcast_as_admin(uuid, text, text, uuid) from public;
revoke all on function public.broadcast_as_admin(uuid, text, text, uuid) from anon;
grant execute on function public.broadcast_as_admin(uuid, text, text, uuid) to authenticated;

revoke all on function public.admin_signin_facts() from public;
revoke all on function public.admin_signin_facts() from anon;
grant execute on function public.admin_signin_facts() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Axis 1 — the trigger decides whether an email is ATTEMPTED.
--
--    Replaced whole rather than altered: a WHEN clause cannot be appended to,
--    and the full list in one place is what check-email-type-coverage reads.
--
--    ⚠️⚠️ DROP-THEN-CREATE, NOT `create or replace trigger`, AND THAT IS THE
--    SECOND TIME THIS FILE HAS BENT TOWARDS THE SCANNER RATHER THAN THE OTHER
--    WAY. The checker finds the trigger with /create trigger notify_email\b/.
--    `create or replace trigger` does not match it, so the check silently read
--    0082's older list instead and reported MY new type as "RECONCILED but not
--    emailed" — a true-sounding failure pointing at the wrong file.
--
--    ⚠️ Note what that near-miss was: not a false pass, but a false diagnosis,
--    which costs the next person the same hour it cost this one. Both halves
--    are inside one transaction, so drop-then-create has no window the replace
--    form would have closed.
-- ---------------------------------------------------------------------------
drop trigger if exists notify_email on public.notifications;

create trigger notify_email
  after insert on public.notifications
  for each row
  when (new.type = any (array[
    'session_applied', 'session_accepted', 'session_declined', 'session_cancelled',
    'verification', 'payment_failed', 'admin_warning', 'admin_suspension',
    'session_expired', 'session_not_held', 'stylist_invite', 'admin_message',
    'admin_broadcast'
  ]))
  execute function public.tg_notify_email();

-- ---------------------------------------------------------------------------
-- 6. Axis 2 — the reconciler decides whether a MISSING attempt is noticed.
--
--    ⚠️ THIS BODY IS THE LIVE ONE, TRANSFORMED, NOT THE REPO'S COPY. The live
--    prosrc was read and identified first — length 2273, md5
--    0a71edf62d89368f793aac888dc467c2, CR 46 LF 46 — then ONE type was added to
--    ONE list. Everything else below is byte-for-byte what was running, line
--    endings aside.
-- ---------------------------------------------------------------------------
create or replace function public.run_email_reconcile(p_hours integer default 24)
returns public.email_reconcile_runs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.email_reconcile_runs;
  v_since timestamptz := now() - make_interval(hours => p_hours);
begin
  -- ⚠️ NOTHING MAY COME BETWEEN THIS `with` AND THE `insert` BELOW IT.
  -- A CTE attaches to the single statement that follows it. From 0047 to 0069
  -- a DELETE sat here and this function raised 42P01 on every call it ever had,
  -- nightly, while appearing to be a working monitor (item 136).
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      -- ⚠️ MUST MATCH THE notify_email TRIGGER'S WHEN CLAUSE. The trigger
      -- decides whether an email is attempted; this decides whether a missing
      -- attempt is noticed. A type in one and not the other is emailed and
      -- never checked — where admin_suspension sat from 0061 to 0068.
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired',
                     'session_not_held', 'stylist_invite', 'admin_message',
                     'admin_broadcast')
  ),
  attempts as (
    select e.id,
           max(case when s.status = 'sent'    then 1 else 0 end) as sent,
           max(case when s.status = 'failed'  then 1 else 0 end) as failed,
           max(case when s.status = 'skipped' then 1 else 0 end) as skipped,
           count(s.id)                                           as tries
    from emailable e
    left join public.email_sends s on s.kind = 'notification' and s.ref_id = e.id
    group by e.id
  )
  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  -- 90 days, per the Privacy policy. Position is load-bearing: see above.
  delete from public.email_sends where created_at < now() - interval '90 days';

  return v_row;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 7. ⚠️⚠️ POST-CONDITION: THE END STATE, MEASURED.
--
--    This is what replaces the md5 assertions, and on one count it is stronger
--    than they were: it asserts that the trigger's list and the reconciler's
--    list hold the SAME thirteen types, read from the CATALOGUE. md5 would
--    only have proved each body was the one typed.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_trig text;
  v_src  text;
  v_when text;
  t      text;
  k_types constant text[] := array[
    'session_applied', 'session_accepted', 'session_declined', 'session_cancelled',
    'verification', 'payment_failed', 'admin_warning', 'admin_suspension',
    'session_expired', 'session_not_held', 'stylist_invite', 'admin_message',
    'admin_broadcast'];
begin
  select pg_get_triggerdef(tg.oid, true) into v_trig
  from pg_trigger tg
  where tg.tgrelid = 'public.notifications'::regclass and tg.tgname = 'notify_email';
  if v_trig is null then
    raise exception '0101: the notify_email trigger is gone after replacing it.';
  end if;
  v_when := substring(v_trig from 'WHEN \((.*?)\) EXECUTE');
  if v_when is null then
    raise exception '0101: cannot find the trigger WHEN clause to check it: %', v_trig;
  end if;

  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_email_reconcile';

  foreach t in array k_types loop
    if position('''' || t || '''' in v_when) = 0 then
      raise exception '0101: % is missing from the trigger WHEN clause.', t;
    end if;
    if position('''' || t || '''' in v_src) = 0 then
      raise exception '0101: % is missing from run_email_reconcile.', t;
    end if;
  end loop;

  -- Thirteen in the trigger, so a type REMOVED is caught as well as one not
  -- added. The loop above can only see absences.
  if (length(v_when) - length(replace(v_when, '''::text', ''))) / length('''::text') <> 13 then
    raise exception '0101: the trigger WHEN clause does not hold exactly 13 types: %', v_when;
  end if;

  -- The reconciler still does its other two jobs. A body that lost the insert
  -- or the purge would still pass the type checks above.
  if position('email_reconcile_runs' in v_src) = 0
     or position('delete from public.email_sends' in v_src) = 0 then
    raise exception '0101: run_email_reconcile lost its insert or its 90-day purge.';
  end if;

  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'notifications_one_per_broadcast'
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
      and i.indrelid = 'public.notifications'::regclass
  ) then
    raise exception '0101: notifications_one_per_broadcast is missing, not unique, or not valid.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('broadcast_as_admin', 'admin_signin_facts')
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0101: a new function still grants EXECUTE to PUBLIC. A null acl '
      'means the default is in force and is not the same state as a PUBLIC grantee.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('broadcast_as_admin', 'admin_signin_facts', 'run_email_reconcile')
      and (not p.prosecdef
           or array_to_string(p.proconfig, ',') <> 'search_path=public, pg_temp')
  ) then
    raise exception '0101: a function is not SECURITY DEFINER with search_path '
      'public, pg_temp. 0094 undone.';
  end if;

  -- ⚠️ THE SENSITIVE ONE: its shape IS its safety, so the signature is asserted
  -- rather than trusted. A fourth column added later would not be caught by
  -- any other check in this file.
  if (select pg_get_function_result(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_signin_facts')
     <> 'TABLE(user_id uuid, last_sign_in_at timestamp with time zone, '
        'email_confirmed_at timestamp with time zone)' then
    raise exception '0101: admin_signin_facts does not return exactly the three '
      'columns it is allowed to return.';
  end if;
  if (select position('is_admin()' in p.prosrc) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_signin_facts') = 0 then
    raise exception '0101: admin_signin_facts does not check is_admin(). It reads '
      'auth.users as its owner; without that check it is an open door.';
  end if;

  if (select position('is_admin()' in p.prosrc) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'broadcast_as_admin') = 0 then
    raise exception '0101: broadcast_as_admin does not check is_admin().';
  end if;

  -- ⚠️ notify_as_admin MUST BE UNTOUCHED. Not touching it was the whole case
  -- for a sibling, so it is asserted rather than assumed.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'notify_as_admin') <> 1 then
    raise exception '0101: notify_as_admin should still be exactly one function.';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_as_admin'
      and position('''admin_message''' in p.prosrc) > 0
      and position('admin_broadcast' in p.prosrc) = 0
  ) then
    raise exception '0101: notify_as_admin has changed. It should still write '
      'admin_message and know nothing about admin_broadcast.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0101', 'one_message_to_many_people_without_a_new_way_to_send_it', 'da9ebddd7dc68fd9dc9c304722dbc53ea0811dd02ea15fd3621e4a34d5f789bf');

commit;

notify pgrst, 'reload schema';
