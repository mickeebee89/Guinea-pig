-- ===========================================================================
-- 0047_email_notifications
--
-- Email for the eight events a web-only member would otherwise never hear
-- about. Audit item 74. Decisions: Micky, 22 Sep 2026.
--
-- ⚠️ Apply 0046 first. ⚠️ DEPLOY send-email BEFORE APPLYING, and install the
-- shared secret straight after — see the DEPLOY block at the foot of this file.
-- Until the secret is in Vault the triggers call the function with an empty
-- secret, the function refuses, and every row is logged as 'failed'. Nothing
-- else breaks: a refused email never blocks the notification.
--
-- ── WHAT GETS AN EMAIL, AND WHAT DOESN'T ────────────────────────────────
-- Emailed: session_applied, session_accepted, session_declined,
-- session_cancelled, verification, payment_failed, admin_warning, and a new
-- chat message.
-- Not emailed: new_availability, stylist_invite, admin_message,
-- session_completed. The first is a mass send (one per favouriter), and the
-- rest are not worth an interruption.
--
-- The list lives in the trigger's WHEN clause, so an unlisted type never even
-- reaches the function. One place, checked by the database.
--
-- ── SHAPE: THE PUSH PATTERN, WITH THREE ADDITIONS ───────────────────────
-- Like push-setup.sql: a trigger on notifications posts to an edge function
-- through pg_net, carrying a shared secret from Vault. What email adds:
--   1. the type filter above;
--   2. a preference check (users.notification_preferences);
--   3. email_sends, a log of every attempt, which also provides the chat
--      throttle and the nightly reconcile.
--
-- ── THE SHARED SECRET IS INSTALLED BY THE FUNCTION, NOT PASTED ──────────
-- push_hook_secret had to be pasted into two places, which is how the live
-- value ended up in pg_proc (audit item 36). Here EMAIL_HOOK_SECRET exists
-- only as the edge function's own secret, and nobody has the value. So the
-- FUNCTION writes it into Vault, once, through
-- install_email_hook_secret() below, authenticated with the service-role key.
-- The value never appears on a screen or in shell history.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.notifications') is null or to_regclass('public.users') is null then
    raise exception '0047: notifications or users is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'notification_preferences'
  ) then
    raise exception '0047: users.notification_preferences is missing — the preference has nowhere to live.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '0047: pg_net is not installed, so a trigger cannot call the function (push-setup.sql installs it).';
  end if;
  if to_regclass('vault.secrets') is null then
    raise exception '0047: Supabase Vault is not available, so the shared secret has nowhere to live.';
  end if;
  if to_regclass('public.email_sends') is not null then
    raise exception '0047: public.email_sends already exists. Read it before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE LOG. Every attempt, including the ones we chose not to send.
--
-- It does three jobs, and that is deliberate — one table nobody can forget to
-- write:
--   * the chat throttle reads it (one email per conversation per hour);
--   * a repeated notification cannot send twice (the unique index below);
--   * the nightly reconcile compares it against notifications, so "no emails
--     arrived" is visible instead of looking like a quiet week.
--
-- status: 'sent' | 'failed' | 'skipped'. A skip is a decision (preferences
-- off, inside the throttle window) and is recorded, because "why did I not
-- get an email" is the question this table exists to answer.
-- ---------------------------------------------------------------------------
create table public.email_sends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  -- 'notification' (ref_id = notifications.id) or 'chat' (ref_id = sessions.id)
  kind        text not null check (kind in ('notification', 'chat', 'test')),
  ref_id      uuid,
  -- The notification type, or 'chat'. Kept so the reconcile can report by type.
  event       text,
  status      text not null check (status in ('sent', 'failed', 'skipped')),
  reason      text,
  provider_id text,
  created_at  timestamptz not null default now()
);

comment on table public.email_sends is
  'One row per email the send-email function decided about: sent, failed, or deliberately skipped. '
  'Drives the chat throttle, stops a notification being emailed twice, and feeds the nightly '
  'reconcile. 0047, audit item 74.';

