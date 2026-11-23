-- ===========================================================================
-- 0113_an_invite_is_a_record_not_a_notification
--
-- Stylist-to-model invites: a discoverability flag, a table that records an
-- invite, a gated directory function, and a rewrite of the one function that
-- already sends invites today.
--
-- ⚠️⚠️ THIS IS NOT A NEW CAPABILITY. IT IS A GATE ON A LIVE, UNGATED ONE.
-- The brief this was written from said "today a stylist cannot see or contact
-- a model at all". That is false, and the difference matters for every line
-- below:
--
--   * `public.invite_model(uuid)` EXISTS, is SECURITY DEFINER, and is granted
--     to `authenticated`.
--   * `site/app/(app)/salon-floor/actions.ts` calls it. So does dormant
--     mobile's model profile screen.
--   * It has sent 8 invites, to 1 model.
--   * It checks TWO things: that the caller has a providers row, and that the
--     target is not herself. It does not check publication, blocks,
--     suspension, discoverability, or whether it has already invited this
--     person. Its own docblock records "NO RATE LIMIT, DECIDED 2 Oct 2026 —
--     a stylist may invite whoever she likes, as often as she likes."
--
-- So the constraints in this migration are not additions to a blank space.
-- They REVERSE a recorded decision and TIGHTEN a live function, and they had
-- to be applied to `invite_model` itself rather than to a new parallel path —
-- otherwise the Salon Floor would keep sending ungated, unrecorded, unlimited
-- invites beside a front door with a lock on it.
--

