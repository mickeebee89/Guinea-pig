-- ============================================================================
-- SESSION STATUS GUARD — stop self-accept / self-complete
-- ----------------------------------------------------------------------------
-- WHY
--   The `sessions` UPDATE RLS policy allows any PARTICIPANT to update the row, with
--   no check on the status column. A model could therefore PATCH status directly via
--   the API — self-accepting their own application, or self-completing a booking to
--   unlock a (fake) review. RLS WITH CHECK can't express this: it sees only the NEW
--   row, not the OLD → NEW transition. A BEFORE UPDATE trigger can.
--
-- INTENDED TRANSITIONS (from the app's real flows):
--   pending  -> accepted   PROVIDER only   (sessions.tsx, provider-dashboard.tsx)
--                          — and only while the appointment is still ahead (0066)
--   pending  -> expired    THE SCHEDULED JOB only, null-uid path (0067)
--   pending  -> declined   PROVIDER only
--   accepted -> completed  PROVIDER only   (sessions.tsx, chat/[sessionId].tsx)
--   pending/accepted -> cancelled  EITHER PARTY  (block-driven, chat/[sessionId].tsx)
--   completed / declined / cancelled / expired = TERMINAL (no further change)
--
--   The model never legitimately sets accepted/declined/completed. Service-role edge
--   functions (auth.uid() null) and admins bypass, since RLS already blocks anon and
--   only trusted server code runs without a user JWT.
-- ============================================================================

-- MIGRATION-OWNS: enforce_session_status_transition 0066
--
-- ⚠️ 0066 IS THE CURRENT DEFINITION AND THIS FILE HAS BEEN BROUGHT FORWARD TO
-- MATCH IT. Two rules were added there and are reproduced below:
--   * 'expired' is terminal (the lapsed-application state, written only by the
--     scheduled job in 0067);
--   * an appointment that has already started can no longer be ACCEPTED,
--     though it can always be declined.
--
-- Marking a file without correcting it is the item 123 fault: re-running a
-- marked-but-stale file silently reverts the migration it declares. This file
-- is safe to re-run.

create or replace function public.enforce_session_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_provider boolean;
  is_model    boolean;
begin
  -- Only guard real status changes; non-status edits and no-ops pass through.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Trusted server (service role / no JWT) and admins bypass the actor rules.
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  -- Terminal states never change again. 'expired' joined them in 0066.
  if old.status in ('completed', 'declined', 'cancelled', 'expired') then
    raise exception 'Session is already % and cannot change', old.status
      using errcode = '42501';
  end if;

  -- 0066: the appointment cannot be agreed to after it has begun. Europe/London
  -- because date and start_time are UK wall clock and this database runs UTC.
  if new.status = 'accepted'
     and (old.date + old.start_time) at time zone 'Europe/London' <= now() then
    raise exception 'That appointment has already started and can no longer be accepted.'
      using errcode = 'CV003';
  end if;

  is_model := (auth.uid() = old.model_user_id);
  is_provider := exists (
    select 1 from public.providers p
    where p.id = old.provider_id and p.user_id = auth.uid()
  );

  if new.status in ('accepted', 'declined', 'completed') then
    if not is_provider then
      raise exception 'Only the provider can set a session to %', new.status
        using errcode = '42501';
    end if;
  elsif new.status = 'cancelled' then
    if not (is_provider or is_model) then
      raise exception 'Not a participant of this session'
        using errcode = '42501';
    end if;
  else
    raise exception 'Illegal status transition % -> %', old.status, new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_session_status on public.sessions;
create trigger trg_enforce_session_status
  before update of status on public.sessions
  for each row
  execute function public.enforce_session_status_transition();

-- ============================================================================
-- VERIFY
--   In-app (must still work): provider accepts a pending application; provider marks
--   an accepted session complete; a block cancels the pair's pending/accepted sessions.
--   Exploit (must now fail with 42501): a model PATCHing their own session to
--   'accepted' or 'completed' via the API.
--   Quick SQL simulation of the exploit (run as the model, expect an exception):
--     -- set the JWT to the model, then:
--     -- update sessions set status='completed' where id='<their pending session>';
-- ============================================================================