-- One email per notification row, ever. A retry that arrives after a success
-- is refused by the database rather than by the function remembering.
create unique index email_sends_one_per_notification
  on public.email_sends (ref_id)
  where kind = 'notification' and status = 'sent';

create index email_sends_chat_window on public.email_sends (user_id, ref_id, created_at desc)
  where kind = 'chat';
create index email_sends_recent on public.email_sends (created_at desc);

alter table public.email_sends enable row level security;

-- Admins can read it; nobody else. The function uses the service role, which
-- bypasses RLS. No policy for insert/update/delete: the log is not client-writable.
create policy email_sends_select_admin on public.email_sends
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. UNSUBSCRIBE TOKENS.
--
-- A per-person random token, so the link in an email needs no signing secret
-- shared with the website: the site looks the token up. It can only turn email
-- OFF (unsubscribe_email below). Turning it back on needs a sign-in, so a
-- leaked link cannot be used to re-subscribe someone or to read anything.
-- ---------------------------------------------------------------------------
create table public.email_unsubscribe_tokens (
  user_id    uuid primary key references public.users (id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.email_unsubscribe_tokens enable row level security;
-- No policies at all: only the service role (the function) and the two
-- SECURITY DEFINER functions below ever touch it.

comment on table public.email_unsubscribe_tokens is
  'One unguessable token per member, put in the unsubscribe link of every notification email. '
  'Lets the website turn email off without a session and without a shared signing secret. 0047.';

-- Called by the edge function (service role): the token for this person,
-- created on first use.
create function public.email_unsubscribe_token(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_token text;
begin
  select token into v_token from public.email_unsubscribe_tokens where user_id = p_user_id;
  if v_token is not null then return v_token; end if;

  -- 32 bytes of randomness, url-safe.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.email_unsubscribe_tokens (user_id, token)
  values (p_user_id, v_token)
  on conflict (user_id) do update set token = excluded.token
  returning token into v_token;
  return v_token;
end $$;

revoke all on function public.email_unsubscribe_token(uuid) from public, anon, authenticated;

-- Called by the WEBSITE with the public key, from the unsubscribe link.
-- Turns email off for whoever holds the token, and does nothing else. Returns
-- true when a token matched, so the page can say plainly what happened.
create function public.unsubscribe_email(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid;
begin
  if p_token is null or length(p_token) < 20 then return false; end if;
  select user_id into v_user from public.email_unsubscribe_tokens where token = p_token;
  if v_user is null then return false; end if;

  update public.users
     set notification_preferences =
           coalesce(notification_preferences, '{}'::jsonb) || '{"email": {"enabled": false}}'::jsonb
   where id = v_user;
  return true;
end $$;

comment on function public.unsubscribe_email(text) is
  'Turns email notifications OFF for the holder of an unsubscribe token. Never turns them on — that '
  'needs a sign-in — so a forwarded or leaked link cannot be used against someone. 0047.';

revoke all on function public.unsubscribe_email(text) from public;
grant execute on function public.unsubscribe_email(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE SHARED SECRET, INSTALLED BY THE FUNCTION.
--
-- The edge function calls this once, with the service-role key, passing its own
-- EMAIL_HOOK_SECRET. Nobody has to read or paste the value. Re-running it is
-- safe and is how the secret would be rotated: change the function secret,
-- redeploy, call install again.
-- ---------------------------------------------------------------------------
create function public.install_email_hook_secret(p_secret text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'install_email_hook_secret: refusing a secret shorter than 16 characters'
      using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = 'email_hook_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'email_hook_secret',
      'Shared secret the notification triggers send to the send-email function (0047).');
    return 'created';
  end if;
  perform vault.update_secret(v_id, p_secret);
  return 'updated';
end $$;

comment on function public.install_email_hook_secret(text) is
  'Writes the send-email function''s own EMAIL_HOOK_SECRET into Vault, so the triggers can send the '
  'same value. Called by the function itself with the service-role key, so the secret never appears '
  'on a screen or in shell history (0047; contrast push_hook_secret, audit item 36).';

revoke all on function public.install_email_hook_secret(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE TRIGGER ON notifications.
--
-- WHEN filters the types, so an unlisted type costs nothing at all. The call
-- is fire-and-forget through pg_net, exactly like push: a slow or broken email
-- function must never hold up, or roll back, the thing that caused it.
-- ---------------------------------------------------------------------------
create function public.tg_notify_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-email-secret', coalesce((select decrypted_secret from vault.decrypted_secrets
                                              where name = 'email_hook_secret'), '')),
    body    := jsonb_build_object('kind', 'notification', 'notification_id', new.id));
  return new;
end $$;

revoke all on function public.tg_notify_email() from public, anon, authenticated;

create trigger notify_email after insert on public.notifications
  for each row
  when (new.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed', 'admin_warning'))
  execute function public.tg_notify_email();

-- ---------------------------------------------------------------------------
-- 5. CHAT: ONE MORE CALL IN THE TRIGGER THAT ALREADY EXISTS.
--
-- A new message creates no notifications row, so there is nothing for the
-- trigger above to see. tg_message_push (push-setup.sql:66-105) already works
-- out who the other party is; this is that function with one extra post, NOT a
-- second trigger — a second one would be a second copy of the recipient rule,
-- and those drift.
--
-- The body is NOT put in the email. The email says a message is waiting; the
-- message itself stays in the app, where the block and report controls are.
-- The hourly throttle lives in the function, against email_sends.
-- ---------------------------------------------------------------------------
create or replace function public.tg_message_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_model         uuid;
  v_provider_user uuid;
  v_recipient     uuid;
  v_sender_name   text;
begin
  select s.model_user_id, p.user_id
    into v_model, v_provider_user
    from public.sessions s
    join public.providers p on p.id = s.provider_id
   where s.id = new.session_id;

  if v_model is null then return new; end if;

  v_recipient := case when new.sender_id = v_model then v_provider_user else v_model end;
  if v_recipient is null or v_recipient = new.sender_id then return new; end if;

  select coalesce(first_name, '')
         || case when last_initial is not null then ' ' || last_initial || '.' else '' end
    into v_sender_name
    from public.users where id = new.sender_id;

  perform net.http_post(
    url     := 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_hook_secret'), '')),
    body    := jsonb_build_object(
                 'user_id', v_recipient,
                 'title',   coalesce(nullif(trim(v_sender_name), ''), 'New message'),
                 'body',    new.body,
                 'data',    jsonb_build_object('type', 'new_message', 'session_id', new.session_id)));

  -- 0047: the same recipient, by email. Throttled in the function.
  perform net.http_post(
    url     := 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-email-secret', coalesce((select decrypted_secret from vault.decrypted_secrets
                                              where name = 'email_hook_secret'), '')),
    body    := jsonb_build_object(
                 'kind',        'chat',
                 'user_id',     v_recipient,
                 'session_id',  new.session_id,
                 'sender_name', coalesce(nullif(trim(v_sender_name), ''), 'Someone')));

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. THE NIGHTLY RECONCILE.
--
-- The log says what the function decided. It cannot say that the CALL never
-- happened — pg_net down, the secret wrong, the function undeployed. That
-- failure is silent, and silence looks exactly like a quiet day.
--
-- So once a night: count the emailable notifications of the last 24 hours that
-- have no email_sends row at all, and record it. It reports; it never resends.
-- ---------------------------------------------------------------------------
create table public.email_reconcile_runs (
  id            uuid primary key default gen_random_uuid(),
  ran_at        timestamptz not null default now(),
  window_hours  integer not null,
  emailable     integer not null,
  sent          integer not null,
  failed        integer not null,
  skipped       integer not null,
  no_attempt    integer not null
);