-- ===========================================================================
-- ⚠⚠ RETRACTION: 0112'S HEADER IS WRONG ABOUT THIS, AND 0112 CANNOT BE FIXED
-- ===========================================================================
-- `0112_model_demand_summary` argues, at length and in bold, that a model
-- directory would be "look-only" exposure. Its exact words:
--
--     "**a stylist cannot contact a model at all.** The sessions RLS policy
--      'model can create session' requires `auth.uid() = model_user_id`, and
--      a message needs a session that already exists, so there is no
--      provider-initiated path anywhere in the system. A directory would
--      publish 85 people's names, photographs and physical attributes to
--      power a button that does not exist."
--
-- **THE BUTTON EXISTS. IT HAS EXISTED THE WHOLE TIME.** Measured 23 Nov 2026:
--
--   * the FIRST stylist_invite notification was sent **20 June 2026** -- five
--     months before 0112 said the path did not exist;
--   * 8 have been sent in all, the last on 4 October 2026, to 1 model;
--   * `invite_model(uuid)` was created and granted to `authenticated` by
--     **0081, applied 4 October 2026**. The capability is OLDER than the
--     function: before 0081 the insert was made client-side from mobile,
--     which is why the first invite predates the RPC by three months;
--   * `site/app/(app)/salon-floor/actions.ts` calls it on the live website.
--
-- ⚠️ WHERE THE REASONING WENT WRONG, because the sentence it generalised
-- from is TRUE: the sessions RLS policy really does require
-- `auth.uid() = model_user_id`, so a stylist cannot start a BOOKING. That is
-- not the same as cannot make CONTACT, and the notifications table was the
-- door nobody looked at.
--
-- ⚠️ 0112 IS NOT EDITED, AND MUST NOT BE. It is applied, its checksum is
-- registered in public.schema_migrations, and rewriting the text would make
-- `migration-status.mjs` report DRIFTED -- the one state that tooling exists
-- to catch. An applied migration records what was believed and done on the
-- day; it is not a document to keep current. So the correction lives HERE,
-- in the next file to touch the subject, and 0112's header should be read
-- with this one open.
--
-- ⚠️ WHAT 0112 GOT RIGHT IS UNAFFECTED, and it is nearly all of it. Counts
-- only, the >= 3 threshold, centroids rather than individuals, and
-- `nearby_models` staying revoked -- none of that depended on the false
-- premise. But the premise made the conclusion look SAFER than it was
-- ("nobody could act on this anyway") when the real argument is simply that
-- a directory is more exposure than the question needs. A conclusion that
-- survives its own reasoning does so by luck, which is why this retraction is
-- written out rather than noted in a line.
--
-- ⚠️ THE CLAIM WAS COPIED INTO THREE LIVE FILES, all written 23 Nov 2026 and
-- all corrected the same day: `site/lib/queries/demand.ts`,
-- `site/components/ModelDemandPanel.tsx` and
-- `site/app/(app)/dashboard/page.tsx`. A wrong sentence that gets quoted is
-- how a premise becomes a fact nobody rechecks.
-- ===========================================================================
--
-- ── WHAT A UNIQUE CONSTRAINT IS FOR HERE ──────────────────────────────────
-- "One invite per stylist per model, ever." Not one per day. The old path
-- could send eight to the same person, and did. A unique index means the
-- second one cannot exist even if every application check is bypassed, every
-- caller is wrong, and someone runs an insert by hand.
--
-- ── WHY `invites` AND NOT JUST A NOTIFICATION ─────────────────────────────
-- The live path writes a notification and nothing else, deliberately: "The
-- application IS the response... a parallel accept/decline would give two
-- ways to say yes and two things to keep in step."
--
-- ⚠️ THAT ARGUMENT IS SOUND AND IS BEING OVERRULED ON PURPOSE, so the reason
-- is recorded rather than lost. A notification cannot be unique, cannot be
-- declined, and cannot be counted — and "one ever" is unenforceable without a
-- row to conflict with. ACCEPTANCE IS STILL THE APPLICATION: `status` is
-- 'sent' or 'declined' and there is no 'accepted'. She says yes by applying,
-- exactly as before. The only thing added is a way to say no, and a record
-- that stops a ninth invite.
--
-- ── WHAT THE DIRECTORY FUNCTION IS, AND HOW IT DIFFERS FROM nearby_models ──
-- ⚠️ 0097 STANDS. `nearby_models` is untouched and `authenticated` still
-- cannot execute it. The verify block fails if that changes.
--
-- 0097 revoked it because it was a directory with no gate: any signed-in
-- account could enumerate 85 people's names, photos and physical attributes
-- by picking 'provider' at a free signup. `invitable_models` is the same kind
-- of query behind four things that function never had:
--
--   1. the caller must own a provider row that is `is_published`
--      AND passes `provider_shop_is_publishable` — a real shop with a name
--      and a treatment, not a role flag;
--   2. the model must have `discoverable` true;
--   3. neither party may have blocked the other;
--   4. neither may be suspended.
--
-- ⚠️ ALL FOUR ARE CHECKED INSIDE THE FUNCTION, NOT IN THE APP. A gate in a
-- React component is a gate on one caller. This one returns zero rows to a
-- stylist whose shop is not published, whatever the app asks it.
--
-- ⚠️ `is_published` ALONE WOULD NOT BE ENOUGH, which is why both are tested.
-- It is a column anyone's code can set; `provider_shop_is_publishable` is the
-- predicate the publish path itself uses. Measured today: 7 published shops,
-- 19 provider rows. The other 12 see nothing from this function.
--
-- ── MEASURED BEFORE CHOOSING THE DEFAULT RADIUS (23 Nov 2026) ─────────────
-- Models within N miles of each published shop, of 58 placed models:
--
--   shop                 5mi  10mi  15mi  20mi  30mi
--   Flowers Mobile         2     9    17    26    32
--   Mayera Aesthetics      0     1    14    22    34
--   Nadia                  0    11    28    30    33
--   Nhi @ SKINDUSTRY       2    15    20    28    34
--   Petra Pekarik          0     1     3    11    28
--   SimpliciTee            0     0     0     0     4
--   Taty Tint studio      11    19    28    30    33
--
-- ⚠️ 15 MILES IS THE BRIEF'S CHOICE AND 20 IS STRICTLY BETTER FOR THE TWO
-- WORST-OFF SHOPS — Petra goes 3 → 11 and nobody loses anything. SimpliciTee
-- sees nobody at either and is the argument for the filter being adjustable
-- rather than a cap. The default is a one-line change in lib/distance.ts; it
-- is written down here because a default nobody can see the data behind is a
-- number that never gets revisited.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0112') then
    raise exception '0113 needs 0112 applied first.';
  end if;

  -- Every function this one leans on. Named individually so a failure says
  -- which, rather than erroring inside a function body later.
  if to_regprocedure('public.provider_shop_is_publishable(uuid)') is null then
    raise exception '0113: provider_shop_is_publishable(uuid) is missing; the publication gate needs it.';
  end if;
  if to_regprocedure('public.is_blocked_pair(uuid, uuid)') is null then
    raise exception '0113: is_blocked_pair(uuid, uuid) is missing.';
  end if;
  if to_regprocedure('public.is_suspended(uuid)') is null then
    raise exception '0113: is_suspended(uuid) is missing.';
  end if;
  if to_regprocedure('public.banned_words_check(text)') is null then
    raise exception '0113: banned_words_check(text) is missing; the invite message is screened with it.';
  end if;

  -- ⚠️ THE ONE BEING REWRITTEN. If it is absent, the premise in the header is
  -- wrong and this migration should be re-read before it runs.
  if to_regprocedure('public.invite_model(uuid)') is null then
    raise exception '0113: invite_model(uuid) does not exist. This migration REPLACES a live '
      'function; if it is gone, read the header before running this.';
  end if;

  if to_regclass('public.notifications') is null then
    raise exception '0113: public.notifications is missing.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. Discoverability. Default TRUE, and that is a decision.
