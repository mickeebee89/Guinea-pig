-- ===========================================================================
-- 0016_publish_when_the_shop_exists
--
-- A shop cannot be published without a name and at least one treatment — and a
-- verified stylist who has both is published automatically, with nobody
-- intervening.
--
-- ⚠️ Apply 0014 first — this migration writes to migration_findings.
--
-- ── THE PROMISE THIS MAKES TRUE ───────────────────────────────────────────
-- The setup panel already tells every stylist, in both apps:
--
--   "Once the ID check passes, we publish your shop for you — there's no switch
--    to flip."
--
-- Today publication happens on ID approval whether or not a shop exists.
-- admin/app/verification/page.tsx:80 sets users.is_verified, :87 sets
-- providers.is_published, and nothing between them looks at the profile.
-- enforce_publish_requires_verified only checks verification. Mobile's
-- togglePublished DOES require at least one treatment — but admin approve
-- writes providers directly and bypasses it, so the only path with a
-- completeness check is the only path approval never takes.
--
-- The result, found 10 Aug: six providers published and verified with no name.
-- public_stylists excluded them on its content bar, so the open web was safe.
-- /browse had no such bar and was showing all six in the member area as cards
-- labelled "Stylist".
--
-- ── FIFTH INSTANCE. THE PATTERN, AND HOW IT IS FOUND. ─────────────────────
-- Published copy with no mechanism behind it, in one week:
--
--   1. is_founding_provider — promised on /for-stylists and in Terms §5, read
--      in four places, written by nothing.           → 0011, mechanism added
--   2. The privacy policy described recording an IP
--      address that was never recorded.              → 0010, claim retracted
--   3. The ID check described as confirming "you are
--      who you say you are" — no document is ever
--      seen, so it confirmed no such thing.          → 10 Aug, claim weakened
--   4. "a booking still uses it — it'll come off once
--      that booking is finished or cancelled"        → 0013, mechanism added
--   5. "we publish your shop for you"                → this migration
--
-- Two remedies, and choosing between them is the whole judgement: ADD THE
-- MECHANISM when the promise is one we want to keep, RETRACT THE CLAIM when it
-- is not. Getting that backwards is how you end up defending a sentence.
--
-- NONE of the five was found by anything failing. Every one was found by
-- reading. That is the argument for auditing copy against code directly rather
-- than waiting for a bug report, because there will not be one — a promise with
-- no mechanism does not throw, it just quietly is not true.
--
-- ── THE BIO IS NOT PART OF THIS BAR, AND THE FIRST DRAFT SAID IT WAS ──────
--
-- ⚠️ THE REUSABLE LESSON: A THRESHOLD TRAVELS, ITS REASON MAY NOT.
--
-- The first version of this migration required a 40-character bio to publish,
-- reusing public_stylists' content bar on the stated grounds that "two
-- thresholds for one idea is how location/location_text happened". That
-- argument was about a number appearing twice. It said nothing about whether
-- the number MEANT the same thing in both places, and it does not.
--
-- The 40-character bar exists to avoid a thin-content manual action from a
-- SEARCH CRAWLER indexing a brand-new domain. That is the entire reason for it.
--
--   * There is no crawler behind an auth gate.
--   * There is no crawler on a live diary.
--
-- A stylist with a name, six treatments and a thirteen-character bio is not a
-- thin-content risk. They are a working shop that models can book.
--
-- The same mistake was made TWICE in one change: the publish guard here, and a
-- copy of the same bar added to lib/queries/browse.ts. Both hid or unpublished
-- real stylists to satisfy an SEO rule for an audience that was not present.
--
-- So the split is now:
--
--   publish (this migration)  a name, and at least one treatment
--   public_stylists           name + bio >= 40 + a category   [unchanged]
--   /browse                   a name, and a category
--
-- Three bars, on purpose, because they answer three different questions. The
-- test for "is this duplication or is this a coincidence" is not whether the
-- numbers match — it is whether one changing should force the other to.
--
-- ── HOW THIS WAS CAUGHT: 0014'S ASSERT, ON THE CONFIDENT RUN ──────────────
-- The assert below aborted the first attempt: it would have unpublished
-- Micky B — the project's own live provider account, with bookings on 12 and
-- 15 August — for having a 13-character bio.
--
-- Worth recording precisely because of what had been said out loud minutes
-- earlier: that the six blank profiles had no bookings, so this "should sail
-- through". That prediction was confident, reasoned from real data, and wrong,
-- because it was checking the wrong criterion — blank NAME rather than the
-- full completeness rule the assert actually used.
--
-- That is 0014's assert catching something on both of its first two outings,
-- and the second time it caught the author of the assert. **The run you are
-- most confident about is exactly the run where the check pays**, because
-- confidence is what removes the impulse to look. A check that only runs when
-- someone already suspects a problem is a check that will not be there when it
-- matters.
--
-- ── WHY first_published_at EXISTS ─────────────────────────────────────────
-- Auto-publish must fire ONCE, ever. Without a marker, a stylist who
-- deliberately turns their shop off would be silently republished by their next
-- profile edit — the feature would override a decision the user made on
-- purpose, which is worse than the bug it fixes.
--
-- So: auto-publish only where first_published_at is null. After the first time,
-- publishing and unpublishing belong entirely to the stylist.
-- ===========================================================================

