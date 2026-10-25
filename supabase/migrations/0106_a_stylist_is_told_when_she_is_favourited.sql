-- ===========================================================================
-- 0106_a_stylist_is_told_when_she_is_favourited
--
-- ⚠️ Apply 0105 first. A stylist is told when a model saves her shop.
--
-- `public.favourites` has NO TRIGGER OF ANY KIND (confirmed live, 25 Oct
-- 2026). Meg favourited Nhi @ SKINDUSTRY on 23 Oct at 13:06 and Nhi has never
-- been told. That is the most valuable thing this platform has produced so far
-- and it went nowhere.
--
-- ── ⚠️ CHAT IS NOT IN SCOPE AND IS NOT BROKEN ────────────────────────────
-- Messages already email: `tg_message_push` posts to send-email with
-- kind 'chat', throttled inside the function and bypassing `notifications`
-- entirely. email_sends carries kind='chat' rows proving it. Nothing here
-- touches that path.
--
-- ── ⚠️⚠️ THE FOSSIL, SETTLED BEFORE ADDING A TYPE NEXT TO IT ────────────
-- `notifications` holds both 'session_application' (5 rows, 6–11 Jul 2026) and
-- 'session_applied' (20 rows, 13 Jul – 9 Oct). They are a rename that
-- completed: the handover is clean to the day, both carry the identical title
-- "New treatment application", and 'session_applied' is what
-- `notify_session_applied` writes.
--
-- ✅ 'session_application' IS INERT, NOT A LIVE DUPLICATE. It appears in NO
-- migration and in NO application code — it predates the migration framework.
-- Nothing can produce another one. So it is five rows of history rather than a
-- second path to keep in step, and adding a type beside it is safe.
--
-- ⚠️ It is still worth knowing that a query asking the DATA what types exist
-- returns one more than the code can ever write.
--
-- ── ⚠️ THE FOUR LISTS, ALL IN THIS ONE MIGRATION PLUS ITS COMMIT ────────
--   1. notify_email's WHEN clause        is an email ATTEMPTED    (step 3)
--   2. run_email_reconcile's allowlist   is a missing one NOTICED (step 4)
--   3. copyFor() in send-email           what she SEES            (deployed)
--   4. check-email-type-coverage's lists was this DECIDED at all
--
-- ⚠️ AXIS 4 NEEDS NO EDIT, AND THAT IS CHECKED RATHER THAN ASSUMED. Its
-- NOT_EMAILED and DYNAMIC declarations exist for types that are deliberately
-- not emailed, or whose name is built at runtime. This one is emailed and is
-- written as a bare literal in the function below, so the scanner finds it by
-- itself. The checker's output is in the commit message.
--
-- ⚠️ AND THE BODIES HERE ARE PLAIN DDL, NOT chr(10). 0101 learned that: the
-- scanner reads the migration TEXT, and a body assembled from chr(10)
-- fragments is invisible to it — which broke the very check this type has to
-- satisfy. The trigger is drop-then-create for the same reason, because the
-- pattern is /create trigger notify_email\b/.
--
-- ── ⚠️ NEVER NOTIFY SOMEBODY OF THEIR OWN ACTION ────────────────────────
-- A 'both' account can favourite its own shop — nothing in the schema stops
-- it, which is audit item 216's neighbour. The function returns without
-- writing when the favouriter IS the owner.
--
-- ── ⚠️⚠️ DEDUPE IS AN INDEX, NOT A CHECK ────────────────────────────────
-- `favourites` rows are deleted and re-inserted freely — that is what
-- unfavourite then refavourite IS. Without a bound, a person could ring
-- somebody's inbox at will, which is a harassment vector before it is an
-- annoyance.
--
-- So: ONE shop_favourited notification per (recipient, favouriter, provider)
-- EVER, enforced by a partial unique index on expressions in the `data` jsonb
-- — the same shape as `notifications_one_per_broadcast` in 0101. An index
-- rather than a check-then-insert because two rapid clicks both pass a check
-- and only one can win an index.
--
-- ⚠️ "EVER" IS THE DELIBERATE CHOICE. A favourite is not a recurring event:
-- the second one carries no information the first did not. The cost is that a
-- genuine re-favourite years later is silent, which is the right side to err
-- on for something that reaches an inbox.
--
-- ── ⚠️ THE PREFERENCE CHECK IS NOT RE-IMPLEMENTED HERE ──────────────────
-- `send-email` decides it, in `recipient()` at index.ts:394-406:
--   `const wants = row.notification_preferences?.email?.enabled !== false`
-- Default ON, so null preferences or a missing key mean yes and nothing needs
-- backfilling; only an explicit `false` opts out. The 4 accounts carrying
-- {"email":{"enabled":false}} are refused there and logged as
-- skipped/'email notifications off'. Restating that here would be a second
-- copy of a rule with a live, working owner.
--
-- ── ⚠️ WHERE THE EMAIL SENDS HER, AND WHY NOT "YOUR FAVOURITES" ─────────
-- There is NO screen on which a stylist can see who favourited her. The
-- dashboard's "Favourites" panel is the MODEL's list of stylists SHE saved
-- (`dashboard.ts` reads `favourites` with `.eq('user_id', userId)`), and there
-- is no /favourites route at all — checked, not assumed.
--
-- So the copy must not promise a list. It names the person and sends her to
-- `/availability`, which exists and is the useful next action: posting times
-- notifies her favouriters through `new_availability`, and the model's own
-- dashboard already tells her "we'll tell you when they post new times". The
-- loop closes honestly.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0105') then
    raise exception '0106 needs 0105 applied first.';
  end if;
  if to_regclass('public.favourites') is null then
    raise exception '0106 needs public.favourites.';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.favourites'::regclass and not tgisinternal
  ) then
    raise exception '0106 expects no trigger on favourites yet; one exists. '
      'Read it before adding a second thing that fires on the same insert.';
  end if;
  -- The premise of the subject line and of not re-checking preferences.
  if to_regprocedure('public.tg_notify_email()') is null then
    raise exception '0106 needs tg_notify_email; without it the row is written and '
      'no email is ever attempted.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. One notification per (recipient, favouriter, provider), ever.
