-- ===========================================================================
-- 0088_a_column_you_cannot_name_is_a_column_you_cannot_forge
--
-- Item 156's second half. It closes item 157 outright.
--
-- `authenticated` AND `anon` hold UPDATE on EVERY column of public.users and
-- public.providers — 45 of 45, measured 6 Oct 2026. So item 147's shape was
-- not unusual: `sessions` was the instance that happened to be found, and
-- 0079 fixed one table of a schema-wide pattern. This is the rest of it for
-- the two tables that matter most.
--
--   public.users      8 of 27 writable by authenticated, 19 locked
--   public.providers  7 of 18 writable by authenticated, 11 locked
--   anon              nothing, on either table
--
-- ⚠️ THE GRANT IS THE DENY-BY-DEFAULT LAYER; THE TRIGGER IS THE BACKSTOP.
-- 0040 said so about itself: *"a trigger listing protected columns is an
-- allowlist by omission"*. 0060 then added two columns three weeks later and
-- walked straight through the gap — that is item 157. A grant list is an
-- allowlist too. The difference, and the whole reason this is the right fix,
-- is the DIRECTION IT FAILS IN: a column forgotten in a trigger is OPEN and
-- nobody notices, a column forgotten in a grant is LOCKED and a feature
-- breaks loudly on the next deploy.
--
-- ── WHAT WAS MEASURED, AND THE SAMPLE ──────────────────────────────────────
-- Every .ts/.tsx/.js/.mjs/.jsx under site/, admin/, mobile/, supabase/
-- functions/, scripts/ and seed/, excluding node_modules, .next and
-- .next-demo, matched on `.from('users'|'providers')` within 600 characters
-- of `.update|.upsert|.insert`. 6 Oct 2026.
--
-- ⚠️ `site/.next-demo/` IS BUILD OUTPUT THAT MIRRORS SOURCE. Left in, it
-- reported six call sites that do not exist, each a duplicate of a real one
-- with a different line number — a sweep that is WIDER than the truth is as
-- wrong as one that is narrower, and harder to doubt because it looks
-- thorough.
--
-- mobile/ is MOTHBALLED (6 Oct 2026) and its hits are DORMANT. They are not
-- counted as live writers. Fourteen of mobile's writes name columns this
-- migration locks; none of them runs.
--
-- ── THE THREE CLEARANCES THIS NEEDED ───────────────────────────────────────
--
-- 1. THE INVOKER WRITERS. A client sweep cannot see a SECURITY INVOKER
--    function in the database: it runs with the CALLER's privileges, so it
--    breaks the instant a grant narrows, and it appears in no client file.
--    This is the class that nearly broke 0079. Three exist here:
--
--      set_my_postcode           INVOKER, executable by authenticated.
--                                users.postcode/latitude/longitude and
--                                providers.latitude/longitude. ⚠️ LIVE PATH —
--                                see the next section.
--      _admin_apply_user_action  INVOKER, `revoke all … from public, anon,
--                                authenticated`. Callers: admin_act_on_user,
--                                admin_act_on_report, admin_act_on_provider —
--                                all three DEFINER.
--      _withdraw_stylist         INVOKER, same revoke. Callers:
--                                _admin_apply_user_action (itself reachable
--                                only through those three), revoke_verification
--                                and delete_account_data — both DEFINER.
--
--    The last two can never run as `authenticated`: no client may execute
--    them, and every chain bottoms out in a DEFINER, whose owner supplies the
--    privileges for the whole nest. ⚠️ THAT IS REPO EVIDENCE ABOUT LIVE
--    OBJECTS, so the guard below re-checks it in the transaction rather than
--    trusting this paragraph. 0084's precedent: a preflight informs whoever
--    reads it, a guard refuses regardless of who read what.
--
-- 2. THE ADMIN CONSOLE WRITES NEITHER TABLE DIRECTLY. Re-measured 6 Oct 2026
--    rather than inherited from 4 Oct. Eleven writes in admin/, targeting
--    admin_audit_log (2), portfolio_items (2), settings (3) and
--    treatment_categories (3). Every users/providers mutation goes through an
--    admin_* DEFINER RPC. A twelfth apparent write is `next.delete(k)` on a
--    JavaScript Set. 0040's deferral condition — *"those must move to
--    0035/0039's SECURITY DEFINER functions first"* — is met.
--
-- 3. 157 HAS NO FORENSIC TAIL. Measured 6 Oct 2026: 0 of 0 rows have
--    profile_pic_reviewed_at set. No photo has EVER been marked reviewed, by
--    its owner or by anyone, so there is nothing to backfill and no second
--    decision hiding behind this one. Recorded as settled, not left open.
--
-- ── ⚠️ WHY FIVE COORDINATE COLUMNS STAY GRANTED ────────────────────────────
-- users.postcode/latitude/longitude and providers.latitude/longitude are
-- written by `set_my_postcode`, which is SECURITY INVOKER **on purpose**.
-- 0054's own comment: *"Invoker rights on purpose: RLS is what confines it to
-- your own rows and what refuses a suspended stylist."*
--
-- The alternative was making it DEFINER and dropping all five. Rejected: a
-- DEFINER function bypasses RLS, so it would have to re-implement own-row
-- confinement AND the suspended-stylist refusal that `providers_not_suspended`
-- supplies for free. That is a second copy of a rule, and a second copy drifts.
--
-- ⚠️ AND THE RULE PEOPLE WILL THINK THIS WEAKENS, IT DOES NOT. The postcodes.io
-- lookup rule — that a coordinate must come from a server-side lookup — was
-- ALREADY ADVISORY before this migration, because 0054 says in its own comment
-- that the function *"does not and cannot check that the coordinate matches the
-- postcode"*. The grant was never what held that rule up. It is no more
-- advisory after this migration than before it, and anyone tightening these
-- five columns later must fix the rule, not the grant.
--
-- ── ⚠️⚠️ THE POLICY THAT LOOKS LIKE OWNERSHIP AND IS NOT ────────────────────
-- Read live, 6 Oct 2026. The two policies look alike. Only one is sound:
--
--            USING                      WITH CHECK
--   users     auth.uid() = id           auth.uid() = id
--   providers auth.uid() = user_id      (NONE)
--
-- USING only ever tests the OLD row. So nothing refuses a stylist rewriting
-- `providers.user_id` to another account — a policy named "providers can
-- update own row" DOES NOT ENFORCE OWNERSHIP ON THE ROW IT WRITES. The same
-- shape on `users` is closed, by a WITH CHECK that `providers` simply does not
-- have.
--
-- ⚠️ `user_id` is locked by THIS MIGRATION'S GRANT, not by that policy. Named
-- here because the next person reads the policy name and believes it. The
-- missing WITH CHECK is still missing after this migration; the grant is what
-- stands in front of it.
--
-- ── ⚠️⚠️ first_published_at: WHY THERE IS NO VALUE POLICY ON IT ─────────────
-- The plan for this migration said a BEFORE trigger would "pin the stamp to
-- OLD unless the transition sanctions a new one". ⚠️ THAT WAS WRONG, AND IT
-- WAS WRONG IN THE DIRECTION THIS PROJECT KEEPS CLOSING.
--
-- Micky, 6 Oct: *"A BEFORE trigger that quietly substitutes a value is
-- indistinguishable from a successful write at the call site."* The grant
-- already refuses a MEMBER loudly, at statement time, with 42501. So a pinning
-- trigger would only ever act on callers who DO hold the privilege — the
-- DEFINER chain, service_role, postgres — and for them it would silently
-- discard a legitimate write.
--
-- ⚠️ AND THE READ THAT SETTLES IT: THE CODEBASE HAS TWO DELIBERATELY OPPOSITE
-- CONVENTIONS FOR THIS COLUMN, so no value policy can be right for both.
--
--   PRESERVE-OR-STAMP, `coalesce(first_published_at, now())` — 0016:213,
--     0039:606, 0044:314 (_withdraw_stylist), 0045:229, 0077:266.
--     _withdraw_stylist's comment says why: *"The stamp is what stops
--     auto-publish putting it back (0016:313-316), so a suspension that ends
--     leaves the shop hidden until the stylist republishes it."*
--   CLEAR IT, `first_published_at = null` — 0040:386
--     (unpublish_on_verification_lost) and 0040:445. Nulling RE-ARMS
--     trg_provider_maybe_publish, so regaining verification republishes the
--     shop. Also deliberate.
--
-- So withdrawal WRITES this column and the write is load-bearing — it is not a
-- target-list artifact — and verification loss CLEARS it. A trigger policing
-- the value would have to break one of the two. **There is therefore no value
-- policy here at all.** Dropping the column from the grant is the entire fix
-- for forgery, and every privileged writer keeps its existing behaviour
-- untouched.
--
-- ── WHAT THE STAMP TRIGGER BELOW ACTUALLY DOES, AND WHAT IT CANNOT DO ───────
-- One job remains. Today the CLIENT stamps the column
-- (site/app/(app)/shop/actions.ts:355-356), and its own comment at :302 says
-- why: without a stamp, trg_provider_maybe_publish stays armed, and a stylist
-- who HIDES her shop gets silently auto-republished. Removing the client's
-- write without replacing it would reintroduce exactly that.
--
-- ⚠️ SO THE TRIGGER FILLS A GAP; IT NEVER OVERRIDES AND IT NEVER REFUSES. It
-- acts only when the caller did NOT name the column:
--
--     new.first_published_at is not distinct from old.first_published_at
--
-- When that is false the caller named it and the trigger does nothing, so all
-- five preserve-or-stamp writers and both clear-it writers pass through
-- unchanged. It cannot silently discard a write, because it only ever acts
-- where there is no write to discard. And it raises nothing, because it
-- refuses nothing — the member's path is already refused by the grant, which
-- is the loud layer.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--   1. Apply this.
--   2. node scripts/gen-supabase-types.mjs --applied 0088
--   3. Remove the two first_published_at lines from shop/actions.ts (the patch
--      becomes `{ is_published: publish }`), npm run verify --prefix site,
--      push, wait for Vercel.
--
-- ⚠️ STEP 3 IS NOT URGENT AND NOT OPTIONAL. Between 1 and 3 the live site
-- still NAMES first_published_at in its publish UPDATE and will get 42501 on
-- the publish toggle. Deploy promptly. The reverse order is not available: the
-- trigger must exist before the client stops writing the stamp, or hiding
-- re-arms auto-publish in the window between them.
-- ===========================================================================
begin;