-- ---------------------------------------------------------------------------
-- ⚠️ DEFAULT TRUE MEANS EVERY EXISTING MODEL IS OPTED IN WITHOUT BEING ASKED.
-- The brief decided it ("models are discoverable by default and can turn it
-- off") and it is the only default that makes the feature exist on day one —
-- a directory everybody has to opt into is empty. It is recorded here because
-- it is the kind of default that should be re-read, not inherited: what is
-- exposed is first name, last initial, photo, approximate distance and the
-- look attributes, to stylists with a published shop, and nothing else.
alter table public.users
  add column if not exists discoverable boolean not null default true;

comment on column public.users.discoverable is
  'Model opt-out for stylist-to-model invites (0113). True means stylists with '
  'a published shop can see her in invitable_models and send ONE invite ever. '
  'Never exposes her email. Settings has the toggle.';

-- ---------------------------------------------------------------------------
-- 2. The invite record.
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid not null references public.providers(id) on delete cascade,
  model_user_id  uuid not null references public.users(id)     on delete cascade,
  -- The stylist's own words. Length is capped by a CHECK rather than only by
  -- a textarea, same rule as availability_note_len (0103).
  message        text,
  status         text not null default 'sent',
  created_at     timestamptz not null default now(),
  declined_at    timestamptz,

  -- ⚠️⚠️ THE WHOLE POINT. One invite per stylist per model, ever. The old path
  -- sent 8 to one person because nothing could stop it.
  constraint invites_one_per_pair unique (provider_id, model_user_id),

  constraint invites_status_known check (status in ('sent', 'declined')),
  -- ⚠️ NO 'accepted'. She accepts by APPLYING, which is the flow that already
  -- exists and already creates a session. A second way to say yes would be a
  -- second thing to keep in step with the first.
  constraint invites_message_len check (message is null or char_length(message) <= 500),
  constraint invites_declined_at_agrees
    check ((status = 'declined') = (declined_at is not null))
);

comment on table public.invites is
  'One stylist-to-model invite, at most one per pair ever (0113). status is '
  'sent|declined — there is no accepted, because applying IS the acceptance.';

create index if not exists invites_model_user_id_idx on public.invites (model_user_id, created_at desc);
create index if not exists invites_provider_id_idx   on public.invites (provider_id, created_at desc);

alter table public.invites enable row level security;