--
--    ⚠️ Built BEFORE the trigger, so the first insert the trigger ever
--    attempts is already bounded. Created without `if not exists`: nothing has
--    written this type, so an index that already exists is a surprise that
--    should stop the migration rather than be absorbed by it.
-- ---------------------------------------------------------------------------
create unique index notifications_one_per_shop_favourite
  on public.notifications (
    user_id,
    ((data ->> 'favouriter_id')),
    ((data ->> 'provider_id'))
  )
  where type = 'shop_favourited';

-- ---------------------------------------------------------------------------
-- 2. The trigger function.
--
--    SECURITY DEFINER because it reads `providers` and `users` to resolve the
--    owner and the name, and the favouriting model can read neither of those
--    rows for somebody else. search_path ends in pg_temp, per 0094.
-- ---------------------------------------------------------------------------
create or replace function public.tg_favourite_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_owner uuid;
  v_name  text;
  v_shop  text;
begin
  select p.user_id, nullif(btrim(coalesce(p.name, '')), '')
    into v_owner, v_shop
    from public.providers p
   where p.id = new.provider_id;

  -- No shop, or a shop with no owner: nothing to tell anyone.
  if v_owner is null then
    return new;
  end if;

  -- ⚠️ NEVER TELL SOMEBODY WHAT THEY JUST DID. A 'both' account can favourite
  -- its own shop; nothing in the schema prevents it.
  if v_owner = new.user_id then
    return new;
  end if;

  -- The same name shape tg_message_push builds: first name plus an initial,
  -- and nothing else. No postcode, no town, no email, no photo — a favourite
  -- is not an introduction.
  select coalesce(first_name, '')
         || case when last_initial is not null then ' ' || last_initial || '.' else '' end
    into v_name
    from public.users where id = new.user_id;

  v_name := coalesce(nullif(btrim(v_name), ''), 'Someone');

  -- ⚠️ `on conflict do nothing` AGAINST THE INDEX ABOVE. An unfavourite and a
  -- refavourite writes a new `favourites` row and fires this again; the index
  -- is what stops that reaching an inbox twice.
  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_owner,
    'shop_favourited',
    'Someone saved your shop',
    v_name || ' saved ' || coalesce(v_shop, 'your shop')
      || '. Post some times and they will hear about it.',
    jsonb_build_object(
      'favouriter_id', new.user_id,
      'provider_id',   new.provider_id)
  )
  on conflict do nothing;

  return new;
end
$fn$;

comment on function public.tg_favourite_notify() is
  'Tells a stylist when somebody saves her shop. One notification per '
  '(owner, favouriter, shop) ever, bounded by '
  'notifications_one_per_shop_favourite — a favourite can be removed and '
  'remade, and an inbox must not be ringable at will.';

-- ⚠️ A NEW FUNCTION STARTS AT EXECUTE TO PUBLIC. 0097, seventh time. A trigger
-- function needs no EXECUTE grant at all: the trigger invokes it, not a caller.
revoke all on function public.tg_favourite_notify() from public;
revoke all on function public.tg_favourite_notify() from anon;
revoke all on function public.tg_favourite_notify() from authenticated;

create trigger favourite_notify
  after insert on public.favourites
  for each row
  execute function public.tg_favourite_notify();

-- ---------------------------------------------------------------------------
-- 3. List 1 — the trigger decides whether an email is ATTEMPTED.
--
--    ⚠️ drop-then-create, NOT `create or replace trigger`: the scanner finds
--    this with /create trigger notify_email\b/ and the replace form does not
--    match it. 0101 learned that by watching it read an older migration's list
--    and report a true-sounding failure against the wrong file. Both halves
--    are in one transaction, so there is no window.
-- ---------------------------------------------------------------------------
drop trigger if exists notify_email on public.notifications;