do $$
declare
  v_t         text;
  v_bad       text;
  v_n         integer;
  v_all       integer;
  v_known     text[] := array['set_my_postcode', '_admin_apply_user_action', '_withdraw_stylist'];
  v_missing   text;
  v_want_u    text[] := array['first_name','instagram_handle','last_initial','latitude',
                              'longitude','notification_preferences','postcode','profile_pic_url'];
  v_want_p    text[] := array['bio','is_published','latitude','location_text','longitude',
                              'name','profile_pic_url'];
begin
  if not exists (select 1 from public.schema_migrations where version = '0087') then
    raise exception '0088: apply 0087 first.';
  end if;

  -- (a) EVERY COLUMN IN BOTH GRANT LISTS MUST EXIST. A typo, or a column
  -- dropped by a later migration, would otherwise produce a grant that names
  -- nothing and a member who can write nothing — silently, because GRANT on a
  -- missing column is an error but a misread list is not.
  select string_agg(c, ', ') into v_missing
  from unnest(v_want_u) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'users'
                       and column_name = c);
  if v_missing is not null then
    raise exception '0088: these users columns do not exist: %. The grant list is stale. Nothing changed.', v_missing;
  end if;

  select string_agg(c, ', ') into v_missing
  from unnest(v_want_p) as c
  where not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'providers'
                       and column_name = c);
  if v_missing is not null then
    raise exception '0088: these providers columns do not exist: %. The grant list is stale. Nothing changed.', v_missing;
  end if;

  -- (b) THERE MUST BE SOMETHING TO DO. A migration that commits having done
  -- nothing reads identically to one that worked.
  select count(*) into v_n
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('users', 'providers')
     and grantee in ('authenticated', 'anon') and privilege_type = 'UPDATE';
  if v_n = 0 then
    raise exception '0088: authenticated and anon already hold UPDATE on no column of either table. This migration has run, or something else narrowed them. Nothing changed.';
  end if;

  -- (c) PUBLIC MUST NOT HOLD UPDATE. Revoking from authenticated and anon
  -- while PUBLIC holds it changes nothing and reports success. PUBLIC is
  -- deliberately not revoked from instead: it could take service_role with it,
  -- and that is a decision, not a step.
  select string_agg(distinct (table_name || '.' || column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('users', 'providers')
     and grantee = 'PUBLIC' and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception '0088: PUBLIC holds UPDATE on %. Revoking from authenticated and anon would change nothing while reporting success. Decide PUBLIC first. Nothing changed.', v_bad;
  end if;

  -- (d) service_role MUST ALREADY HOLD UPDATE ON EVERY COLUMN OF BOTH TABLES.
  -- ⚠️ THE GUARD ASSERTS EXACTLY WHAT THE POST-CONDITION ASSERTS, and neither
  -- hardcodes the number. An earlier draft guarded `count > 0` and then had the
  -- post-condition demand 45 — so a pre-existing shortfall this migration never
  -- caused would have passed the gate, done the work, and rolled back at the
  -- end naming a figure nobody had established. A post-condition may only
  -- assert a precondition the guard has already proved.
  select count(*) into v_all
    from information_schema.columns
   where table_schema = 'public' and table_name in ('users', 'providers');
  select count(*) into v_n
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('users', 'providers')
     and grantee = 'service_role' and privilege_type = 'UPDATE';
  if v_n <> v_all then
    raise exception '0088: service_role holds UPDATE on % of % columns across users and providers. That is not this migration''s doing, but it is the control the post-condition measures against, so it must be true before rather than discovered after. Nothing changed.', v_n, v_all;
  end if;

  -- (e) ⚠️ THE INVOKER SWEEP, IN THE GUARD RATHER THAN THE PREFLIGHT. The
  -- clearance for _admin_apply_user_action and _withdraw_stylist is repo
  -- evidence about live objects. A FOURTH invoker writer, or one of the known
  -- two becoming client-executable, breaks a path with `permission denied` and
  -- no useful message.
  select string_agg(distinct f.proname::text, ', ') into v_bad
    from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
    cross join (values ('users'), ('providers')) as t(name)
   where n.nspname = 'public' and f.prokind in ('f', 'p') and not f.prosecdef
     and pg_get_functiondef(f.oid) ~* ('update[[:space:]]+(public[.])?' || t.name || '[^a-z_]')
     and not (f.proname::text = any (v_known));
  if v_bad is not null then
    raise exception '0088: these SECURITY INVOKER functions update users or providers and were not cleared: %. An invoker function runs with its CALLER''s privileges, so it breaks the moment this grant narrows — the _withdraw_stylist class that nearly broke 0079. Either clear it or keep the column granted. Nothing changed.', v_bad;
  end if;

  -- (f) THE TWO CLEARED INVOKERS MUST STILL BE UNREACHABLE BY A CLIENT. Their
  -- clearance rests entirely on `revoke all … from public, anon, authenticated`.
  --
  -- ⚠️ 'public' IS NOT IN THIS LIST AND MUST NOT BE ADDED.
  -- has_function_privilege('public', …) RAISES `role "public" does not exist`:
  -- PUBLIC is a pseudo-role and has no pg_roles entry, so the check would abort
  -- the migration with a bare SQL error that says nothing about privileges.
  -- Nothing is lost by dropping it — authenticated and anon both INHERIT a grant
  -- made to PUBLIC, so a PUBLIC grant is already visible through either of them.
  -- Caught by Micky in this migration's own preflight, 6 Oct 2026, before it ran.
  select string_agg(x.label, ', ') into v_bad
    from (
      select (p.proname::text || ' (' || r.rolname::text || ')') as label
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join (select unnest(array['authenticated', 'anon']) as rolname) r
       where n.nspname = 'public'
         and p.proname::text in ('_admin_apply_user_action', '_withdraw_stylist')
         and has_function_privilege(r.rolname, p.oid, 'execute')
    ) x;
  if v_bad is not null then
    raise exception '0088: these are client-executable and must not be: %. They are SECURITY INVOKER and update users/providers, so a client that can call them runs them with its own privileges and this grant breaks that path silently. Nothing changed.', v_bad;
  end if;

  -- (g) set_my_postcode MUST STILL BE INVOKER. Five columns stay granted for
  -- its sake and the header says so. If it has become DEFINER the header is
  -- false and the grant is five columns wider than it needs to be.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_my_postcode' and not p.prosecdef
  ) then
    raise exception '0088: set_my_postcode is not SECURITY INVOKER (or is missing). The five coordinate columns are granted for its sake and this file says so in writing. Re-decide them before applying. Nothing changed.';
  end if;

  -- (h) THE STAMP TRIGGER'S REASON FOR EXISTING MUST STILL HOLD. It replaces
  -- the client's write, and the thing that makes that write necessary is
  -- 0016's auto-publish trigger.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.providers'::regclass
       and tgname = 'trg_provider_maybe_publish' and not tgisinternal
  ) then
    raise exception '0088: trg_provider_maybe_publish is gone from public.providers. The stamp trigger below exists only to keep it disarmed when a stylist hides her shop. Re-read 0016 before applying. Nothing changed.';
  end if;
