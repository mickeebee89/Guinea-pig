-- ===========================================================================
-- account-deletion-fix.sql — 2026-08-08
--
-- FIXES A LIVE BUG: in-app account deletion is broken for any user who has
-- applied for or received a booking, which is an Apple 5.1.1(v) requirement.
--
-- WHAT WAS WRONG
--   delete-account/index.ts attempts to DELETE from session_consents and
--   moderation_actions. Both are append-only via prevent_mutation(), so those
--   deletes always fail. The failure was swallowed by a best-effort helper, and
--   the chain then collapsed:
--     session_consents survives -> session_consents.session_id (RESTRICT)
--     blocks the sessions delete -> surviving session_consents.user_id and
--     sessions.model_user_id (both NO ACTION -> auth.users) block
--     auth.admin.deleteUser -> 500 "Could not delete account".
--   By then messages, reviews, notifications, provider rows and all four
--   storage buckets were already gone. The user was left with a stripped
--   account and an error. Retrying failed identically.
--   This is the same root cause as the 7 Aug seed teardown failing on 2 of 9.
--
-- WHY NOT ON DELETE SET NULL
--   Two independent reasons. session_consents.user_id, .session_id,
--   moderation_actions.target_user_id and .admin_id are all NOT NULL. And a
--   SET NULL cascade is an UPDATE, which prevent_mutation() also blocks.
--
-- THE APPROACH
--   Sever the foreign keys and keep the columns as plain uuid. A dangling id
--   is correct here: the row survives untouched, so no UPDATE or DELETE is
--   attempted against an immutable record during account deletion, and
--   prevent_mutation keeps doing its real job.
--
--   These records already prove WHAT was agreed and WHEN — consent_version,
--   content_hash, acknowledgements and agreed_at are all denormalised onto
--   session_consents. What they lack is a durable WHO, because user_id points
--   at a row that deletion destroys. Sections 2-3 add that. The result is a
--   stronger evidentiary record than today, not a weaker one.
--
-- RETENTION (decided 8 Aug 2026)
--   * 6 years from agreement/action, then deletable. Matches the Limitation
--     Act 1980 period for contract claims in England & Wales.
--   * ip_address and device_info are scrubbed at 12 months. They prove the ACT
--     of consenting, which matters early; six-year-old IP data proves little
--     and is not proportionate to retain.
--   Both are encoded in the trigger rather than left to a scheduled job to
--   respect. A job that forgets to run cannot make the record over-retained,
--   and nothing can delete a record early.
--
-- RUN THIS IN THE SQL EDITOR AS postgres, TOP TO BOTTOM, ONCE.
-- Then deploy the updated delete-account function.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Sever the blocking foreign keys.
--    Constraint names are discovered rather than assumed — session_consents'
--    FK to sessions was never recorded in this repo.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tbl
    from pg_constraint con
    join unnest(con.conkey) k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and (
        (con.conrelid = 'public.session_consents'::regclass
           and att.attname in ('user_id', 'session_id'))
        or
        (con.conrelid = 'public.moderation_actions'::regclass
           and att.attname in ('target_user_id', 'admin_id', 'related_report_id'))
      )
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'dropped FK % on %', c.conname, c.tbl;
  end loop;
end $$;

-- Keep the columns indexed — they are still the correlation key even without
-- a constraint, and delete-account looks rows up by them.
create index if not exists session_consents_user_id_idx    on public.session_consents (user_id);
create index if not exists session_consents_session_id_idx on public.session_consents (session_id);
create index if not exists moderation_actions_target_idx   on public.moderation_actions (target_user_id);

-- ---------------------------------------------------------------------------
-- 2. Durable subject identity.
--
--    Display name as the app already shows it, plus a SHA-256 of the lowercased
--    email. The hash verifies a claim — a claimant supplies their address, we
--    hash it and compare — without retaining a contactable identifier for six
--    years. On moderation_actions it also survives as a ban-evasion signal.
-- ---------------------------------------------------------------------------
alter table public.session_consents
  add column if not exists subject_name       text,
  add column if not exists subject_email_hash text;