-- ⚠️⚠️ PRIVILEGES FIRST, THEN POLICIES. A policy decides WHICH ROWS a role may
-- touch; the GRANT decides whether it may touch the table at all, and without
-- one the policies below are decoration. The shape copies public.notifications
-- exactly — authenticated gets select and update and NOT insert — because the
-- same rule applies for the same reason: rows come only from a SECURITY
-- DEFINER function, so the publication, block, suspension and discoverability
-- gates cannot be walked around by writing the row directly.
revoke all on public.invites from anon, authenticated;
grant select, update on public.invites to authenticated;

-- ── Who can read an invite ────────────────────────────────────────────────
-- ⚠️ NO INSERT POLICY, AND THAT IS THE DESIGN. Rows are written only by
-- invite_model(), which is SECURITY DEFINER and therefore not subject to
-- these policies. A stylist cannot insert one directly, so she cannot skip
-- the publication, block, suspension or discoverability checks by writing the
-- row herself.
drop policy if exists "stylist reads own sent invites" on public.invites;
create policy "stylist reads own sent invites"
  on public.invites for select to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = invites.provider_id and p.user_id = auth.uid()
  ));

drop policy if exists "model reads invites sent to her" on public.invites;
create policy "model reads invites sent to her"
  on public.invites for select to authenticated
  using (model_user_id = auth.uid());

-- ── Declining ─────────────────────────────────────────────────────────────
-- ⚠️ THE MODEL AND ONLY THE MODEL, AND ONLY INTO 'declined'. The WITH CHECK
-- pins the destination state: without it this policy would let her set any
-- value the CHECK constraint allows, including back to 'sent'.
drop policy if exists "model declines her own invite" on public.invites;
create policy "model declines her own invite"
  on public.invites for update to authenticated
  using (model_user_id = auth.uid())
  with check (model_user_id = auth.uid() and status = 'declined');