end $$;

-- ── THE REVOKE, THEN THE GRANT ─────────────────────────────────────────────
-- anon gets nothing back. There is no case for an unauthenticated writer on
-- either table: both are (app) surfaces behind auth, and no live client calls
-- either as anon.
revoke update on public.users     from authenticated, anon;
revoke update on public.providers from authenticated, anon;

-- 8 of 27. first_name/last_initial are additionally rate-limited by
-- guard_users_name_change (0056); profile_pic_url is deliberately a member's
-- own (0040's comment names it); the last three are set_my_postcode's.
grant update (
  first_name,
  last_initial,
  instagram_handle,
  notification_preferences,
  profile_pic_url,
  postcode,
  latitude,
  longitude
) on public.users to authenticated;

-- 7 of 18. is_published stays because publishing your own shop is the
-- legitimate act and it is already gated three ways: 0016's complete-profile
-- CHECK, the verified guard, and the RESTRICTIVE providers_not_suspended.
-- first_published_at does NOT stay — that is the one with teeth.
grant update (
  name,
  bio,
  location_text,
  profile_pic_url,
  is_published,
  latitude,
  longitude
) on public.providers to authenticated;

-- ── THE STAMP ──────────────────────────────────────────────────────────────
-- Gap-filling only. See the header: it never overrides a supplied value and
-- never refuses one. SECURITY INVOKER (the default) is correct and is the
-- mechanism — column privileges are checked against the STATEMENT'S TARGET
-- LIST, not against what a trigger writes, so this may set a column the member
-- who triggered it cannot name.
create or replace function public.tg_provider_stamp_first_published()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_published is distinct from old.is_published
     and old.first_published_at is null
     and new.first_published_at is not distinct from old.first_published_at
  then
    new.first_published_at := now();
  end if;
  return new;
end $$;

comment on function public.tg_provider_stamp_first_published() is
  'Stamps providers.first_published_at when is_published changes and the column is still null AND '
  'THE CALLER DID NOT NAME IT. Replaces site/app/(app)/shop/actions.ts:355-356, which lost the '
  'privilege in 0088. Never overrides a supplied value and never raises: the five preserve-or-stamp '
  'writers and the two clear-it writers all name the column and pass through untouched. 0088, item 156.';

drop trigger if exists trg_provider_stamp_first_published on public.providers;
create trigger trg_provider_stamp_first_published
  before update on public.providers
  for each row
  execute function public.tg_provider_stamp_first_published();

-- ── WHY THESE FIVE ARE STILL WRITABLE, ON THE COLUMNS THEMSELVES ───────────
comment on column public.users.postcode is
  'Writable by authenticated because set_my_postcode (0054) is SECURITY INVOKER by design — RLS is '
  'what confines it to your own rows. ⚠️ The rule that the coordinate must come from a server-side '
  'postcodes.io lookup was ALREADY advisory before 0088: 0054 says the function "does not and cannot '
  'check that the coordinate matches the postcode". The grant never held that rule up and 0088 does '
  'not weaken it. To tighten this, fix the rule, not the grant. 0088, item 156.';
comment on column public.users.latitude is
  'Writable by authenticated for set_my_postcode (0054, SECURITY INVOKER). See users.postcode. 0088.';
comment on column public.users.longitude is
  'Writable by authenticated for set_my_postcode (0054, SECURITY INVOKER). See users.postcode. 0088.';
comment on column public.providers.latitude is
  'Writable by authenticated for set_my_postcode (0054, SECURITY INVOKER). See users.postcode. 0088.';
comment on column public.providers.longitude is
  'Writable by authenticated for set_my_postcode (0054, SECURITY INVOKER). See users.postcode. 0088.';

comment on column public.providers.user_id is
  '⚠️ NOT writable by authenticated, and the GRANT is what stops it — not the policy. "providers can '
  'update own row" is USING (auth.uid() = user_id) WITH CHECK (none), and USING only tests the OLD '
  'row, so the policy does not enforce ownership on the row it writes. public.users has the WITH '
  'CHECK that public.providers lacks; the two policies look alike and only one is sound. 0088, item 156.';

comment on column public.providers.first_published_at is
  'System-owned. Not writable by authenticated since 0088. Set by tg_provider_stamp_first_published '
  'when the caller does not name it, and by the privileged writers when they do. ⚠️ TWO OPPOSITE '
  'CONVENTIONS ARE BOTH CORRECT: coalesce(first_published_at, now()) preserves the stamp so a '
  'withdrawn shop stays hidden (0044), and = null clears it so a re-verified shop republishes '
  '(0040). Do not "unify" them, and do not add a trigger policing the value — it would have to break '
  'one of the two. 0088, item 156.';

comment on column public.users.profile_pic_reviewed_at is
  'Moderation evidence. Not writable by authenticated since 0088 — this is item 157''s fix. Setting '
  'it removed a photo from the admin queue (admin/app/moderation/page.tsx filters .is(…, null)), and '
  'guard_users_protected_columns never named it because 0060 added the column three weeks after 0040 '
  'wrote its list. Written only by admin_mark_profile_pic_seen (DEFINER). 0088, item 157.';

-- ── POST-CONDITION ─────────────────────────────────────────────────────────
do $$
declare
  v_got    text;
  v_want   text;
  v_n      integer;
  v_all    integer;
begin
  v_want := 'first_name,instagram_handle,last_initial,latitude,longitude,notification_preferences,postcode,profile_pic_url';
  select coalesce(string_agg(column_name, ',' order by column_name), '(none)') into v_got
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'users'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_got <> v_want then
    raise exception '0088: authenticated may update these users columns: %. Expected: %. Rolled back.', v_got, v_want;
  end if;

  v_want := 'bio,is_published,latitude,location_text,longitude,name,profile_pic_url';
  select coalesce(string_agg(column_name, ',' order by column_name), '(none)') into v_got
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'providers'
     and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_got <> v_want then
    raise exception '0088: authenticated may update these providers columns: %. Expected: %. Rolled back.', v_got, v_want;
  end if;

  -- anon holds nothing on either table.
  select count(*) into v_n
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('users', 'providers')
     and grantee = 'anon' and privilege_type = 'UPDATE';
  if v_n <> 0 then
    raise exception '0088: anon still holds UPDATE on % column(s) across the two tables. Rolled back.', v_n;
  end if;

  -- THE CONTROL, against the same expression guard (d) proved true beforehand.
  select count(*) into v_all
    from information_schema.columns
   where table_schema = 'public' and table_name in ('users', 'providers');
  select count(*) into v_n
    from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('users', 'providers')
     and grantee = 'service_role' and privilege_type = 'UPDATE';
  if v_n <> v_all then
    raise exception '0088: service_role holds UPDATE on % of % columns across the two tables. A revoke from authenticated must not have reached it. Rolled back.', v_n, v_all;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.providers'::regclass
       and tgname = 'trg_provider_stamp_first_published' and not tgisinternal
  ) then
    raise exception '0088: trg_provider_stamp_first_published is not on public.providers. Without it, hiding a never-stamped shop re-arms auto-publish. Rolled back.';
  end if;