alter table public.email_reconcile_runs enable row level security;
create policy email_reconcile_select_admin on public.email_reconcile_runs
  for select to authenticated using (public.is_admin());

comment on table public.email_reconcile_runs is
  'One row a night: emailable notifications in the window, against what email_sends recorded. '
  'no_attempt > 0 means the trigger never reached the function — the failure the log itself cannot '
  'show. 0047, audit item 74.';

create function public.run_email_reconcile(p_hours integer default 24)
returns public.email_reconcile_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.email_reconcile_runs;
  v_since timestamptz := now() - make_interval(hours => p_hours);
begin
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed', 'admin_warning')
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
  -- 90 days, because that is what the Privacy policy now says: "A record that
  -- we sent you an email … kept for 90 days". Deleted here rather than in
  -- run_retention_purge so the promise is kept by the job that runs nightly,
  -- not monthly. The reconcile only ever looks at the last 24 hours.
  delete from public.email_sends where created_at < now() - interval '90 days';

  insert into public.email_reconcile_runs (window_hours, emailable, sent, failed, skipped, no_attempt)
  select p_hours,
         count(*),
         coalesce(sum(sent), 0),
         coalesce(sum(case when sent = 0 and failed = 1 then 1 else 0 end), 0),
         coalesce(sum(case when sent = 0 and failed = 0 and skipped = 1 then 1 else 0 end), 0),
         coalesce(sum(case when tries = 0 then 1 else 0 end), 0)
  from attempts
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.run_email_reconcile(integer) from public, anon, authenticated;

