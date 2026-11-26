-- ===========================================================================
-- 0116_new_times_reach_more_than_three_people
--
-- `new_availability` keeps its one definition and gains an audience: the
-- models who favourited a shop, PLUS every model within ten miles of a
-- published one. Debounced once per stylist per model per day, in the
-- database. And emailed, which it has never been.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────
-- The notice already works. `notify_favourites_of_availability` has written
-- 82 of them, the last on 6 Oct 2026. It has been quiet since because
-- `favourites` holds THREE rows — so the mechanism is sound and the audience
-- is the whole problem. Nothing here builds a second path; the existing
-- function becomes a one-line delegate and the audience moves into a
-- function of its own.
--
-- ⚠️ ONE OF THOSE THREE FAVOURITE ROWS IS A STYLIST'S OWN SHOP. Micky B
-- (ff06d568…, role 'provider') favourited provider 49d40aae…, which is his.
-- The old function has no `u.id <> auth.uid()` line, so posting times sends
-- him a notification about his own post. Measured, not supposed. The new
-- audience excludes the owner, the suspended and either side of a block —
-- none of which the favourites arm checked before today.
--
-- ── MEASURED BEFORE WRITING (26 Nov 2026) ─────────────────────────────────
-- 88 models. 59 placed, 29 with no coordinates at all.
-- 9 published shops, all 9 placed and publishable.
--
--   shop                 favourited   within 10mi   audience
--   Taty Tint studio          1            20          21
--   Nhi @ SKINDUSTRY          1            15          15
--   Nadia                     0            11          11
--   Flowers Mobile            0             9           9
--   Your Skin Club            0             2           2
--   Amal Almeshal             0             1           1
--   Mayera Aesthetics         0             1           1
--   Petra Pekarik             0             1           1
--   SimpliciTee               0             0           0
--
-- ⚠️ TATY TINT'S 21 IS 20 + 1, AND NHI'S 15 IS 15. Nhi's favouriter is also
-- within ten miles and is counted once; Taty Tint's is not and is counted
-- anyway. That is the deduplication doing its job in both directions, and it
-- is why the audience is a SET OF USERS rather than two lists appended.
--
-- ⚠️⚠️ AND TODAY IT WOULD REACH THREE PEOPLE, NOT SIXTY. Of those nine
-- published shops only TWO have a single bookable future slot — Your Skin
-- Club (5) and Amal Almeshal (2). Taty Tint, with the largest audience in
-- the product, has none. The numbers above are what each stylist reaches
-- WHEN SHE POSTS, not what is waiting to be sent. Said out loud because a
-- feature measured by its audience and shipped into an empty diary looks
-- like it failed.
--
-- ── THE 29 MODELS WITH NO COORDINATES GET NOTHING ─────────────────────────
-- A distance rule cannot place them, and that is not a bug to work around:
-- there is no honest way to say somebody is within ten miles of a point we
-- do not know. They are reachable today only by favouriting a shop, and one
-- of them has (c491b5a6…, who favourited Taty Tint). The fix for the other
-- 28 is a postcode, not a looser rule.
--
-- ── ⚠️ WHAT IS NOT IN THIS FILE, AND MUST LAND FIRST ──────────────────────
-- The EMAIL COPY LIVES IN THE EDGE FUNCTION, NOT HERE. `copyFor()` in
-- supabase/functions/send-email/index.ts needs a `new_availability` case, and
-- until that build is DEPLOYED this migration sends real models an email
-- subject-lined "Something happened on Cavy" — the default branch. So:
--
--   1. npx supabase functions deploy send-email --no-verify-jwt
--   2. then apply this.
--
-- There is no way for SQL to check that the deployed bundle has the case, so
-- this is an ordering instruction and not a precondition. It is the one part
-- of this change a migration cannot protect.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run on a database this was not written against.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if not exists (select 1 from public.schema_migrations where version = '0115') then
    raise exception '0116 needs 0115 applied first.';
  end if;

  -- The function being extended. If it has gone, the premise of this file has
  -- gone with it.
  if to_regprocedure('public.notify_favourites_of_availability()') is null then
    raise exception '0116: notify_favourites_of_availability() is missing. This migration '
      'extends it; read the header before running this.';
  end if;

  -- Everything the audience is built out of.
  if to_regprocedure('public.is_blocked_pair(uuid,uuid)') is null
     or to_regprocedure('public.is_suspended(uuid)') is null
     or to_regprocedure('public.provider_shop_is_publishable(uuid)') is null
     or to_regprocedure('public.slot_contention(uuid)') is null then
    raise exception '0116: one of is_blocked_pair, is_suspended, '
      'provider_shop_is_publishable or slot_contention is missing.';
  end if;

  -- ⚠️ THE DISTANCE RULE READS providers.latitude/longitude, NOT users'. A
  -- stylist's shop is the origin; the model is the point being measured.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='providers'
       and column_name in ('latitude','longitude')
    having count(*) = 2
  ) then
    raise exception '0116: providers.latitude/longitude are missing, so there is no origin '
      'to measure from.';
  end if;

  if to_regclass('public.favourites') is null then
    raise exception '0116: public.favourites is missing.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 1. The debounce, as a ledger rather than as application code.
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ THE KEY IS (provider_id, model_user_id, notified_on), AND THE DATE IS
-- GENERATED RATHER THAN PASSED. This is `invites_one_per_day` (0114) applied
-- to a second problem, deliberately down to the column name: a stored
-- generated column whose expression is `created_at` in Europe/London, and a
-- UNIQUE constraint across it. A caller cannot choose the date, so a caller
-- cannot choose to be let through twice.
--
-- ⚠️ WHY A LEDGER AND NOT A UNIQUE INDEX ON `notifications`. Three reasons,
-- in order of weight:
--
--   1. `notifications` is a general table with 14 other types in it, and the
--      debounce key involves `data->>'provider_id'` — a jsonb reach. A
--      generated column on a shared table, for one type's benefit, makes
--      every other type's inserts carry it.
--   2. A member can DELETE her own notifications. A debounce that lives in
--      the rows being debounced is a debounce she can clear by tidying her
--      list, and she would then be re-notified about the same slots.
--   3. The ledger is the thing the INSERT ... ON CONFLICT claims, so the
--      decision of who gets a notice is made by the constraint BEFORE any
--      notification row exists. Nothing is written and then withdrawn.
--
-- ⚠️ THE ONLY WRITER IS notify_models_of_availability. Nothing reads this
-- table from the app, which is why RLS is enabled with no policies at all and
-- the Supabase default grants are revoked below. An empty-policy table under
-- RLS is closed; a table with grants and no RLS is wide open, and Supabase's
-- default privileges hand `authenticated` every table in this schema.
create table if not exists public.availability_notices (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  model_user_id uuid not null references public.users(id)     on delete cascade,
  created_at    timestamptz not null default now(),
  notified_on   date generated always as
                  (((created_at at time zone 'Europe/London'))::date) stored,
  constraint availability_notices_one_per_day
    unique (provider_id, model_user_id, notified_on)
);