-- ---------------------------------------------------------------------------
-- 3. Who a stylist may invite.
-- ---------------------------------------------------------------------------
create or replace function public.invitable_models(
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_radius_mi double precision default null
)
returns table (
  id              uuid,
  first_name      text,
  last_initial    text,
  profile_pic_url text,
  distance_mi     double precision,
  hair_colour     text,
  hair_type       text,
  hair_length     text,
  hair_condition  text,
  skin_tone       text,
  skin_type       text,
  eye_colour      text,
  eye_shape       text,
  nail_condition  text,
  bio             text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with me as (
    -- ⚠️⚠️ THE GATE, AND IT IS THE FIRST THING THE QUERY DOES. An empty `me`
    -- makes the join below return zero rows, so a caller without a PUBLISHED
    -- shop gets an empty list rather than a filtered one. is_published AND
    -- provider_shop_is_publishable: the column is settable, the predicate is
    -- what the publish path itself asks.
    select p.id
    from public.providers p
    where p.user_id = auth.uid()
      and p.is_published is true
      and public.provider_shop_is_publishable(p.id)
    limit 1
  )
  select
    u.id, u.first_name, u.last_initial, u.profile_pic_url,
    dist.d as distance_mi,
    ma.hair_colour, ma.hair_type, ma.hair_length, ma.hair_condition,
    ma.skin_tone, ma.skin_type, ma.eye_colour, ma.eye_shape,
    ma.nail_condition, ma.bio
  from me
  cross join public.users u
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
    and u.discoverable is true
    and u.id <> auth.uid()
    -- ⚠️ SAME RADIUS RULE AS nearby_models, deliberately: null means no
    -- distance filter at all, and any number returns ONLY models with a
    -- computed distance. A stylist we cannot place who asks for 15 miles gets
    -- nothing, which is honest — we cannot say who is within 15 miles of an
    -- unknown point. The app offers "Any distance" for exactly that case.
    and (
      p_radius_mi is null
      or (dist.d is not null and dist.d <= p_radius_mi)
    )
    and not public.is_blocked_pair(auth.uid(), u.id)
    and not public.is_suspended(u.id)
    -- Already invited drops out: one per pair, ever, so a second card would
    -- be a button that cannot work.
    and not exists (
      select 1 from public.invites i
      where i.provider_id = me.id and i.model_user_id = u.id
    )
  order by dist.d asc nulls last, u.created_at desc nulls last, u.id
  limit 200;
$function$;

grant execute on function public.invitable_models(double precision, double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sending one. THIS REPLACES A LIVE FUNCTION.
-- ---------------------------------------------------------------------------
-- ⚠️ DROPPED AND RECREATED, NOT `create or replace`. The signature gains a
-- message, and in Postgres a different argument list is a DIFFERENT function
-- — `create or replace` would leave TWO overloads and make the existing
-- one-argument call from mobile ambiguous. That is the shape 0112's header
-- warns about with model_may_apply, which is live on two signatures right now.
--
-- The new second argument has a DEFAULT, so the existing one-argument callers
-- (salon-floor/actions.ts, mobile's model profile) keep working unchanged and
-- send an invite with no message.
drop function if exists public.invite_model(uuid);

create or replace function public.invite_model(
  p_model_user_id uuid,
  p_message       text default null
)
returns public.invites
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_provider uuid;
  v_name     text;
  v_msg      text := nullif(btrim(coalesce(p_message, '')), '');
  v_row      public.invites;
  v_screen   text;
begin
  -- ⚠️ PUBLISHED, NOT MERELY A PROVIDER ROW. The old version asked only
  -- "is there a providers row for auth.uid()" — which is the self-selected
  -- role flag wearing a different hat, since a free signup picks it.
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider, v_name
    from public.providers p
   where p.user_id = auth.uid()
     and p.is_published is true
     and public.provider_shop_is_publishable(p.id);

  if v_provider is null then
    raise exception 'invite_model: your shop has to be published before you can invite anyone'
      using errcode = '42501';
  end if;

  if p_model_user_id is null or p_model_user_id = auth.uid() then
    raise exception 'invite_model: that is your own account'
      using errcode = '22023';
  end if;

  if v_msg is not null and char_length(v_msg) > 500 then
    raise exception 'invite_model: that message is too long'
      using errcode = '22001';
  end if;

  -- ⚠️ EVERY REFUSAL BELOW CARRIES ITS OWN SQLSTATE, because the caller maps
  -- on the code and not on the message text — the rule salon-floor/actions.ts
  -- already follows, written down there in full.
  if not exists (
    select 1 from public.users u
    where u.id = p_model_user_id and u.role = 'model' and u.discoverable is true
  ) then
    -- ⚠️ ONE CODE FOR "not a model" AND "not discoverable", ON PURPOSE. The
    -- caller must not be able to tell a stylist which — that would turn the
    -- opt-out into a way of confirming an account exists.
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  if public.is_blocked_pair(auth.uid(), p_model_user_id) then
    -- Same wording as above, same reason: a block must not be discoverable by
    -- probing. The old function did not check blocks at all.
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  if public.is_suspended(p_model_user_id) then
    raise exception 'invite_model: that member cannot be invited'
      using errcode = '42501';
  end if;

  -- ⚠⚠ THE MESSAGE IS SCREENED HERE, NOT IN THE APP, and it has to be: the
  -- screening function is SECURITY DEFINER and `authenticated` CANNOT EXECUTE
  -- IT. Doing this in a server action would have meant either granting the
  -- door open or keeping a second copy of the word list in TypeScript. This
  -- function already runs as owner, so it can simply ask.
  --
  -- ⚠️ 'unscreenable' HOLDS, IT DOES NOT PASS. That is 0032's rule, quoted in
  -- banned_word_hit: "A screen that cannot read its list and approves anyway
  -- is a success signal that does not depend on the thing it claims to
  -- prove." A missing or malformed banned_words row stops invites carrying a
  -- message rather than waving them through.
  if v_msg is not null then
    v_screen := public.banned_words_check(v_msg);
    if v_screen is distinct from 'clean' then
      if v_screen = 'unscreenable' then
        raise exception 'invite_model: messages cannot be checked right now, so nothing was sent'
          using errcode = '55000';
      end if;
      raise exception 'invite_model: that message cannot be sent'
        using errcode = '23514';
    end if;
  end if;

  -- ⚠️ THE INSERT IS THE RATE LIMIT. A unique violation here is the second
  -- invite being refused by the database, not by a check that can be skipped.
  begin
    insert into public.invites (provider_id, model_user_id, message)
    values (v_provider, p_model_user_id, v_msg)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'invite_model: you have already invited this member'
      using errcode = '23505';
  end;

  -- The notification, unchanged in shape from the function this replaces:
  -- same type, same data key, so notify_email, run_email_reconcile, copyFor
  -- and mobile's routeForNotification all keep working without being touched.
  --
  -- ⚠️ THE MESSAGE GOES IN `data`, NOT IN `body`. The body is the sentence
  -- Cavy says; the message is the stylist's and is rendered as hers, quoted,
  -- by whoever shows it. Merging them would make her words look like ours.
  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_model_user_id,
    'stylist_invite',
    v_name || ' would like to invite you for an appointment',
    'Open their shop to see what they do and when they are free.',
    jsonb_build_object(
      'provider_id', v_provider,
      'invite_id',   v_row.id,
      'message',     v_msg
    )
  );

  return v_row;
end
$function$;

grant execute on function public.invite_model(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_n    int;
  v_cols text;
begin
  -- (a) discoverable exists, is NOT NULL, defaults true.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='users' and column_name='discoverable'
       and is_nullable = 'NO' and column_default like '%true%'
  ) then
    raise exception '0113: users.discoverable is missing, nullable, or does not default true. Rolled back.';
  end if;

  -- (b) EVERY existing user is discoverable. A default only governs new rows;
  --     if the column were added differently, some would be null-turned-false
  --     and those models would be invisible without ever choosing it.
  if exists (select 1 from public.users where discoverable is not true) then
    raise exception '0113: some users are not discoverable immediately after adding the column. Rolled back.';
  end if;

  -- (c) ⚠️ THE UNIQUE CONSTRAINT EXISTS. This is the one guarantee the whole
  --     "one ever" rule rests on, and it must not be only an index name.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invites'::regclass
       and contype = 'u'
       and conname = 'invites_one_per_pair'
  ) then
    raise exception '0113: invites_one_per_pair unique constraint is missing. Rolled back.';
  end if;

  -- (d) RLS on, and exactly the three policies intended — no INSERT policy.
  if not exists (
    select 1 from pg_class where oid = 'public.invites'::regclass and relrowsecurity
  ) then
    raise exception '0113: RLS is not enabled on public.invites. Rolled back.';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname='public' and tablename='invites';
  if v_n <> 3 then
    raise exception '0113: expected 3 policies on invites, found %. Rolled back.', v_n;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='invites' and cmd = 'INSERT'
  ) then
    raise exception '0113: an INSERT policy exists on invites. Rows must come only from '
      'invite_model(), or the publication and block gates can be walked around. Rolled back.';
  end if;

  -- ⚠️ AND THE PRIVILEGE IS ABSENT TOO, not just the policy. Either one alone
  -- would stop a direct insert; asserting both is what makes it a posture
  -- rather than an accident of which was remembered.
  if has_table_privilege('authenticated', 'public.invites', 'INSERT') then
    raise exception '0113: authenticated holds INSERT on public.invites. Rows must come only '
      'from invite_model(). Rolled back.';
  end if;
  if not has_table_privilege('authenticated', 'public.invites', 'SELECT')
     or not has_table_privilege('authenticated', 'public.invites', 'UPDATE') then
    raise exception '0113: authenticated is missing SELECT or UPDATE on public.invites, so the '
      'policies above govern nothing and a model could not decline. Rolled back.';
  end if;

  -- (e) invitable_models: exactly one, SECURITY DEFINER, callable.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='invitable_models';
  if v_n <> 1 then
    raise exception '0113: expected exactly 1 invitable_models, found %. Rolled back.', v_n;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='invitable_models' and p.prosecdef
  ) then
    raise exception '0113: invitable_models is not SECURITY DEFINER. Rolled back.';
  end if;
  if not has_function_privilege('authenticated',
       'public.invitable_models(double precision, double precision, double precision)', 'EXECUTE') then
    raise exception '0113: authenticated cannot execute invitable_models. Rolled back.';
  end if;

  -- (f) ⚠️ IT RETURNS NO EMAIL ADDRESS. The column list is fixed, so a later
  --     edit that adds one trips here rather than in production.
  select string_agg(a.attname, ', ' order by a.attnum) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, attmode, attnum)
      on a.attmode = 't'
   where n.nspname='public' and p.proname='invitable_models';
  if v_cols ilike '%email%' or v_cols ilike '%phone%' or v_cols ilike '%postcode%'
     or v_cols ilike '%latitude%' or v_cols ilike '%longitude%' then
    raise exception '0113: invitable_models returns a contact or location column: %. '
      'It returns a distance, never a point. Rolled back.', v_cols;
  end if;

  -- (g) ⚠️⚠️ invite_model EXISTS ON EXACTLY ONE SIGNATURE. The drop-then-create
  --     above is what prevents the two-overload state that model_may_apply is
  --     in; if both survived, mobile's one-argument call would be ambiguous.
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='invite_model';
  if v_n <> 1 then
    raise exception '0113: invite_model exists on % signatures; it must be exactly 1, or the '
      'existing one-argument callers become ambiguous. Rolled back.', v_n;
  end if;
  if not has_function_privilege('authenticated',
       'public.invite_model(uuid, text)', 'EXECUTE') then
    raise exception '0113: authenticated cannot execute invite_model(uuid, text). Rolled back.';
  end if;

  -- (h) ⚠️⚠️ 0097 IS UNTOUCHED. This file adds a gated directory; it must not
  --     have reopened the ungated one.
  if has_function_privilege('authenticated',
       'public.nearby_models(double precision, double precision, double precision)', 'EXECUTE') then
    raise exception '0113: authenticated can execute nearby_models — 0097 revoked that and this '
      'migration must not restore it. Rolled back.';
  end if;

  -- (i) The email path still recognises the type this writes. If the trigger
  --     ever stops listing stylist_invite, the invite becomes in-app only and
  --     nothing would say so.
  if not exists (
    select 1 from pg_trigger t
     where t.tgname = 'notify_email' and not t.tgisinternal
       and pg_get_triggerdef(t.oid) like '%stylist_invite%'
  ) then
    raise exception '0113: the notify_email trigger no longer lists stylist_invite, so an invite '
      'would never reach an inbox. Rolled back.';
  end if;

  raise notice '0113: invites table, discoverable flag, invitable_models, and a REWRITTEN '
    'invite_model. % published shop(s) can now invite; every other provider row sees nothing. '
    'The 8 invites already sent predate the invites table and have no row — see the header.',
    (select count(*) from public.providers where is_published);
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0113', 'an_invite_is_a_record_not_a_notification', 'c353ea0ee48258402b6e329021562bbf9fc929df3718780012e4794e60ad006f');

commit;

notify pgrst, 'reload schema';

-- ⚠️ WHAT THIS DOES NOT DO, AND SOMEBODY SHOULD DECIDE IT:
-- The 8 invites already sent exist only as notifications. They get no
-- `invites` row, so those stylists can each send one more to the same model —
-- the "one ever" rule starts from today rather than from the beginning.
-- Backfilling them is possible (notifications.data->>'provider_id' carries the
-- stylist) but it would manufacture records of invites that were sent under
-- different rules, with no message and no real created_at semantics. Left
-- undone on purpose; 1 model is affected.
--
-- ⚠️ TO UNDO: drop function public.invitable_models(double precision, double
-- precision, double precision); drop table public.invites; alter table
-- public.users drop column discoverable; then RESTORE the previous
-- invite_model from 0081 — do not simply drop it, because salon-floor and
-- mobile both call it and would break. Delete the '0113' row last.
