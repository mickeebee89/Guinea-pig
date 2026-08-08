-- ===========================================================================
-- SCHEMA SNAPSHOT — public schema, taken 2026-08-08
--
-- WHAT THIS IS
--   A point-in-time dump of every function, trigger, view and RLS policy that
--   actually exists in the live database. It closes a gap where supabase/*.sql
--   documented roughly a third of the schema while reading like a complete
--   record: 7 of 18 functions, 4 of 11 triggers, and no RLS policies at all.
--
--   That gap cost real time three times in one session — an aggregate designed
--   against a rating trigger that already existed, a seed teardown blocked by a
--   patch_tests table the script had never heard of, and a category slug
--   guessed from the repo (`spray-tan`) that would have matched zero stylists
--   forever because the database says `spray_tan`.
--
-- WHAT THIS IS NOT
--   NOT a migration. Do not run this file top to bottom against the live
--   database — it would recreate objects that already exist and, for the two
--   push functions below, would install a placeholder where a real secret
--   belongs. It is reference material: read it to find out what is true.
--
--   NOT authoritative once it ages. The database is the authority. Regenerate
--   with the query at the bottom of this file whenever you need certainty.
--
-- ⚠️ REDACTION
--   tg_message_push and tg_notify_push embed the send-push shared secret in
--   their bodies. The live value is NOT reproduced here — it is replaced with
--   REPLACE_WITH_PUSH_HOOK_SECRET, matching the existing convention in
--   supabase/push-setup.sql. send-push/index.ts:29 compares the incoming header
--   against Deno.env.get('PUSH_HOOK_SECRET'). Never commit the real value.
--
-- 📌 FOLLOW-UP
--   Adopt supabase/migrations/ so this cannot drift again. Today every change
--   is a one-off script pasted into the SQL editor with nothing recording
--   whether it ran — which is exactly how the live `providers` SELECT policy
--   came to exist in no file at all.
-- ===========================================================================


-- ===========================================================================
-- FUNCTIONS (18)
-- ===========================================================================

-- ---- access control -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.admins where user_id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.is_suspended(uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.suspensions s
    where s.user_id = uid
      and (s.banned = true
           or (s.suspended_until is not null and s.suspended_until > now()))
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_suspension()
 RETURNS TABLE(banned boolean, suspended_until timestamp with time zone, reason text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select s.banned, s.suspended_until, s.reason
  from public.suspensions s
  where s.user_id = auth.uid()
    and (s.banned = true
         or (s.suspended_until is not null and s.suspended_until > now()))
  order by s.banned desc, s.suspended_until desc nulls last
  limit 1;
$function$;

-- ---- account lifecycle ----------------------------------------------------

-- Trigger on auth.users. NOTE this inserts into public.users, which has no FK
-- back to auth.users — so deletion does NOT cascade the other way. That
-- asymmetry is why seed/teardown.mjs deletes public.users explicitly, and why
-- the delete-account page cannot honestly say "everything" without an audit.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  insert into public.users (id, email, role, first_name, last_name, last_initial, region)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'model'),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'last_initial', ''),
    coalesce(new.raw_user_meta_data->>'region', 'UK')
  )
  on conflict (id) do nothing;

  if coalesce(new.raw_user_meta_data->>'role', 'model') = 'provider' then
    insert into public.providers (user_id)
    values (new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

-- ---- integrity guards -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_publish_requires_verified()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  -- only check when trying to set is_published true
  if new.is_published = true then
    if not exists (
      select 1 from public.users u
      where u.id = new.user_id and u.is_verified = true
    ) then
      raise exception 'Cannot publish shop: provider is not verified';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_session_status_transition()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  is_provider boolean;
  is_model    boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if old.status in ('completed', 'declined', 'cancelled') then
    raise exception 'Session is already % and cannot change', old.status using errcode = '42501';
  end if;
  is_model := (auth.uid() = old.model_user_id);
  is_provider := exists (select 1 from public.providers p where p.id = old.provider_id and p.user_id = auth.uid());
  if new.status in ('accepted', 'declined', 'completed') then
    if not is_provider then
      raise exception 'Only the provider can set a session to %', new.status using errcode = '42501';
    end if;
  elsif new.status = 'cancelled' then
    if not (is_provider or is_model) then
      raise exception 'Not a participant of this session' using errcode = '42501';
    end if;
  else
    raise exception 'Illegal status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_overlapping_session()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare clash record;
begin
  if new.status not in ('pending', 'accepted') then return new; end if;
  select s.start_time, s.end_time into clash
  from public.sessions s
  where s.provider_id = new.provider_id and s.date = new.date and s.id <> new.id
    and s.status in ('pending', 'accepted')
    and s.start_time < new.end_time and s.end_time > new.start_time
  limit 1;
  if found then
    raise exception 'This time overlaps an existing booking (%-%)', clash.start_time, clash.end_time
      using errcode = '23505';
  end if;
  return new;
end; $function$;

-- Makes session_consents and moderation_actions append-only. This is why the
-- 7 Aug seed teardown could not delete two auth users: a cascade into these
-- tables is rejected by design. Banned-and-orphaned is the correct end state
-- in that situation — do not disable this to force a delete.
CREATE OR REPLACE FUNCTION public.prevent_mutation()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Records in % are immutable and cannot be modified or deleted', tg_table_name;
end $function$;

CREATE OR REPLACE FUNCTION public.set_consent_hash()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'extensions'
AS $function$
begin
  new.content_hash := encode(
    digest(
      coalesce(new.title, '') ||
      coalesce(new.body, '') ||
      coalesce(new.acknowledgements::text, ''),
      'sha256'
    ),
    'hex'
  );
  return new;
end $function$;

-- ---- ratings --------------------------------------------------------------

-- providers.rating and review_count ARE maintained. An earlier note in the web
-- handover claimed nothing maintained them — that was read off the repo, which
-- did not contain this function, and it was wrong.
CREATE OR REPLACE FUNCTION public.recompute_provider_rating()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  affected uuid;
begin
  affected := case when tg_op = 'DELETE' then old.reviewee_id else new.reviewee_id end;

  update public.providers p
  set rating = coalesce(
        (select round(avg(r.overall_rating)::numeric, 2)
         from public.reviews r where r.reviewee_id = affected), 0),
      review_count =
        (select count(*) from public.reviews r where r.reviewee_id = affected)
  where p.user_id = affected;

  return null;
end;
$function$;

-- ---- availability ---------------------------------------------------------

-- NB stricter than the public website's has_open_slots, which is a plain
-- EXISTS over future availability and counts already-booked slots as open.
CREATE OR REPLACE FUNCTION public.has_open_availability(p_provider_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from availability a
    where a.provider_id = p_provider_id
      and a.date >= current_date
      and not exists (
        select 1
        from sessions s
        where s.availability_id = a.id
          and s.status in ('pending', 'accepted')
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.taken_slots(p_provider_id uuid, p_date date)
 RETURNS TABLE(start_time time without time zone, end_time time without time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select s.start_time, s.end_time
  from public.sessions s
  where s.provider_id = p_provider_id
    and s.date = p_date
    and s.status in ('pending', 'accepted');
$function$;

-- ---- patch tests (allergy testing before dye/tint/lash adhesive) -----------

-- NB patch_tests.provider_id references auth.users, NOT providers.id — unlike
-- every other provider_id in this schema. Easy source of a silent wrong join.
CREATE OR REPLACE FUNCTION public.has_valid_patch_test(p_model uuid, p_provider uuid, p_category uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.patch_tests pt
    where pt.model_id = p_model
      and pt.provider_id = p_provider
      and pt.category_id = p_category
      and pt.result = 'pass'
      and pt.model_confirmed_at is not null
      and (pt.expires_at is null or pt.expires_at > now())
  );
$function$;

-- Scoped to `model_id = auth.uid()`, so it fails closed for an anonymous
-- caller: auth.uid() is null, no row matches, and it raises. That scoping is
-- what made the 7 Aug anon-execute exposure non-exploitable here.
CREATE OR REPLACE FUNCTION public.confirm_patch_test(p_test_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.patch_tests
     set model_confirmed_at = now()
   where id = p_test_id and model_id = auth.uid() and model_confirmed_at is null;
  if not found then raise exception 'Patch test not found or not yours to confirm'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_patch_test_expiry()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_days int;
begin
  if new.result = 'pass' and new.performed_at is not null then
    select patch_test_validity_days into v_days
      from public.patch_test_rules where category_id = new.category_id;
    new.expires_at := new.performed_at + make_interval(days => coalesce(v_days, 180));
  end if;
  return new;
end $function$;

-- ---- discovery ------------------------------------------------------------

-- ⚠️ Reads users.latitude/longitude and returns distance_mi computed from
-- CALLER-SUPPLIED coordinates. Varying them across calls trilaterates a
-- model's real location. Combined with first name, photo and (via
-- public_profiles) an Instagram handle, this is the highest-sensitivity object
-- in the schema. EXECUTE was revoked from public and anon on 2026-08-07;
-- `authenticated` retains it because the app needs it.
CREATE OR REPLACE FUNCTION public.nearby_models(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_radius_mi double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id uuid, first_name text, last_initial text, profile_pic_url text, is_verified boolean, distance_mi double precision, hair_colour text, hair_type text, hair_length text, skin_tone text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url, u.is_verified,
    dist.d as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.skin_tone
  from public.users u
  left join public.model_attributes ma on ma.user_id = u.id
  cross join lateral (
    select case
      when p_lat is null or p_lng is null
        or u.latitude is null or u.longitude is null
      then null::double precision
      else 3959 * acos(
        greatest(-1.0, least(1.0,
          cos(radians(p_lat)) * cos(radians(u.latitude)) *
          cos(radians(u.longitude) - radians(p_lng)) +
          sin(radians(p_lat)) * sin(radians(u.latitude))
        ))
      )
    end as d
  ) dist
  where u.role = 'model'
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$function$;

-- ---- push notifications ---------------------------------------------------
-- ⚠️ THE LIVE BODIES CONTAIN A REAL SECRET. It is redacted below. Do not paste
-- the live definition into this repo. See supabase/push-setup.sql.

CREATE OR REPLACE FUNCTION public.tg_message_push()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.tg_notify_push()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
end $function$;


-- ===========================================================================
-- TRIGGERS (11)
-- ===========================================================================

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

CREATE TRIGGER trg_publish_requires_verified BEFORE INSERT OR UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION enforce_publish_requires_verified();

CREATE TRIGGER trg_enforce_session_status BEFORE UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_session_status_transition();

CREATE TRIGGER trg_reject_overlapping_session
  BEFORE INSERT OR UPDATE OF date, start_time, end_time, status, provider_id ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION reject_overlapping_session();

CREATE TRIGGER trg_recompute_provider_rating AFTER INSERT OR DELETE OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION recompute_provider_rating();

CREATE TRIGGER trg_patch_test_expiry BEFORE INSERT OR UPDATE ON public.patch_tests
  FOR EACH ROW EXECUTE FUNCTION set_patch_test_expiry();

CREATE TRIGGER trg_consent_hash BEFORE INSERT OR UPDATE ON public.consent_documents
  FOR EACH ROW EXECUTE FUNCTION set_consent_hash();

-- The two append-only guards.
CREATE TRIGGER trg_lock_consents BEFORE DELETE OR UPDATE ON public.session_consents
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER trg_lock_moderation BEFORE DELETE OR UPDATE ON public.moderation_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER message_push AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION tg_message_push();

CREATE TRIGGER notify_push AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION tg_notify_push();


-- ===========================================================================
-- VIEWS (5)
--
-- The four public_* views are defined properly, with reasoning, in
-- supabase/public-web-views.sql. Only public_profiles is recorded here, since
-- it existed in no file until now.
-- ===========================================================================

-- ⚠️ No WHERE clause, and security_invoker is off, so it bypasses RLS on users
-- and returns EVERY user. That is why anon's SELECT on it was a live leak until
-- it was revoked on 2026-08-07. `authenticated` retains it — the mobile app
-- needs it for reviewer names and session participants.
create or replace view public.public_profiles as
  SELECT id, first_name, last_initial, profile_pic_url, instagram_handle
  FROM users;


-- ===========================================================================
-- REGENERATING THIS FILE
-- ===========================================================================
--
--   select 'function' as kind, p.proname as name, pg_get_functiondef(p.oid) as ddl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--   union all
--   select 'trigger', t.tgname, pg_get_triggerdef(t.oid) || ';'
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   join pg_namespace n on n.oid = c.relnamespace
--   where not t.tgisinternal and n.nspname in ('public','auth')
--   union all
--   select 'view', viewname,
--          'create or replace view public.' || viewname || ' as ' || definition
--   from pg_views where schemaname = 'public'
--   union all
--   select 'policy', tablename || '.' || policyname,
--          format('create policy %I on public.%I as %s for %s to %s using (%s)%s;',
--                 policyname, tablename, permissive, cmd, array_to_string(roles, ', '),
--                 coalesce(qual, 'true'),
--                 case when with_check is null then ''
--                      else ' with check (' || with_check || ')' end)
--   from pg_policies where schemaname = 'public'
--   order by 1, 2;
--
-- RLS policies are in schema-snapshot-2026-08-08-policies.sql — kept separate
-- because there are ~90 of them and they change far more often than the rest.
-- ===========================================================================