begin;

do $$
begin
  if exists (select 1 from public.schema_migrations where version = '0016') then
    raise exception 'Migration 0016 has already been applied (see public.schema_migrations)';
  end if;
end $$;

alter table public.providers
  add column if not exists first_published_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. One definition of "there is a shop here to publish".
--
--    NAMED for what it checks. The first draft called this
--    provider_profile_is_complete(), which claimed more than it delivered — a
--    profile with no bio, no location and no photo would have passed it. A
--    function whose name overstates its check is the same failure as copy that
--    overstates a feature, and this file already has a section about that.
--
--    STABLE so it can sit in a WHERE clause. SECURITY DEFINER so the guard sees
--    provider_treatments regardless of who is publishing — an admin approving a
--    stylist must not pass the check merely because RLS hid the evidence.
-- ---------------------------------------------------------------------------
create or replace function public.provider_shop_is_publishable(p_provider_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.providers p
    where p.id = p_provider_id
      and coalesce(btrim(p.name), '') <> ''
      and exists (
        select 1 from public.provider_treatments pt
        where pt.provider_id = p.id and pt.category is not null
      )
  );
$function$;

-- ---------------------------------------------------------------------------
-- 2. MEASURE, per 0014.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0016', 'published providers with an incomplete profile', count(*)::text
from public.providers p
where p.is_published is true and not public.provider_shop_is_publishable(p.id);

insert into public.migration_findings (version, item, value)
select '0016', 'published providers total, before', count(*)::text
from public.providers where is_published is true;

-- ---------------------------------------------------------------------------
-- 3. ASSERT, per 0014.
--
--    Unpublishing a shop that somebody is about to visit is disruptive in a way
--    unpublishing a blank test account is not. If any incomplete-but-published
--    provider has an upcoming booking, that is a real stylist with a real
--    diary and a human should look before this runs.
--
--    "Upcoming" matches 0015: pending/accepted AND date >= current_date. A
--    stale accepted row from July is not someone about to be let down.
-- ---------------------------------------------------------------------------
do $$
declare v_risky integer;
begin
  select count(*) into v_risky
  from public.providers p
  where p.is_published is true
    and not public.provider_shop_is_publishable(p.id)
    and exists (
      select 1 from public.sessions s
      where s.provider_id = p.id
        and s.status in ('pending', 'accepted')
        and s.date >= current_date
    );

  if v_risky > 0
     and coalesce(current_setting('cavy.migration_override', true), '') <> 'yes' then
    raise exception
      '0016 would unpublish % provider(s) that have upcoming bookings. Look at them first, '
      'then re-run with: set local cavy.migration_override = ''yes'';', v_risky;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Make the data agree with the rule.