end $$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0088', 'a_column_you_cannot_name_is_a_column_you_cannot_forge', '7f63f9ecc45a3c4ad0239da7180e3177cb7b9455c2f0e6cfd325d6b2208143ef');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- ⚠️ PREFLIGHT — RUN BEFORE THIS MIGRATION. Read-only, one block.
--
--   select 'gate' as kind, 'booleans' as name,
--          '0087_applied=' || ((select count(*) from public.schema_migrations where version='0087') = 1)::text
--       || ' | authed+anon UPDATE cols (expect 90 = 45 x 2)='
--       || (select count(*)::text from information_schema.column_privileges
--            where table_schema='public' and table_name in ('users','providers')
--              and grantee in ('authenticated','anon') and privilege_type='UPDATE')
--       || ' | PUBLIC holds UPDATE='
--       || exists(select 1 from information_schema.column_privileges
--                  where table_schema='public' and table_name in ('users','providers')
--                    and grantee='PUBLIC' and privilege_type='UPDATE')::text
--       || ' | service_role cols (expect 45)='
--       || (select count(*)::text from information_schema.column_privileges
--            where table_schema='public' and table_name in ('users','providers')
--              and grantee='service_role' and privilege_type='UPDATE') as detail
--   union all
--   select 'invoker', 'uncleared invoker writers',
--          coalesce((select string_agg(distinct f.proname::text, ', ')
--                      from pg_proc f
--                      join pg_namespace n on n.oid = f.pronamespace
--                      cross join (values ('users'),('providers')) as t(name)
--                     where n.nspname='public' and f.prokind in ('f','p') and not f.prosecdef
--                       and pg_get_functiondef(f.oid) ~* ('update[[:space:]]+(public[.])?' || t.name || '[^a-z_]')
--                       and f.proname::text not in ('set_my_postcode','_admin_apply_user_action','_withdraw_stylist')),
--                   '(none - expected)')
--   union all
--   select 'invoker', 'the two that must be client-unreachable',
--          coalesce((select string_agg(p.proname::text || '=' || r.rolname, ', ')
--                      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--                      cross join (select unnest(array['authenticated','anon']) as rolname) r
--                     where n.nspname='public'
--                       and p.proname::text in ('_admin_apply_user_action','_withdraw_stylist')
--                       and has_function_privilege(r.rolname, p.oid, 'execute')),
--                   '(none - expected)')
--   union all
--   select '157', '0 of 0 must still hold',
--          (select count(*)::text from public.users where profile_pic_reviewed_at is not null)
--          || ' rows have profile_pic_reviewed_at set'
--   order by 1, 2;
--
--   EXPECT: 0087_applied=true | 90 | PUBLIC=false | 45 ·
--           (none - expected) · (none - expected) · 0 rows.
--
--   ⚠️ DO NOT ADD 'public' TO THAT ROLE ARRAY. has_function_privilege('public',
--   …) raises `role "public" does not exist` — PUBLIC is a pseudo-role with no
--   pg_roles entry. It is also redundant: authenticated and anon both inherit a
--   PUBLIC grant, so it is visible through either. Note that UPDATE on a COLUMN
--   is different: information_schema.column_privileges DOES report a 'PUBLIC'
--   grantee, which is why guard (c) above can and does query for it by name.
--
--   ⚠️ IF `uncleared invoker writers` NAMES ANYTHING, STOP. That is the
--   _withdraw_stylist class and it is the one failure here that is silent at
--   the call site. The guard aborts on it too; seeing it first is cheaper.
-- ===========================================================================
--
-- ===========================================================================
-- ── VERIFY ─ ONE BLOCK, after applying. Rolls itself back. ───────────
--
-- ⚠⚠ EVERY RESULT ACCUMULATES INTO A VARIABLE AND IS EMITTED BY THE FINAL
-- `raise exception`. THE SUPABASE SQL EDITOR DOES NOT DISPLAY NOTICE MESSAGES
-- — it shows result sets and errors. An earlier draft of this block used
-- `raise notice` for all fifteen results, so the only thing it would have put
-- on screen was "ROLLED BACK ON PURPOSE - read the notices above", with no
-- notices above it. A verify that cannot report is the same class as a verify
-- that cannot fail. 0086's and 0087's blocks already did it this way; this one
-- broke the convention and Micky caught it. 6 Oct 2026.
--
-- Run as the provider test account 517c2853… (nahitih259@bevriz.com). Every
-- section has its own begin/exception so one failure cannot mask the rest, and
-- every refusal is proved by a REFUSED STATEMENT rather than inferred from the
-- grant list — a column privilege is checked against the statement's TARGET
-- LIST, so a refused UPDATE is the only thing proving PostgREST and the
-- catalogue agree about that column.
--
--   do $$
--   declare
--     v_user  uuid := '517c2853-50bb-4e8f-87fe-d79311bc37c0';
--     v_prov  uuid;
--     v_txt   text;
--     v_ts    timestamptz;
--     v_pub   boolean;
--     v_tag   text := 'cavy-0088-verify';
--     r_a1    text := 'not run';
--     r_a1b   text := 'not run';
--     r_a2    text := 'not run';
--     r_b1    text := 'not run';
--     r_b2    text := 'not run';
--     r_b3    text := 'not run';
--     r_b4    text := 'not run';
--     r_b5    text := 'not run';
--     r_c0    text := 'setup OK';
--     r_c1    text := 'not run';
--     r_d1    text := 'not run';
--     r_d2    text := 'not run';
--     r_d3    text := 'not run';
--   begin
--     select id into v_prov from public.providers where user_id = v_user;
--     if v_prov is null then
--       raise exception 'VERIFY: no providers row for the test account. Nothing was tested.';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       '{"sub":"517c2853-50bb-4e8f-87fe-d79311bc37c0","role":"authenticated"}', true);
--     execute 'set local role authenticated';
--
--     -- ── A1. BUCKET A ON users, SIX COLUMNS ─────────────────────
--     -- ⚠️ first_name and last_initial are NOT here. guard_users_name_change
--     -- (0056) rate-limits them, so a refusal on those two is A DIFFERENT
--     -- MECHANISM doing its job — bundled in, it would read as this migration's
--     -- grant having failed. They get A1b to themselves.
--     begin
--       update public.users
--          set instagram_handle = v_tag,
--              notification_preferences = '{"email":{"enabled":false}}'::jsonb,
--              profile_pic_url = v_tag, postcode = 'SW1A 1AA',
--              latitude = 51.5, longitude = -0.14
--        where id = v_user;
--       select instagram_handle into v_txt from public.users where id = v_user;
--       r_a1 := case when v_txt = v_tag then 'pass  - 6 granted cols accepted and READ BACK NEW'
--                    else 'FAIL  - reported success but the row still reads ' || coalesce(v_txt, 'null') end;
--     exception when others then
--       r_a1 := 'FAIL  - refused with ' || sqlstate || ': ' || sqlerrm;
--     end;
--
--     -- ── A1b. THE TWO NAME COLUMNS ──────────────────────────
--     -- ⚠⚠ FOUR DISTINCT OUTCOMES, AND THE OUTPUT SAYS WHICH ONE HAPPENED. An
--     -- earlier draft had `when others then 'pass (grant held)'`, which reports a
--     -- PASS ON ANY UNKNOWN ERROR — a constraint, an unrelated trigger, a typo in
--     -- the statement. That is the class this migration's own guard (b) refuses.
--     --
--     -- 0056 raises 22023 for the 30-day limit and 42501 for a SUSPENDED account,
--     -- so 42501 ALONE DOES NOT MEAN THE GRANT IS WRONG and is split by message.
--     -- A write that succeeds is stronger evidence than any refusal, and the
--     -- output distinguishes the two rather than calling both 'pass'.
--     begin
--       update public.users set first_name = v_tag, last_initial = 'Z' where id = v_user;
--       select first_name into v_txt from public.users where id = v_user;
--       r_a1b := case when v_txt = v_tag
--                     then 'pass  - BY WRITING: name columns accepted and READ BACK NEW'
--                     else 'FAIL  - reported success but the row still reads ' || coalesce(v_txt, 'null') end;
--     exception
--       when invalid_parameter_value then          -- 22023, 0056's 30-day limit
--         r_a1b := 'pass  - BY REFUSAL: grant held; 0056 30-day rate limit refused it (22023). '
--                  || 'No read-back, so this is the weaker of the two passes. ' || sqlerrm;
--       when insufficient_privilege then           -- 42501: grant OR 0056 suspension
--         r_a1b := case when sqlerrm ilike '%suspend%'
--                       then 'pass  - BY REFUSAL: grant held; 0056 refused a SUSPENDED account (42501). ' || sqlerrm
--                       else 'FAIL  - 42501 and nothing about suspension: THE GRANT IS WRONG. ' || sqlerrm end;
--       when others then
--         r_a1b := 'UNEXPECTED - refused by something this block does not model: '
--                  || sqlstate || ': ' || sqlerrm || ' (neither a pass nor a grant failure)';
--     end;
--
--     -- ── A2. BUCKET A ON providers ─────────────────────────
--     begin
--       update public.providers
--          set name = v_tag, bio = v_tag, location_text = v_tag,
--              profile_pic_url = v_tag, latitude = 51.5, longitude = -0.14
--        where id = v_prov;
--       select bio into v_txt from public.providers where id = v_prov;
--       r_a2 := case when v_txt = v_tag then 'pass  - 6 granted cols accepted and READ BACK NEW'
--                    else 'FAIL  - reported success but the row still reads ' || coalesce(v_txt, 'null') end;
--     exception when others then
--       r_a2 := 'FAIL  - refused with ' || sqlstate || ': ' || sqlerrm;
--     end;
--
--     -- ── B. THE FIVE REFUSALS, EACH NAMED, EACH EXPECTING 42501 ────────
--     -- users.email is the sharpest column in the set: send-email addresses every
--     -- transactional message from public.users.email (index.ts:364), so a
--     -- writable one redirects Cavy's own mail to any address from an
--     -- authenticated domain. Proved by a refusal, never inferred.
--     begin
--       update public.users set email = 'cavy-0088@example.invalid' where id = v_user;
--       r_b1 := 'FAIL  - users.email WAS ACCEPTED';
--     exception when insufficient_privilege then r_b1 := 'pass  - users.email refused 42501';
--               when others then r_b1 := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--
--     begin
--       update public.users set profile_pic_reviewed_at = now() where id = v_user;
--       r_b2 := 'FAIL  - profile_pic_reviewed_at WAS ACCEPTED (item 157 is NOT closed)';
--     exception when insufficient_privilege then
--                 r_b2 := 'pass  - profile_pic_reviewed_at refused 42501 (item 157 closed)';
--               when others then r_b2 := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--
--     begin
--       update public.providers set rating = 5.0 where id = v_prov;
--       r_b3 := 'FAIL  - providers.rating WAS ACCEPTED (forged social proof)';
--     exception when insufficient_privilege then r_b3 := 'pass  - providers.rating refused 42501';
--               when others then r_b3 := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--
--     -- The policy has NO WITH CHECK, so the GRANT is the only thing refusing.
--     begin
--       update public.providers set user_id = v_user where id = v_prov;
--       r_b4 := 'FAIL  - providers.user_id WAS ACCEPTED; nothing stands in front of the missing WITH CHECK';
--     exception when insufficient_privilege then r_b4 := 'pass  - providers.user_id refused 42501';
--               when others then r_b4 := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--
--     begin
--       update public.providers set first_published_at = now() where id = v_prov;
--       r_b5 := 'FAIL  - providers.first_published_at WAS ACCEPTED';
--     exception when insufficient_privilege then r_b5 := 'pass  - providers.first_published_at refused 42501';
--               when others then r_b5 := 'FAIL  - refused with ' || sqlstate || ', not 42501: ' || sqlerrm;
--     end;
--
--     -- ── C. THE STAMP FILLS THE GAP THE CLIENT USED TO FILL ──────────
--     -- The real scenario from shop/actions.ts:302 — a stylist HIDES her shop.
--     -- Without a stamp, trg_provider_maybe_publish stays armed and the same
--     -- statement's trigger undoes the hide.
--     --
--     -- ⚠️ THE SETUP NEVER TOGGLES is_published AS OWNER. An earlier draft did,
--     -- which fires 0016's AFTER trigger and can auto-republish the row mid-test
--     -- — a precondition that undoes itself. Nulling the stamp alone is not a
--     -- transition, so neither trigger fires on the setup.
--     execute 'reset role';
--     update public.providers set is_published = true where id = v_prov;       -- stamp auto-fills
--     update public.providers set first_published_at = null where id = v_prov; -- no transition
--     select first_published_at, is_published into v_ts, v_pub
--       from public.providers where id = v_prov;
--     if v_ts is not null or v_pub is not true then
--       r_c0 := 'SETUP FAILED - stamp=' || coalesce(v_ts::text, 'null')
--               || ' published=' || coalesce(v_pub::text, 'null') || '; C1 BELOW PROVES NOTHING';
--     end if;
--
--     perform set_config('request.jwt.claims',
--       '{"sub":"517c2853-50bb-4e8f-87fe-d79311bc37c0","role":"authenticated"}', true);
--     execute 'set local role authenticated';
--     begin
--       update public.providers set is_published = false where id = v_prov;   -- stamp NOT named
--       execute 'reset role';
--       select first_published_at, is_published into v_ts, v_pub
--         from public.providers where id = v_prov;
--       r_c1 := case
--         when v_ts is null then 'FAIL  - hidden with the stamp still null; auto-publish is RE-ARMED'
--         when v_pub is not false then 'FAIL  - stamped but is_published reads ' || v_pub::text
--                                      || '; auto-publish fired anyway'
--         else 'pass  - stamp filled by the trigger and the shop stayed hidden' end;
--     exception when others then
--       execute 'reset role';
--       r_c1 := 'FAIL  - member could not hide at all: ' || sqlstate || ': ' || sqlerrm;
--     end;
--
--     -- ── D. CONTROLS. A verify that passes because everything is broken must
--     --    be distinguishable from one that passes correctly. ─────────────
--     execute 'reset role';
--     select count(*)::text || ' (expect 45)' into r_d1
--       from information_schema.column_privileges
--      where table_schema = 'public' and table_name in ('users', 'providers')
--        and grantee = 'service_role' and privilege_type = 'UPDATE';
--
--     perform set_config('request.jwt.claims',
--       '{"sub":"517c2853-50bb-4e8f-87fe-d79311bc37c0","role":"authenticated"}', true);
--     execute 'set local role authenticated';
--     begin
--       perform public.set_my_postcode('SW1A 1AA', 51.5, -0.14);
--       r_d2 := 'pass  - set_my_postcode still works; the five retained columns earn their place';
--     exception when others then
--       r_d2 := 'FAIL  - set_my_postcode broke: ' || sqlstate || ': ' || sqlerrm;
--     end;
--
--     -- ⚠️ ASSERTED FROM THE CATALOGUE, NOT BY AN UPDATE: the test account may own
--     -- no model_attributes row, and an UPDATE matching zero rows SUCCEEDS — so
--     -- that version would have reported a pass it had not earned.
--     execute 'reset role';
--     select (count(cp.column_name))::text || ' of ' || (count(c.column_name))::text
--            || ' (expect all of them)'
--       into r_d3
--       from information_schema.columns c
--       left join information_schema.column_privileges cp
--             on cp.table_schema = 'public' and cp.table_name = 'model_attributes'
--            and cp.column_name = c.column_name
--            and cp.grantee = 'authenticated' and cp.privilege_type = 'UPDATE'
--      where c.table_schema = 'public' and c.table_name = 'model_attributes';
--
--     execute 'reset role';
--
--     -- ONE raise, ONE %, ONE concatenated string. This is the only output.
--     raise exception '%',
--       chr(10) || '=== 0088 VERIFY — ROLLED BACK ON PURPOSE ==='
--       || chr(10) || 'A1   users  bucket A (6 cols) : ' || r_a1
--       || chr(10) || 'A1b  users  name columns      : ' || r_a1b
--       || chr(10) || 'A2   provs  bucket A (6 cols) : ' || r_a2
--       || chr(10) || 'B1   users.email              : ' || r_b1
--       || chr(10) || 'B2   users.profile_pic_rev_at : ' || r_b2
--       || chr(10) || 'B3   providers.rating         : ' || r_b3
--       || chr(10) || 'B4   providers.user_id        : ' || r_b4
--       || chr(10) || 'B5   providers.first_pub_at   : ' || r_b5
--       || chr(10) || 'C0   stamp-test setup         : ' || r_c0
--       || chr(10) || 'C1   hide fills the stamp     : ' || r_c1
--       || chr(10) || 'D1   service_role UPDATE cols : ' || r_d1
--       || chr(10) || 'D2   set_my_postcode          : ' || r_d2
--       || chr(10) || 'D3   model_attributes (control): ' || r_d3;
--   end $$;
--
--   EXPECT: A1, A1b, A2 pass · B1-B5 all pass · C0 "setup OK" · C1 pass ·
--           D1 = 45 · D2 pass · D3 all of them.
--
--   ⚠️ ANY LINE STILL READING "not run" MEANS THE BLOCK DIED BEFORE REACHING IT
--   — that is why they are initialised to that and not to anything that could be
--   mistaken for a result.
--
--   ⚠️ C0 ANYTHING BUT "setup OK" VOIDS C1. It is a separate line rather than
--   folded into C1 so a setup that failed cannot be read as a test that passed.
--
--   ⚠️ A1b TELLS YOU WHICH PASS YOU GOT. "BY WRITING" is a read-back and is
--   strong. "BY REFUSAL" means 0056 refused it first and the grant was never
--   exercised — true, but weaker, and worth re-running after 30 days.
-- ===========================================================================