create trigger notify_email
  after insert on public.notifications
  for each row
  when (new.type = any (array[
    'session_applied', 'session_accepted', 'session_declined', 'session_cancelled',
    'verification', 'payment_failed', 'admin_warning', 'admin_suspension',
    'session_expired', 'session_not_held', 'stylist_invite', 'admin_message',
    'admin_broadcast', 'shop_favourited'
  ]))
  execute function public.tg_notify_email();

-- ---------------------------------------------------------------------------
-- 4. List 2 — the reconciler decides whether a MISSING attempt is noticed.
--
--    ⚠️ THIS BODY IS THE LIVE ONE, TRANSFORMED. The live prosrc was read and
--    identified first — length 2315, md5 2e2a6845621e87544a1160a60b32250c,
--    CR 48 LF 48 — and ONE type was added to ONE list. Everything else is
--    byte-for-byte what was running, line endings aside.
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
                     'admin_broadcast',
                     'shop_favourited')
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
-- 5. ⚠️⚠️ POST-CONDITION: THE END STATE, READ FROM THE CATALOGUE.
--
--    ⚠️ NOT information_schema ANYWHERE GRANTS ARE INVOLVED. Its
--    column_privileges view expands a TABLE-level grant into one row per
--    column, which made a 0104 assertion unpassable on a schema that was
--    exactly right. pg_proc.proacl carries what was actually granted.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_when text;
  v_src  text;
  t      text;
  k_types constant text[] := array[
    'session_applied', 'session_accepted', 'session_declined', 'session_cancelled',
    'verification', 'payment_failed', 'admin_warning', 'admin_suspension',
    'session_expired', 'session_not_held', 'stylist_invite', 'admin_message',
    'admin_broadcast', 'shop_favourited'];
begin
  -- The trigger on favourites exists, fires AFTER INSERT, and is enabled.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.favourites'::regclass
      and tgname = 'favourite_notify'
      and not tgisinternal
      and tgenabled::text = 'O'
  ) then
    raise exception '0106: the favourite_notify trigger is missing or disabled.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tg_favourite_notify'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
  ) then
    raise exception '0106: tg_favourite_notify is not SECURITY DEFINER with '
      'search_path public, pg_temp.';
  end if;

  -- ⚠️ No PUBLIC execute. A null proacl means the EXECUTE-TO-PUBLIC default is
  -- in force and is NOT the same state as an explicit PUBLIC grantee — 0097
  -- had to learn that twice, so both are checked.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tg_favourite_notify'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  ) then
    raise exception '0106: tg_favourite_notify still grants EXECUTE to PUBLIC.';
  end if;

  -- The dedupe index, structurally rather than by name alone.
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'notifications_one_per_shop_favourite'
      and i.indrelid = 'public.notifications'::regclass
      and i.indisunique and i.indisvalid and i.indisready and i.indislive
  ) then
    raise exception '0106: notifications_one_per_shop_favourite is missing, not '
      'unique, or not valid. Without it a refavourite emails again.';
  end if;

  -- Lists 1 and 2 hold the SAME fourteen types.
  select pg_get_triggerdef(tg.oid, true) into v_when
  from pg_trigger tg
  where tg.tgrelid = 'public.notifications'::regclass and tg.tgname = 'notify_email';
  if v_when is null then
    raise exception '0106: the notify_email trigger is gone after replacing it.';
  end if;
  v_when := substring(v_when from 'WHEN \((.*?)\) EXECUTE');

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'run_email_reconcile';

  foreach t in array k_types loop
    if position('''' || t || '''' in v_when) = 0 then
      raise exception '0106: % is missing from the trigger WHEN clause.', t;
    end if;
    if position('''' || t || '''' in v_src) = 0 then
      raise exception '0106: % is missing from run_email_reconcile.', t;
    end if;
  end loop;

  -- Fourteen in the trigger, so a type REMOVED is caught as well as one not
  -- added — the loop above can only see absences.
  if (length(v_when) - length(replace(v_when, '''::text', ''))) / length('''::text') <> 14 then
    raise exception '0106: the trigger WHEN clause does not hold exactly 14 types: %', v_when;
  end if;

  -- The reconciler still does its other two jobs.
  if position('email_reconcile_runs' in v_src) = 0
     or position('delete from public.email_sends' in v_src) = 0 then
    raise exception '0106: run_email_reconcile lost its insert or its 90-day purge.';
  end if;
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0106', 'a_stylist_is_told_when_she_is_favourited', 'a66b4623b93ff3f20634d0dc75b054f6d440ee8488a63473509078a898dea0b0');

commit;

notify pgrst, 'reload schema';
