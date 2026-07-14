-- ============================================================================
-- Push notifications — DB setup. Run in the Supabase SQL editor.
--
-- Before running: pick a long random secret (e.g. `openssl rand -hex 32`), then
--   1) set it as an edge-function secret:  supabase secrets set PUSH_HOOK_SECRET=<secret>
--   2) replace every REPLACE_WITH_PUSH_HOOK_SECRET below with the SAME value.
-- Do NOT commit the real secret. (It only authorises calling send-push.)
-- The send-push function URL below uses project ref ptluekkhiopowuyvkgnd.
-- ============================================================================

-- 1) Device push tokens (one row per device; multi-device per user) ----------
create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text,
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
-- Owner manages their own tokens; the service-role edge fn reads all (bypasses RLS).
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2) pg_net (lets triggers call the edge function over HTTP) ------------------
create extension if not exists pg_net;

-- 3) Trigger: every notification row -> push (covers all 10 existing types) ---
create or replace function public.tg_notify_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', 'REPLACE_WITH_PUSH_HOOK_SECRET'),
    body    := jsonb_build_object(
                 'user_id', new.user_id,
                 'title',   new.title,
                 'body',    new.body,
                 'data',    jsonb_build_object('type', new.type, 'session_id', new.session_id)
                            || coalesce(new.data, '{}'::jsonb))
  );
  return new;
end $$;

drop trigger if exists notify_push on public.notifications;
create trigger notify_push after insert on public.notifications
  for each row execute function public.tg_notify_push();

-- 4) Trigger: new chat message -> push the OTHER party (no notifications row) -
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
                 'x-push-secret', 'REPLACE_WITH_PUSH_HOOK_SECRET'),
    body    := jsonb_build_object(
                 'user_id', v_recipient,
                 'title',   coalesce(nullif(trim(v_sender_name), ''), 'New message'),
                 'body',    new.body,
                 'data',    jsonb_build_object('type', 'new_message', 'session_id', new.session_id))
  );
  return new;
end $$;

drop trigger if exists message_push on public.messages;
create trigger message_push after insert on public.messages
  for each row execute function public.tg_message_push();