--
--    first_published_at stays NULL on these, deliberately: they were never
--    legitimately published, so completing their profile later SHOULD publish
--    them automatically like anyone else's.
-- ---------------------------------------------------------------------------
update public.providers p
   set is_published = false
 where p.is_published is true
   and not public.provider_shop_is_publishable(p.id);

-- Everyone still published got there properly. Stamp them so auto-publish never
-- touches them again and their on/off switch stays theirs.
update public.providers
   set first_published_at = coalesce(first_published_at, now())
 where is_published is true;

-- ---------------------------------------------------------------------------
-- 5. The guard.
--
--    Separate from enforce_publish_requires_verified rather than folded into
--    it: that function's name says what it checks, and a function whose name
--    describes half its behaviour is its own small lie. Two triggers, one job
--    each.
--
--    23514 (check_violation) rather than a bare raise, so clients can tell "the
--    shop is not ready" from a genuine fault.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_publish_requires_complete_profile()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_missing text[] := '{}';
begin
  if new.is_published is not true then
    return new;
  end if;

  if coalesce(btrim(new.name), '') = '' then
    v_missing := v_missing || 'a name';
  end if;

  -- No bio check. A short bio keeps a shop off the PUBLIC website
  -- (public_stylists' content bar) and out of nothing else. It is not a reason
  -- to keep a stylist unbookable by members. See the header.

  if not exists (
    select 1 from public.provider_treatments pt
    where pt.provider_id = new.id and pt.category is not null
  ) then
    v_missing := v_missing || 'at least one treatment';
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'Cannot publish shop: still needs %', array_to_string(v_missing, ', ')
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_publish_requires_complete_profile on public.providers;

create trigger trg_publish_requires_complete_profile
  before insert or update on public.providers
  for each row execute function public.enforce_publish_requires_complete_profile();

-- ---------------------------------------------------------------------------
-- 6. Auto-publish. THE POINT OF THE WHOLE MIGRATION.
--
--    A verified stylist who finishes their profile goes live with no admin
--    round trip. Without this, the guard above turns the old bug into a new
--    one: verified-but-incomplete becomes a silent dead end that only an admin
--    noticing could rescue — worst of all for a cohort, where nobody is
--    watching individual accounts.
--
--    Idempotent by construction: the UPDATE matches nothing once is_published
--    is true, so the re-entrant fire from its own trigger terminates.
-- ---------------------------------------------------------------------------
create or replace function public.publish_provider_if_eligible(p_provider_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update public.providers p
     set is_published       = true,
         first_published_at = now()
   where p.id = p_provider_id
     and p.is_published is not true
     and p.first_published_at is null          -- once, ever. See header.
     and public.provider_shop_is_publishable(p.id)
     and exists (
       select 1 from public.users u
       where u.id = p.user_id and u.is_verified is true
     );
end;
$function$;

-- Three things can make a provider eligible, so three triggers call the one
-- function. Putting the rule in one place and the triggers at the edges is the
-- same choice as 0012: the rule belongs to the data, not to whichever table
-- happened to change.

-- (a) the profile itself changed — a name or bio was filled in
create or replace function public.tg_provider_maybe_publish()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.publish_provider_if_eligible(new.id);
  return null;
end;
$function$;

drop trigger if exists trg_provider_maybe_publish on public.providers;

create trigger trg_provider_maybe_publish
  after update on public.providers
  for each row
  when (new.is_published is not true and new.first_published_at is null)
  execute function public.tg_provider_maybe_publish();

-- (b) a first treatment was added
create or replace function public.tg_treatment_maybe_publish()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.publish_provider_if_eligible(new.provider_id);
  return null;
end;
$function$;

drop trigger if exists trg_treatment_maybe_publish on public.provider_treatments;

create trigger trg_treatment_maybe_publish
  after insert on public.provider_treatments
  for each row execute function public.tg_treatment_maybe_publish();

-- (c) the ID check passed — this is the admin-approval path
create or replace function public.tg_user_verified_maybe_publish()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  if new.is_verified is true and old.is_verified is distinct from true then
    for r in select id from public.providers where user_id = new.id loop
      perform public.publish_provider_if_eligible(r.id);
    end loop;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_user_verified_maybe_publish on public.users;

create trigger trg_user_verified_maybe_publish
  after update of is_verified on public.users
  for each row execute function public.tg_user_verified_maybe_publish();

insert into public.migration_findings (version, item, value)
select '0016', 'published providers total, after', count(*)::text
from public.providers where is_published is true;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0016', 'publish_when_the_shop_exists', '4f234704fde7a87d7d8fe546d7bba5ee1ccb312bc6e3e24e50f97b4ca92fc14f');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- VERIFY AFTER APPLYING
--
-- ── BLOCK A — what changed, from the migration's own record ──────────────
--
--   select item, value from public.migration_findings
--   where version = '0016' order by id;
--
--   Expect before minus after = the six blank profiles.
--
-- ── BLOCK B — nothing published is incomplete any more ───────────────────
--
--   select count(*) as should_be_zero
--   from public.providers p
--   where p.is_published is true and not public.provider_shop_is_publishable(p.id);
--
-- ── BLOCK C — the guard refuses. Rolls itself back. ──────────────────────
--
--   Expect: ERROR 23514, listing exactly what is missing.
--
--   begin;
--     update public.providers
--        set is_published = true
--      where id = (select id from public.providers
--                   where is_published is not true
--                     and coalesce(btrim(name), '') = '' limit 1);
--   rollback;
--
-- ── BLOCK C2 — a SHORT BIO does NOT block publishing ─────────────────────
--
--   The regression this migration was revised to prevent. Expect: no error.
--
--   begin;
--     update public.providers set is_published = true
--      where id = (select p.id from public.providers p
--                   where coalesce(btrim(p.name), '') <> ''
--                     and length(btrim(coalesce(p.bio, ''))) < 40
--                     and exists (select 1 from public.provider_treatments pt
--                                  where pt.provider_id = p.id and pt.category is not null)
--                   limit 1);
--   rollback;
--
-- ── BLOCK D — auto-publish fires with no admin. Rolls itself back. ───────
--
--   Takes an unpublished, unverified, incomplete provider; completes it and
--   verifies it; expects is_published to have become true on its own.
--
--   begin;
--     with target as (
--       select p.id, p.user_id from public.providers p
--        where p.is_published is not true and p.first_published_at is null
--        limit 1
--     )
--     insert into public.provider_treatments (provider_id, name, category)
--     select id, 'Nails', 'Nails' from target;
--
--     update public.providers set name = 'Verify 0016'
--      where id = (select id from public.providers
--                   where is_published is not true and first_published_at is null limit 1);
--
--     update public.users set is_verified = true
--      where id = (select user_id from public.providers
--                   where name = 'Verify 0016' limit 1);
--
--     -- expect: is_published true, first_published_at set, nobody having acted
--     select name, is_published, first_published_at is not null as stamped
--     from public.providers where name = 'Verify 0016';
--   rollback;
--
-- ── BLOCK E — a deliberate unpublish is NOT undone ───────────────────────
--
--   The failure this would be worst: overriding a choice the stylist made.
--
--   begin;
--     update public.providers set is_published = false
--      where is_published is true limit 1;              -- first_published_at stays set
--     update public.providers set bio = bio || ' edited'
--      where first_published_at is not null and is_published is false;
--     -- expect: still false
--     select name, is_published from public.providers
--      where first_published_at is not null and is_published is false;
--   rollback;
--
-- ===========================================================================


-- ===========================================================================
-- LAST STEP, EVERY TIME
--
--   node scripts/migration-status.mjs
-- ===========================================================================