alter table public.moderation_actions
  add column if not exists target_name       text,
  add column if not exists target_email_hash text;

comment on column public.session_consents.subject_email_hash is
  'SHA-256 of lower(email) at the time of consent. Survives account deletion so a '
  'claim can be verified against the record. Never reversible to an address.';
comment on column public.moderation_actions.target_email_hash is
  'SHA-256 of lower(email). Survives account deletion; also the ban-evasion signal.';

-- ---------------------------------------------------------------------------
-- 3. Populate identity at insert. A trigger, not app code — the app cannot
--    forget, and a record written without identity is unusable later.
-- ---------------------------------------------------------------------------
create or replace function public.set_consent_subject()
returns trigger language plpgsql security definer
set search_path to 'public', 'extensions' as $$
begin
  if new.subject_name is null or new.subject_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.subject_name, new.subject_email_hash
    from public.users u where u.id = new.user_id;
  end if;
  return new;
end $$;

create or replace function public.set_moderation_subject()
returns trigger language plpgsql security definer
set search_path to 'public', 'extensions' as $$
begin
  if new.target_name is null or new.target_email_hash is null then
    select
      nullif(btrim(coalesce(u.first_name, '')
             || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
      encode(digest(lower(btrim(u.email)), 'sha256'), 'hex')
      into new.target_name, new.target_email_hash
    from public.users u where u.id = new.target_user_id;
  end if;
  return new;
end $$;

revoke all on function public.set_consent_subject()    from public, anon;
revoke all on function public.set_moderation_subject() from public, anon;

drop trigger if exists trg_consent_subject on public.session_consents;
create trigger trg_consent_subject
  before insert on public.session_consents
  for each row execute function public.set_consent_subject();

drop trigger if exists trg_moderation_subject on public.moderation_actions;
create trigger trg_moderation_subject
  before insert on public.moderation_actions
  for each row execute function public.set_moderation_subject();

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows.
--
--    This is an UPDATE, which the append-only guard blocks, so the trigger is
--    disabled for the duration. That is the ONLY place in this file where that
--    happens, it is inside the transaction, and it is re-enabled below.
--    Rows whose user has already been deleted cannot be backfilled — their
--    identity is unrecoverable. That is counted and reported, not hidden.
-- ---------------------------------------------------------------------------
alter table public.session_consents   disable trigger trg_lock_consents;
alter table public.moderation_actions disable trigger trg_lock_moderation;

update public.session_consents sc
set subject_name = nullif(btrim(coalesce(u.first_name, '')
      || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
    subject_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
from public.users u
where u.id = sc.user_id and sc.subject_email_hash is null;

update public.moderation_actions ma
set target_name = nullif(btrim(coalesce(u.first_name, '')
      || case when u.last_initial is not null then ' ' || u.last_initial || '.' else '' end), ''),
    target_email_hash = encode(extensions.digest(lower(btrim(u.email)), 'sha256'), 'hex')
from public.users u
where u.id = ma.target_user_id and ma.target_email_hash is null;

alter table public.session_consents   enable trigger trg_lock_consents;
alter table public.moderation_actions enable trigger trg_lock_moderation;

do $$
declare orphan_c int; orphan_m int;
begin
  select count(*) into orphan_c from public.session_consents   where subject_email_hash is null;
  select count(*) into orphan_m from public.moderation_actions where target_email_hash  is null;
  if orphan_c > 0 or orphan_m > 0 then
    raise notice 'UNBACKFILLED (user row already gone, identity unrecoverable): % consent, % moderation',
      orphan_c, orphan_m;
  else
    raise notice 'backfill complete: every row has subject identity';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Replace the blanket append-only guard with one that encodes retention.
--
--    prevent_mutation() blocked DELETE forever, which made these rows immortal
--    — an indefinite-retention problem of its own, and the reason the 6-year
--    commitment could not have been honoured. The replacements still refuse
--    everything the app might do, and permit exactly two lifecycle operations.
--
--    prevent_mutation() itself is left in place; nothing else uses it, but it
--    is referenced in older scripts.
-- ---------------------------------------------------------------------------

create or replace function public.guard_session_consents()
returns trigger language plpgsql
set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    -- Deletable only once the retention period has run.
    if old.agreed_at > now() - interval '6 years' then
      raise exception
        'session_consents is append-only until its 6-year retention expires (agreed_at %)', old.agreed_at
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- The only permitted UPDATE is the 12-month scrub of the act-of-consent
  -- fields. Everything else about the record stays exactly as written.
  if old.agreed_at > now() - interval '12 months' then
    raise exception 'session_consents is immutable (ip/device scrub allowed from 12 months)'
      using errcode = '42501';
  end if;
  if new.ip_address is not null or new.device_info is not null then
    raise exception 'the only permitted update is nulling ip_address and device_info'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'ip_address' - 'device_info')
     is distinct from
     (to_jsonb(old) - 'ip_address' - 'device_info') then
    raise exception 'the only permitted update is nulling ip_address and device_info'
      using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_moderation_actions()
returns trigger language plpgsql
set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'moderation_actions is immutable' using errcode = '42501';
  end if;
  if old.created_at > now() - interval '6 years' then
    raise exception
      'moderation_actions is append-only until its 6-year retention expires (created_at %)', old.created_at
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists trg_lock_consents   on public.session_consents;
drop trigger if exists trg_lock_moderation on public.moderation_actions;

create trigger trg_lock_consents
  before delete or update on public.session_consents
  for each row execute function public.guard_session_consents();

create trigger trg_lock_moderation
  before delete or update on public.moderation_actions
  for each row execute function public.guard_moderation_actions();

-- ---------------------------------------------------------------------------
-- ⚠ SECTION 6 IS SUPERSEDED BY MIGRATION 0004. DO NOT RE-RUN THIS FILE.
--
--    The delete_account_data below deletes reports where the departing user was
--    either party — which destroyed other people's complaints ABOUT them. That
--    was the hole 0004 closed. Re-running this file would reinstate it.
--
--    Migration 0006 now refuses to delete a report inside its 6-year retention,
--    so the reinstated version would fail loudly at the first deletion rather
--    than quietly destroying evidence. That is a backstop, not permission.
--
--    The live definition is in supabase/migrations/0004_*.sql. This is kept as
--    the record of what was done on 8 Aug 2026, not as something to run.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. The atomic deletion routine.
--
--    Every DB row for one account, in one transaction. Either all of it goes
--    or none of it does — replacing ~15 independent statements whose partial
--    failure produced the stripped-account bug.
--
--    Deliberately does NOT touch session_consents or moderation_actions. Those
--    survive by design, are now self-contained, and are purged by retention.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account_data(p_user uuid)
returns jsonb language plpgsql security definer
set search_path to 'public' as $$
declare
  v_provider_ids uuid[];
  v_session_ids  uuid[];
  v_report_ids   uuid[];
  v_result       jsonb;
begin
  if p_user is null then
    raise exception 'delete_account_data requires a user id';
  end if;

  select coalesce(array_agg(id), '{}') into v_provider_ids
    from public.providers where user_id = p_user;

  select coalesce(array_agg(distinct id), '{}') into v_session_ids
    from public.sessions
   where model_user_id = p_user
      or model_id = p_user
      or provider_id = any(v_provider_ids);

  select coalesce(array_agg(distinct id), '{}') into v_report_ids
    from public.reports
   where reporter_id = p_user
      or reported_id = p_user
      or session_id = any(v_session_ids);

  -- Preserve the audit trail; drop only the pointers into deleted rows.
  update public.admin_audit_log set target_user_id     = null where target_user_id     = p_user;
  update public.admin_audit_log set target_provider_id = null where target_provider_id = any(v_provider_ids);
  update public.admin_audit_log set target_session_id  = null where target_session_id  = any(v_session_ids);
  update public.verification_requests set reviewed_by  = null where reviewed_by        = p_user;

  -- reports.reviewed_by is NO ACTION -> auth.users and blocks the auth delete
  -- where this user reviewed someone else's report as an admin.
  -- (moderation_actions.related_report_id also pointed at reports we delete
  -- below; that FK is severed in section 1, since the row is immutable and the
  -- pointer could not be nulled.)
  update public.reports set reviewed_by = null where reviewed_by = p_user;

  delete from public.reviews       where reviewer_id = p_user
                                      or reviewee_id = p_user
                                      or session_id  = any(v_session_ids);
  delete from public.messages      where sender_id  = p_user or session_id = any(v_session_ids);
  delete from public.notifications where user_id    = p_user or session_id = any(v_session_ids);
  delete from public.reports       where id = any(v_report_ids);
  delete from public.sessions      where id = any(v_session_ids);
  delete from public.providers     where user_id = p_user;

  -- public.users has NO FK to auth.users, so the auth delete does not cascade
  -- it. Deleting it here fires its own CASCADE children (blocks, favourites,
  -- model_attributes, model_photos, subscriptions, verification_*, ...).
  delete from public.users where id = p_user;

  v_result := jsonb_build_object(
    'providers', cardinality(v_provider_ids),
    'sessions',  cardinality(v_session_ids),
    'reports',   cardinality(v_report_ids));
  return v_result;
end $$;

revoke all on function public.delete_account_data(uuid) from public, anon, authenticated;
-- service_role only: the edge function verifies the caller's JWT and passes
-- their own id. Never callable directly by a client.

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER RUNNING
--
--   -- 1. FKs are gone (expect 0 rows)
--   select con.conname, con.conrelid::regclass
--   from pg_constraint con
--   where con.contype = 'f'
--     and con.conrelid in ('public.session_consents'::regclass,
--                          'public.moderation_actions'::regclass)
--     and con.confrelid in ('auth.users'::regclass, 'public.sessions'::regclass);
--
--   -- 2. Identity backfilled (expect 0 nulls, or the notice explained why)
--   select count(*) filter (where subject_email_hash is null) as unbackfilled,
--          count(*) as total
--   from public.session_consents;
--
--   -- 3. The guard still refuses an ordinary delete (expect an exception)
--   begin;
--     delete from public.session_consents where id = (select id from public.session_consents limit 1);
--   rollback;
--
--   -- 4. And still refuses an ordinary update (expect an exception)
--   begin;
--     update public.session_consents set user_id = gen_random_uuid()
--     where id = (select id from public.session_consents limit 1);
--   rollback;
--
-- RETENTION JOB — still to build, mirroring supabase/purge-selfies-cron.sql:
--   * monthly: null ip_address/device_info where agreed_at < now() - 12 months
--   * monthly: delete where agreed_at < now() - 6 years
--   The triggers above already refuse both operations early, so a job that
--   over-reaches fails safely rather than deleting something it should not.
--
--   ⚠ IT MUST ALSO COVER public.reports — added by migration 0004, which stops
--   account deletion from destroying reports and so gives them the same
--   indefinite-retention problem this section exists to solve. Delete where
--   created_at < now() - 6 years, same basis (Limitation Act 1980).
--
--   reports has NO append-only guard, unlike the two tables above, so nothing
--   will refuse an over-reaching job on that table. It was left off deliberately
--   because seed/teardown.mjs:184 and :202 delete reports on purpose and a guard
--   would break the seed tool — a conflict that needs settling when the job is
--   written, not worked around inside it.
-- ===========================================================================
