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
--   pending  -> declined   PROVIDER only
--   accepted -> completed  PROVIDER only   (sessions.tsx, chat/[sessionId].tsx)
--   pending/accepted -> cancelled  EITHER PARTY  (block-driven, chat/[sessionId].tsx)
--   completed / declined / cancelled = TERMINAL (no further change)
--
--   The model never legitimately sets accepted/declined/completed. Service-role edge
--   functions (auth.uid() null) and admins bypass, since RLS already blocks anon and
--   only trusted server code runs without a user JWT.
-- ============================================================================

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

  -- Terminal states never change again.
  if old.status in ('completed', 'declined', 'cancelled') then
    raise exception 'Session is already % and cannot change', old.status
      using errcode = '42501';
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