comment on table public.availability_notices is
  'One row per (stylist, model, London day) that a new_availability notice was '
  'sent for (0116). It exists ONLY to be the thing ON CONFLICT collides with, '
  'so the once-a-day rule is enforced by a constraint rather than by a count in '
  'TypeScript. Written by notify_models_of_availability, read by nothing, '
  'pruned past 30 days by that same function.';

alter table public.availability_notices enable row level security;

-- No policies. Deliberate: see the table comment. The revoke is belt and
-- braces against Supabase's `alter default privileges … grant all on tables
-- to anon, authenticated`, which would otherwise have handed this out.
revoke all on public.availability_notices from anon, authenticated;

create index if not exists availability_notices_prune_idx
  on public.availability_notices (notified_on);

-- ---------------------------------------------------------------------------
-- 2. The audience. ONE definition, and not a member-callable one.
-- ---------------------------------------------------------------------------
-- ⚠️ IT TAKES A PROVIDER ID, WHICH 0075 REFUSED TO DO — and the difference is
-- the whole reason it is safe. 0075's argument was that `p_provider_id` on a
-- WRITING function would let any signed-in account write notifications to
-- everyone who favourited any shop. This function writes nothing; it answers
-- "who is in range of this shop", which is still not a question a member may
-- ask — it would name her neighbours — so EXECUTE is revoked from everyone.
-- The notifier is owned by the same role and reaches it that way.
--
-- ⚠️ IT EXISTS SEPARATELY SO THE VERIFY BLOCK CAN EXERCISE IT. The notifier
-- derives its provider from auth.uid(), and a migration has no JWT, so the
-- notifier CANNOT be called from the verify block at the bottom of this file
-- — it would return 0 every time and prove nothing. Splitting the audience
-- out means the part with the arithmetic in it is measured against real rows.
--
-- ⚠️ ONE ROW PER USER, BY STRUCTURE AND NOT BY `distinct`. The favourite test
-- and the distance test are both lateral scalars hanging off a single scan of
-- `users`, so a model who is both appears once because she IS one row. A
-- UNION of two selects would need a DISTINCT to get the same answer, and a
-- DISTINCT is a thing somebody later deletes.
create or replace function public.availability_notice_audience(p_provider_id uuid)
returns table (model_user_id uuid, by_favourite boolean, by_distance boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select u.id, f.fav, d.near
    from public.providers p
    cross join public.users u
    cross join lateral (
      select exists (
        select 1 from public.favourites fv
         where fv.provider_id = p.id and fv.user_id = u.id
      ) as fav
    ) f
    cross join lateral (
      select (
        -- ⚠️ THE DISTANCE ARM REQUIRES A REAL PUBLISHED SHOP, THE FAVOURITE
        -- ARM DOES NOT, and that asymmetry is chosen. A favourite is a model
        -- asking to be told; she asked, so she is told, exactly as she is
        -- today. Distance is US deciding to tell a stranger, and the bar for
        -- that is the one invitable_models already sets: is_published AND
        -- provider_shop_is_publishable, because is_published alone is a
        -- column anybody's code can set.
        p.is_published is true
        and public.provider_shop_is_publishable(p.id)
        and u.role = 'model'
        and p.latitude is not null and p.longitude is not null
        and u.latitude is not null and u.longitude is not null
        -- Ten miles. ⚠️ THE NUMBER LIVES HERE AND NOWHERE ELSE — the notifier
        -- does not know it, so there is no second copy to disagree. Same
        -- great-circle expression as nearby_models and invitable_models,
        -- clamped with greatest/least because acos() of 1.0000000000000002 is
        -- a 22003, not a rounding error.
        and 3959 * acos(greatest(-1.0, least(1.0,
              cos(radians(p.latitude)) * cos(radians(u.latitude)) *
              cos(radians(u.longitude) - radians(p.longitude)) +
              sin(radians(p.latitude)) * sin(radians(u.latitude))
            ))) <= 10
      ) as near
    ) d
   where p.id = p_provider_id
     -- ⚠️ THE OWNER IS EXCLUDED BY HER OWN provider ROW, not by auth.uid().
     -- It is the same person either way when the app calls this, and it is
     -- the only one of the two that is true when the verify block calls it.
     and u.id <> p.user_id
     and (f.fav or d.near)
     and not public.is_suspended(u.id)
     and not public.is_blocked_pair(p.user_id, u.id);
$function$;

comment on function public.availability_notice_audience(uuid) is
  'Who should be told that this shop posted times (0116): favourited OR within '
  '10 miles of a published, publishable shop; never the owner, the suspended, '
  'or either side of a block. ⚠️ NOT GRANTED TO anyone — it would name a '
  'member''s neighbours. Only notify_models_of_availability calls it.';

revoke all on function public.availability_notice_audience(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The notice itself.
-- ---------------------------------------------------------------------------
-- ⚠️ IT STILL DERIVES THE STYLIST FROM auth.uid(). That is 0075's property and
-- it is kept: there is nothing to pass, so there is nothing to pass wrongly.
--
-- ⚠️ p_slot_ids IS NOT A SECOND WAY IN. It only ever NARROWS a set that is
-- already filtered to `provider_id = <mine>`, so ids belonging to another
-- stylist match nothing and the function sends nothing. Passing null means
-- "describe every open future slot I have", which is what the dormant mobile
-- caller gets through the delegate below.
--
-- ── WHAT GOES IN THE BODY, AND WHAT MUST NEVER ────────────────────────────
-- Per slot: the treatment, the day and start time, and the price. Nothing
-- about the recipient, nobody else's name, and no hint of who else was told —
-- every recipient gets the same text, which is the simplest way to guarantee
-- that.
--
-- ⚠️ £0 IS "Free", NOT "£0.00", matching formatPrice() in site/lib/price.ts
-- and mobile's copy of it. A slot whose price is NULL renders with no price at
-- all rather than as free: 67 rows predate the requirement and nobody decides
-- on a stylist's behalf what they cost. Prices have been mandatory on new
-- slots since b6475fc, so this branch is for history only.
--
-- ── WHICH SLOTS COUNT AS POSTED ───────────────────────────────────────────
-- ⚠️ THE SAME FOUR FILTERS THE APPLY PANEL USES, because a notice listing a
-- slot she cannot apply for is worse than no notice. lib/queries/slots.ts
-- names them: is_taken, already started, contended, and no treatment.
--
--   * CONTENTION IS slot_contention(), CALLED. 0090's header forbids a second
--     implementation of "bookable" and this is not going to be it.
--   * NO TREATMENT MEANS NOT LISTED, not "listed with a blank". 29 of the 86
--     availability rows have an empty active_treatments, and the apply wizard
--     drops those entirely (`blockedBy !== 'no_treatment'`). A notice is a
--     louder version of that panel, so it obeys the same rule.
create or replace function public.notify_models_of_availability(p_slot_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Five lines, then "and N more." ⚠️ A CAP IS NOT A STYLE CHOICE HERE: this
  -- goes out by email, and a stylist who opens a whole month in one save
  -- would otherwise send thirty-line mail to twenty people.
  c_list_cap constant integer := 5;

  v_provider_id uuid;
  v_name        text;
  v_total       integer;
  v_list        text;
  v_body        text;
  v_count       integer;
begin
  select p.id, coalesce(nullif(btrim(p.name), ''), 'A stylist')
    into v_provider_id, v_name
    from public.providers p
   where p.user_id = auth.uid();

  if v_provider_id is null then
    return 0;
  end if;

  with contention as (
    select * from public.slot_contention(v_provider_id)
  ),
  open_slots as (
    select a.id, a.date, a.start_time, a.price_pence, a.active_treatments
      from public.availability a
      left join contention c on c.availability_id = a.id
     where a.provider_id = v_provider_id
       and (p_slot_ids is null or a.id = any (p_slot_ids))
       and a.is_taken is not true
       and coalesce(c.contested, false) is false
       and coalesce(array_length(a.active_treatments, 1), 0) > 0
       and ((a.date + a.start_time) at time zone 'Europe/London') > now()
  ),
  described as (
    select row_number() over (order by s.date, s.start_time, s.id) as rn,
           to_char(s.date, 'Dy FMDD Mon')
           || ', ' || to_char(s.start_time, 'FMHH12:MIam')
           || ' — ' || t.label
           || case
                when s.price_pence is null       then ''
                when s.price_pence = 0           then ', Free'
                when s.price_pence % 100 = 0     then ', £' || (s.price_pence / 100)::text
                else ', £' || to_char(s.price_pence / 100.0, 'FM999990.00')
              end as line
      from open_slots s
      cross join lateral (
        -- `name ?? category`, the rule treatmentLabel() applies in the app and
        -- _withdraw_stylist applies in SQL. provider_treatments.name is
        -- nullable, so taking it straight would print an empty label.
        select coalesce(
                 string_agg(
                   coalesce(nullif(btrim(pt.name), ''), nullif(btrim(pt.category), '')),
                   ', ' order by pt.name),
                 'An appointment') as label
          from public.provider_treatments pt
         where pt.id = any (s.active_treatments)
      ) t
  )
  select count(*)::integer,
         string_agg(d.line, E'\n' order by d.rn) filter (where d.rn <= c_list_cap)
    into v_total, v_list
    from described d;

  -- ⚠️ NOTHING TO SHOW MEANS NOTHING IS SENT, and this is a real branch rather
  -- than a guard against an impossible state. `saveDay` is called on every
  -- edit of a day — a price change, a note, a deletion — and the action calls
  -- this whenever the day ends up with slots in it, not only when slots were
  -- added. A save that leaves nothing bookable must not announce itself.
  if coalesce(v_total, 0) = 0 then
    return 0;
  end if;

  v_body := v_list;
  if v_total > c_list_cap then
    v_body := v_body || E'\n' || 'and ' || (v_total - c_list_cap)::text || ' more.';
  end if;

  -- ⚠️⚠️ THE LEDGER DECIDES, IN THE SAME STATEMENT. `claimed` is a
  -- data-modifying CTE: the ON CONFLICT runs first, and only the pairs it
  -- actually inserted come back from RETURNING to be notified. Two saves a
  -- minute apart therefore produce one notice without anything counting
  -- anything, and without a window between the check and the write.
  with claimed as (
    insert into public.availability_notices (provider_id, model_user_id)
    select v_provider_id, a.model_user_id
      from public.availability_notice_audience(v_provider_id) a
    on conflict on constraint availability_notices_one_per_day do nothing
    returning model_user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select c.model_user_id,
         'new_availability',
         -- ⚠️ THE SHOP NAME IS AT THE END OF THE TITLE, AND THE TITLE IS THE
         -- EMAIL SUBJECT. Same reasoning as stylist_invite in send-email:
         -- providers.name is text a stylist chooses, so a subject that LED
         -- with it could be made to read as a message from us. "New times at
         -- …" puts our words first, whatever follows.
         'New times at ' || v_name,
         v_body,
         -- ⚠️ provider_id IS THE WHOLE REASON THE ROW IS TAPPABLE. Item 143
         -- was 54 days of this field being absent while the body said "tap to
         -- view their shop". Both clients route on it.
         jsonb_build_object('provider_id', v_provider_id)
    from claimed c;

  get diagnostics v_count = row_count;

  -- A row older than a month cannot debounce anything. Pruned here, the way
  -- run_email_reconcile prunes email_sends, so there is no second job to
  -- forget about.
  delete from public.availability_notices where notified_on < current_date - 30;

  return v_count;
end
$function$;

comment on function public.notify_models_of_availability(uuid[]) is
  'Writes one new_availability notification per model in '
  'availability_notice_audience() for the CALLING stylist, at most one per '
  'model per London day (availability_notices_one_per_day). Body lists each '
  'bookable slot: treatment, day and time, price, £0 as "Free", capped at 5 '
  'with "and N more." Returns how many were written. Takes no provider — it is '
  'auth.uid()''s.';

grant execute on function public.notify_models_of_availability(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The old name, kept as a delegate.
-- ---------------------------------------------------------------------------
-- ⚠️ NOT DROPPED, BECAUSE SOMETHING STILL CALLS IT. Two callers:
-- site/lib/availability.ts (LIVE) moves to the new name in this change;
-- mobile/src/lib/availability.ts:371 (DORMANT — mobile is mothballed, never
-- published to either store) does not and will not be touched. Dropping this
-- would leave the dormant app with a call that 42883s the day anybody picks
-- it back up, to save one line.
--
-- It is a one-line delegate in the shape model_may_apply() already uses here.
-- The name is now a slight lie — it reaches more than favourites — which is
-- precisely why the live caller stops using it.
create or replace function public.notify_favourites_of_availability()
returns integer
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.notify_models_of_availability(null);
$function$;

comment on function public.notify_favourites_of_availability() is
  'DELEGATE (0116). Calls notify_models_of_availability(null), which now also '
  'reaches models within 10 miles. Kept only for the dormant mobile caller '
  '(mobile/src/lib/availability.ts); site/ calls the new name directly.';

grant execute on function public.notify_favourites_of_availability() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. It emails now. Both lists, because they are copies of one list.
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ new_availability WAS EXCLUDED FROM EMAIL ON PURPOSE IN 0047 — "a mass
-- send, one per favouriter, so an email each is an interruption per stylist
-- post". That premise is being overturned, not forgotten, and here is why it
-- no longer holds:
--
--   * The interruption 0047 feared was PER POST. The debounce in part 1 makes
--     it per stylist per DAY, which did not exist when 0047 was written.
--   * "A mass send" meant unbounded. It is now bounded and measured: the
--     largest audience in the product is 21, and 60 notices would be sent if
--     all nine published shops posted on the same day.
--   * And the type had an audience of three. The reason to be careful about
--     volume is the reason this change exists.
--
-- ⚠️ THERE ARE FOUR COPIES OF THIS LIST AND ONLY TWO ARE IN SQL. The other
-- two are copyFor() in the send-email edge function and the NOT_EMAILED table
-- in scripts/check-email-type-coverage.mjs, which fails the build when the
-- four disagree. Both are changed in the same commit as this file; the edge
-- function also has to be DEPLOYED, which no commit does. See the header.
drop trigger if exists notify_email on public.notifications;
create trigger notify_email
  after insert on public.notifications
  for each row
  when (new.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired',
                     'session_not_held', 'stylist_invite', 'admin_message',
                     'admin_broadcast', 'shop_favourited',
                     'new_availability'))
  execute function public.tg_notify_email();

-- ⚠️ MUST MATCH THE TRIGGER'S WHEN CLAUSE. A type emailed and not reconciled
-- is a type whose failures are invisible — item 135, which ran for seven
-- migrations. The body below is the live definition read from
-- pg_get_functiondef on 26 Nov 2026 with one string added, not a rewrite.
create or replace function public.run_email_reconcile(p_hours integer default 24)
returns public.email_reconcile_runs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.email_reconcile_runs;
  v_since timestamptz := now() - make_interval(hours => p_hours);
begin
  with emailable as (
    select n.id
    from public.notifications n
    where n.created_at >= v_since
      and n.type in ('session_applied', 'session_accepted', 'session_declined',
                     'session_cancelled', 'verification', 'payment_failed',
                     'admin_warning', 'admin_suspension', 'session_expired',
                     'session_not_held', 'stylist_invite', 'admin_message',
                     'admin_broadcast',
                     'shop_favourited',
                     'new_availability')
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
  delete from public.email_sends where created_at < now() - interval '90 days';
  return v_row;
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. Verify.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_gen       text;
  v_npol      integer;
  v_trig      text;
  v_rec       text;
  v_pid       uuid;
  v_puser     uuid;
  v_model     uuid;
  v_first     integer;
  v_second    integer;
  v_aud       integer;
  v_fav       integer;
  v_near      integer;
  v_best      integer := 0;
  v_rows      integer;
  r           record;
begin
  -- (a) The ledger's date is GENERATED, not merely present. A plain `date`
  --     column with a default would let a caller choose it, and the whole
  --     debounce would be the caller's opinion.
  select generation_expression into v_gen
    from information_schema.columns
   where table_schema='public' and table_name='availability_notices'
     and column_name='notified_on';
  if v_gen is null then
    raise exception '0116: availability_notices.notified_on is missing or is not a GENERATED '
      'column, so the debounce date is settable by the caller. Rolled back.';
  end if;
  if v_gen not ilike '%Europe/London%' then
    raise exception '0116: notified_on is generated from %, which does not mention '
      'Europe/London. A UTC day boundary would let a 00:30 save re-notify. Rolled back.', v_gen;
  end if;

  -- (b) The constraint is across all three columns.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.availability_notices'::regclass
       and conname  = 'availability_notices_one_per_day'
       and contype  = 'u'
       and (select count(*) from unnest(conkey)) = 3
  ) then
    raise exception '0116: availability_notices_one_per_day is missing, is not UNIQUE, or '
      'does not span three columns. Rolled back.';
  end if;

  -- (c) RLS on, no policies, and nothing granted. All three, because any one
  --     of them alone leaves the table readable.
  if not (select relrowsecurity from pg_class where oid='public.availability_notices'::regclass) then
    raise exception '0116: RLS is not enabled on availability_notices. Rolled back.';
  end if;
  select count(*) into v_npol from pg_policies
   where schemaname='public' and tablename='availability_notices';
  if v_npol <> 0 then
    raise exception '0116: availability_notices has % policy/policies. It is meant to have '
      'none. Rolled back.', v_npol;
  end if;
  if has_table_privilege('authenticated', 'public.availability_notices', 'SELECT') then
    raise exception '0116: authenticated can SELECT availability_notices. Rolled back.';
  end if;

  -- (d) ⚠️⚠️ THE DEBOUNCE ACTUALLY REFUSES A SECOND ROW THE SAME DAY. The
  --     three checks above describe the constraint; this one exercises it,
  --     against real foreign keys, and then removes what it wrote. A UNIQUE
  --     naming the right columns on a table whose generated expression had
  --     drifted would pass (a)–(c) and let every save through twice.
  select p.id, p.user_id into v_pid, v_puser
    from public.providers p where p.is_published is true limit 1;
  select u.id into v_model from public.users u where u.role='model' limit 1;

  if v_pid is null or v_model is null then
    raise notice '0116: no published provider and/or no model to aim at, so the once-a-day '
      'constraint was NOT exercised. It exists; that it refuses is untested.';
  else
    insert into public.availability_notices (provider_id, model_user_id)
    values (v_pid, v_model)
    on conflict on constraint availability_notices_one_per_day do nothing;
    get diagnostics v_first = row_count;

    insert into public.availability_notices (provider_id, model_user_id)
    values (v_pid, v_model)
    on conflict on constraint availability_notices_one_per_day do nothing;
    get diagnostics v_second = row_count;

    -- Written before anything is asserted, so a failure below cannot leave
    -- the test's own rows behind in a transaction somebody commits anyway.
    delete from public.availability_notices
     where provider_id = v_pid and model_user_id = v_model;

    if v_first <> 1 then
      raise exception '0116: the FIRST notice for a pair did not insert (row_count %). The '
        'debounce is refusing everything. Rolled back.', v_first;
    end if;
    if v_second <> 0 then
      raise exception '0116: a SECOND notice for the same pair on the same day inserted '
        '(row_count %). The debounce does not debounce. Rolled back.', v_second;
    end if;
  end if;

  -- (e) Both functions, and the delegate still answering to its old name and
  --     arity — that is what the dormant mobile caller depends on.
  if to_regprocedure('public.availability_notice_audience(uuid)') is null
     or to_regprocedure('public.notify_models_of_availability(uuid[])') is null
     or to_regprocedure('public.notify_favourites_of_availability()') is null then
    raise exception '0116: one of the three functions is missing. Rolled back.';
  end if;
  if not has_function_privilege('authenticated',
       'public.notify_models_of_availability(uuid[])', 'EXECUTE') then
    raise exception '0116: authenticated cannot execute notify_models_of_availability, so no '
      'stylist can send a notice. Rolled back.';
  end if;
  -- ⚠️ AND THE AUDIENCE READER MUST STAY SHUT. It names a member's
  --    neighbours; Supabase's default privileges grant EXECUTE on new
  --    functions to authenticated, so this is the check that the revoke took.
  if has_function_privilege('authenticated',
       'public.availability_notice_audience(uuid)', 'EXECUTE') then
    raise exception '0116: authenticated CAN execute availability_notice_audience, which '
      'would let any member list who lives near any shop. Rolled back.';
  end if;

  -- (f) The type is in both SQL lists.
  select pg_get_triggerdef(t.oid) into v_trig
    from pg_trigger t where t.tgname='notify_email'
     and t.tgrelid='public.notifications'::regclass and not t.tgisinternal;
  if v_trig is null or v_trig not like '%new_availability%' then
    raise exception '0116: notify_email does not fire on new_availability, so nothing is '
      'emailed. Rolled back.';
  end if;
  select pg_get_functiondef(p.oid) into v_rec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='run_email_reconcile';
  if v_rec is null or v_rec not like '%new_availability%' then
    raise exception '0116: run_email_reconcile does not count new_availability, so a failure '
      'to send one would be invisible. This is item 135''s shape. Rolled back.';
  end if;

  -- (g) ⚠️ THE AUDIENCE IS MEASURED, NOT ASSERTED TO EXIST. The notifier
  --     itself cannot be called here — it reads auth.uid(), and a migration
  --     has no JWT, so it would return 0 and prove nothing. This calls the
  --     audience function for every published shop and prints what it found.
  for r in
    select p.id, coalesce(p.name, '(no name)') as name
      from public.providers p where p.is_published is true
     order by p.name nulls last
  loop
    select count(*)::integer,
           count(*) filter (where a.by_favourite)::integer,
           count(*) filter (where a.by_distance)::integer
      into v_aud, v_fav, v_near
      from public.availability_notice_audience(r.id) a;
    raise notice '0116: % — audience %, of which % favourited and % within 10 miles.',
      r.name, v_aud, v_fav, v_near;
    if v_aud > v_best then v_best := v_aud; end if;
  end loop;

  -- And it must actually be bigger than favourites alone, or the arithmetic
  -- is wrong and this migration has shipped a rename.
  select count(*)::integer into v_rows from public.favourites;
  if v_best <= v_rows then
    raise exception '0116: the largest audience across published shops is %, no more than the '
      '% row(s) in favourites. The distance arm is matching nobody — check that '
      'providers.latitude/longitude are populated before trusting this. Rolled back.',
      v_best, v_rows;
  end if;

  -- (h) A model with no coordinates and no favourite must NOT be reachable.
  --     29 of 88 are in that state and the honest answer is that they get
  --     nothing; a rule that quietly included them would be guessing where
  --     they live.
  select count(*)::integer into v_rows
    from public.providers p
    cross join lateral public.availability_notice_audience(p.id) a
    join public.users u on u.id = a.model_user_id
   where p.is_published is true
     and (u.latitude is null or u.longitude is null)
     and a.by_distance;
  if v_rows <> 0 then
    raise exception '0116: % unplaced model(s) matched the DISTANCE arm, which is impossible '
      'unless the null checks were lost. Rolled back.', v_rows;
  end if;

  raise notice '0116: new_availability now reaches favourites + 10 miles, once per stylist '
    'per model per London day, and emails. ⚠️ DEPLOY send-email OR THE SUBJECT READS '
    '"Something happened on Cavy".';
end $mig$;

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0116', 'new_times_reach_more_than_three_people', '83ae8cbe01606f11b6b2982d9479f9a7f1a3410a54078242701f303b9738382e');

commit;

notify pgrst, 'reload schema';

-- ⚠️ TO UNDO: restore notify_favourites_of_availability from 0076 (its full
-- body is in that file), drop function public.notify_models_of_availability(uuid[]);
-- drop function public.availability_notice_audience(uuid);
-- drop table public.availability_notices; recreate the notify_email trigger and
-- run_email_reconcile without 'new_availability' — both full lists are above —
-- then delete the '0116' row. The notification rows already written stay; they
-- are true. And the send-email deploy has to be rolled back separately, or the
-- copy for a type nothing sends simply goes unused, which is harmless.