-- 04:10 every day, after the nightly quiet period and clear of the monthly
-- retention purge at 03:20 (0005).
select cron.schedule('email-reconcile', '10 4 * * *', $$select public.run_email_reconcile(24);$$);

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0047', 'email_notifications', '29a82a50b963fa41370193e9342a5721d7132a42ee0653a0fd02bd29b91794f3');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY — in this order. Step 1 is not optional and step 4 is the one that
-- matters.
--
--   1. THE WEBSITE FIRST. Every email carries two links into it: the visible
--      unsubscribe link (/email/unsubscribe) and the List-Unsubscribe header
--      (/email/unsubscribe/confirm). Push to main and wait for the Vercel
--      PRODUCTION deploy to finish. On 22 Sep 2026 a test email went out
--      ahead of that deploy and its unsubscribe link 404'd.
--        curl.exe -s -o NUL -w "%{http_code}\n" "https://cavybeauty.com/email/unsubscribe?t=x"
--      Expect 200. Steps 3 and 4 now refuse to run until it is.
--
--   2. Deploy the function (from the repo root):
--        npx supabase functions deploy send-email --no-verify-jwt
--      --no-verify-jwt because the caller is a database trigger, which sends
--      the shared secret instead of a JWT. Same as send-push.
--
--   3. Apply this migration.
--
--   4. Install the secret, with the service-role key in THIS shell only:
--        $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
--        node scripts/install-email-secret.mjs
--      The function copies its own EMAIL_HOOK_SECRET into Vault. Nothing
--      prints the secret. THIS IS WHAT ARMS IT: until Vault holds the secret
--      every trigger call is refused, so nothing is sent before this step.
--
--   5. Send one test email to a real address, before any member gets one:
--        node scripts/send-test-email.mjs you@example.com
--
--   6. Then Block A below.
-- ===========================================================================
--
-- ── BLOCK A — installed, and the secret is in place. Read-only ──────────
--
--   select
--     exists (select 1 from pg_trigger where tgrelid = 'public.notifications'::regclass
--              and tgname = 'notify_email' and tgenabled = 'O')                       as notifications_trigger,
--     pg_get_functiondef('public.tg_message_push()'::regprocedure) like '%send-email%' as chat_hook,
--     (select count(*) from vault.secrets where name = 'email_hook_secret')            as secret_rows,
--     (select length(decrypted_secret) > 16 from vault.decrypted_secrets
--       where name = 'email_hook_secret')                                             as secret_looks_real,
--     (select count(*) from cron.job where jobname = 'email-reconcile')                as reconcile_job,
--     to_regclass('public.email_sends') is not null                                    as log_table;
--
--   Expect true, true, 1, true, 1, true. secret_rows 0 means step 3 has not
--   run and every email will be refused.
--
-- ── BLOCK B — what the test email left behind. Read-only ────────────────
--
--   select kind, event, status, reason, provider_id is not null as has_provider_id, created_at
--   from public.email_sends order by created_at desc limit 5;
--
--   After the step-4 test: one row, kind 'test', status 'sent', with a
--   provider id. A 'failed' row carries the reason in `reason`.
--
-- ── BLOCK C — the type filter really is a filter. Rolls itself back ─────
--
-- Inserts one emailable and one non-emailable notification for the model test
-- account and reports how many pg_net requests each produced. Rolled back, so
-- no notification and no email survives — but note pg_net may already have
-- POSTED the emailable one, which is why the row it creates is a test row for
-- the model test account rather than for a real member.
--
--   do $$
--   declare
--     v_user constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_before bigint; v_after_yes bigint; v_after_no bigint;
--   begin
--     select count(*) into v_before from net._http_response;
--
--     insert into public.notifications (user_id, type, title, body)
--     values (v_user, 'session_accepted', 'Verify 0047', 'Rolled back.');
--     select count(*) into v_after_yes from net._http_response;
--
--     insert into public.notifications (user_id, type, title, body)
--     values (v_user, 'admin_message', 'Verify 0047', 'Rolled back.');
--     select count(*) into v_after_no from net._http_response;
--
--     raise exception E'ROLLED BACK ON PURPOSE.\nemailable type queued: %\nnon-emailable queued: %',
--       v_after_yes - v_before, v_after_no - v_after_yes;
--   end $$;
--
--   pg_net records responses asynchronously, so both numbers may read 0 while
--   the requests are still in flight. What the block really proves is the
--   INSERTS both succeed and neither raises. To see the filter itself, read
--   the trigger's WHEN clause:
--
--     select pg_get_triggerdef(oid) from pg_trigger
--      where tgrelid = 'public.notifications'::regclass and tgname = 'notify_email';
--
--   Expect the seven types listed, and nothing else.
--
-- ── BLOCK D — the unsubscribe path, end to end. Rolls itself back ───────
--
--   do $$
--   declare
--     v_user constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_token text; v_ok boolean; v_bad boolean; v_pref jsonb;
--   begin
--     v_token := public.email_unsubscribe_token(v_user);
--     v_bad   := public.unsubscribe_email('not-a-real-token-but-long-enough');
--     v_ok    := public.unsubscribe_email(v_token);
--     select notification_preferences into v_pref from public.users where id = v_user;
--     raise exception E'ROLLED BACK ON PURPOSE.\ntoken length: %\nwrong token accepted: %  (must be false)\nreal token accepted: %  (must be true)\npreference now: %',
--       length(v_token), v_bad, v_ok, v_pref;
--   end $$;
--
--   Expect a token of about 43 characters, false, true, and
--   {"email": {"enabled": false}}.
--
-- ── BLOCK E — the reconcile runs and reports. Rolls itself back ─────────
--
--   do $$
--   declare r public.email_reconcile_runs;
--   begin
--     r := public.run_email_reconcile(24);
--     raise exception E'ROLLED BACK ON PURPOSE.\nemailable: %  sent: %  failed: %  skipped: %  no attempt: %',
--       r.emailable, r.sent, r.failed, r.skipped, r.no_attempt;
--   end $$;
--
--   On a quiet day every number is 0. no_attempt above 0 means notifications
--   went out with no email attempt recorded at all — the trigger never reached
--   the function.
