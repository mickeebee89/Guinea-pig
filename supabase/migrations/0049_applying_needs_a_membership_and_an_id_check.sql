-- ===========================================================================
-- 0049_applying_needs_a_membership_and_an_id_check
--
-- The apply gate, enforced by the database. Audit item 78. Decision: Micky,
-- 23 Sep 2026. Step 1 of the web apply flow, shipped on its own.
--
-- ⚠️ Apply 0048 first.
-- ⚠️ THIS MIGRATION REFUSES TO APPLY IF IT WOULD LOCK ANYONE OUT. The ASSERT
-- block below counts models who have applied in the last 90 days and would
-- fail the new rule. If that count is not zero it raises and changes nothing,
-- because the rule or the data is wrong and one of them needs fixing first.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- Models must have an active membership AND an ID check to apply. Both were
-- enforced only in a mobile SCREEN (apply-session.tsx:200-224), and
-- create_session_with_consent checks neither — it checks that you are signed
-- in and that consent was given, and nothing else (0009:52-56).
--
-- So anyone holding a valid token could book for free by calling the RPC
-- directly, and the £4.99 that the product describes as "what lets you apply"
-- was a client-side suggestion. This is also the precondition for the web
-- apply flow: without it, building a second client would add a second
-- unguarded caller to a rule enforced nowhere.
--
-- ── THE RULE, MIRRORING THE CLIENTS EXACTLY (BAR STRIPE) ────────────────
-- Both clients agree (site/lib/verification.ts:92-102,
-- mobile/src/lib/verification.ts:61-73):
--   users.subscription_waived, OR a subscriptions row whose status is one of
--   active / cancelling / past_due — AND users.is_verified.
--
-- ⚠️ ONE DELIBERATE DIFFERENCE. The clients also require current_period_end
-- to be in the future, and when it is not they ASK STRIPE and repair the row
-- (sync_subscription). The database cannot ask Stripe, so requiring the date
-- here would refuse exactly the case the clients exist to rescue: a live
-- Stripe subscription whose local row is stale — the no-webhook failure of
-- audit item 47, which is still unfixed.
--
-- So the date is NOT checked here. This is a backstop against "never paid at
-- all", not a billing reconciler. It fails only what the clients would also
-- fail on their own data, and never on a technicality the member cannot see.
--
-- past_due grants, exactly as the clients do: a failed payment is a retry,
-- not a lapse, and cutting someone off mid-retry is the failure both client
-- files already lean away from.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT — including the lock-out check, so this cannot ship over a live user
-- ---------------------------------------------------------------------------
do $$
declare v_locked_out integer;
begin
  if to_regclass('public.sessions') is null or to_regclass('public.subscriptions') is null then
    raise exception '0049: sessions or subscriptions is missing.';
  end if;

  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'users'
     and column_name in ('subscription_waived', 'is_verified')
   having count(*) = 2;
  if not found then
    raise exception '0049: users.subscription_waived and users.is_verified must both exist — the rule reads them.';
  end if;

  -- The RESTRICTIVE policy below checks the CALLER, not the row's
  -- model_user_id. That is only equivalent because the permissive policy
  -- forces them to be the same person. If that policy ever goes, this one
  -- stops meaning what it says — so its absence is a refusal, not a warning.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sessions'
      and policyname = 'model can create session'
  ) then
    raise exception
      '0049: the permissive policy "model can create session" is missing. This migration depends on it forcing auth.uid() = model_user_id.';
  end if;

  -- ⭐ Nobody who is using the product today may be refused by this.
  -- Recency is measured on sessions.date, a NOT NULL column that certainly
  -- exists; sessions is created by no migration, so its full column list is
  -- not knowable from this repo.
  select count(distinct s.model_user_id) into v_locked_out
  from public.sessions s
  join public.users u on u.id = s.model_user_id
  where s.date >= current_date - interval '90 days'
    and not (
      (coalesce(u.subscription_waived, false)
        or exists (select 1 from public.subscriptions sub
                    where sub.user_id = s.model_user_id
                      and sub.status in ('active', 'cancelling', 'past_due')))
      and coalesce(u.is_verified, false)
    );

  if v_locked_out > 0 then
    raise exception
      '0049 REFUSED: % model(s) who applied in the last 90 days would be refused by this rule. Nothing was changed. Read them with the query in the DEPLOY notes before deciding whether the rule or the data is wrong.', v_locked_out;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE RULE, ONCE
--
-- Two entry points over ONE definition, because two copies of a rule is how
-- the rule ends up meaning two things:
--   * model_may_apply(uuid) — owner only. Used by the trigger, the ASSERT
--     above and the verify blocks below. NOT granted to anyone else: it would
--     answer "is this person a paying, verified member?" about any id someone
--     cared to guess, and that is personal data.
--   * model_may_apply()     — the caller's own answer. Granted to
--     authenticated, and the only version the policy uses.
-- ---------------------------------------------------------------------------
create or replace function public.model_may_apply(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select
       (coalesce(u.subscription_waived, false)
         or exists (select 1 from public.subscriptions s
                     where s.user_id = p_user_id
                       and s.status in ('active', 'cancelling', 'past_due')))
       and coalesce(u.is_verified, false)
     from public.users u
     where u.id = p_user_id),
    false)                    -- no user row at all: not eligible
$$;

revoke all on function public.model_may_apply(uuid) from public, anon, authenticated;

create or replace function public.model_may_apply()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.model_may_apply(auth.uid())
$$;

revoke all on function public.model_may_apply() from public, anon;
grant execute on function public.model_may_apply() to authenticated;

comment on function public.model_may_apply(uuid) is
  'Does this member meet the apply gate: membership (waived, or a subscriptions row that is '
  'active/cancelling/past_due) AND users.is_verified. Owner only — it is about one person''s '
  'money and ID. 0049, audit item 78.';
comment on function public.model_may_apply() is
  'The apply gate, for the caller. Used by the RESTRICTIVE policy on sessions. 0049.';

-- ---------------------------------------------------------------------------
-- 2. THE LEGIBLE REFUSAL
--
-- A BEFORE INSERT trigger, not a rewrite of create_session_with_consent.
-- Three reasons, in order of how much they matter:
--   1. A row-security violation says "new row violates row-level security
--      policy" and nothing else. The member needs to know WHICH half they are
--      missing, and this is their own account, so saying is safe.
--   2. Replacing the RPC means reproducing the whole of 0009's body to change
--      its first line. A transcription slip there is a booking bug.
--   3. It covers every path into the table, not only that one function —
--      which is the entire point of moving this out of a screen.
-- The trigger is the message; the policy below is the enforcement. Drop the
-- trigger and the refusal is still a refusal, just an ugly one.
--
-- Same shape as 0042's banned-word gate, which raises CV001. CV002 is 0045's
-- unsettled stylist fee. This is CV003.
-- ---------------------------------------------------------------------------
create or replace function public.tg_session_apply_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscribed boolean;
  v_verified   boolean;
begin
  -- Not a member-originated insert: the owner, the service role, an edge
  -- function, or a verify block. RLS does not bind those either, and admin
  -- tooling must keep working.
  if auth.uid() is null then
    return new;
  end if;

  if public.model_may_apply(new.model_user_id) then
    return new;
  end if;

  select
    (coalesce(u.subscription_waived, false)
      or exists (select 1 from public.subscriptions s
                  where s.user_id = new.model_user_id
                    and s.status in ('active', 'cancelling', 'past_due'))),
    coalesce(u.is_verified, false)
  into v_subscribed, v_verified
  from public.users u where u.id = new.model_user_id;

  raise exception '%',
    case
      when coalesce(v_subscribed, false) is false and coalesce(v_verified, false) is false then
        'You need an active Cavy membership and an ID check before you can apply.'
      when coalesce(v_subscribed, false) is false then
        'You need an active Cavy membership before you can apply.'
      else
        'You need to finish your ID check before you can apply.'
    end
    using errcode = 'CV003';
end $$;

create trigger session_apply_gate
  before insert on public.sessions
  for each row execute function public.tg_session_apply_gate();

comment on function public.tg_session_apply_gate() is
  'BEFORE INSERT on sessions (0049). Refuses an application from a member without an active '
  'membership or an ID check, with SQLSTATE CV003 and a message naming which half is missing. '
  'The RESTRICTIVE policy sessions_applicant_is_eligible is the enforcement; this is the wording.';

-- ---------------------------------------------------------------------------
-- 3. THE ENFORCEMENT
--
-- RESTRICTIVE, so it ANDs with the permissive "model can create session"
-- rather than adding a new way in. A RESTRICTIVE policy alone would forbid
-- everything, which is why the ASSERT refuses to proceed without the
-- permissive one.
-- ---------------------------------------------------------------------------
create policy sessions_applicant_is_eligible on public.sessions
  as restrictive
  for insert to authenticated
  with check (public.model_may_apply());

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0049', 'applying_needs_a_membership_and_an_id_check', 'f4f8c90b418d0984286c04d95e594691d57c75d2ba01a4e8459b7b4abb8a823f');

commit;

notify pgrst, 'reload schema';


-- ===========================================================================
-- DEPLOY
--
--   0. FIRST, read-only, before applying anything. Who would this refuse?
--      Counts and roles only — no addresses.
--
--        select u.role,
--               count(distinct s.model_user_id) as models_refused,
--               count(*)                        as their_bookings
--        from public.sessions s
--        join public.users u on u.id = s.model_user_id
--        where s.date >= current_date - interval '90 days'
--          and not (
--            (coalesce(u.subscription_waived, false)
--              or exists (select 1 from public.subscriptions sub
--                          where sub.user_id = s.model_user_id
--                            and sub.status in ('active','cancelling','past_due')))
--            and coalesce(u.is_verified, false)
--          )
--        group by u.role;
--
--      NO ROWS is the answer that lets this ship. Any rows and the migration
--      refuses itself anyway — deliberately, twice.
--
--   1. Apply this migration.
--   2. Blocks A to E below, one at a time.
--
--   Nothing in site/ or mobile/ changes. No deploy, no build, no app release.
-- ===========================================================================
--
-- ── BLOCK A — the shape. Read-only ──────────────────────────────────────
--
--   select
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'model_may_apply')          as overloads,
--     has_function_privilege('authenticated', 'public.model_may_apply()', 'execute')      as auth_may_call_own,
--     has_function_privilege('authenticated', 'public.model_may_apply(uuid)', 'execute')  as auth_may_ask_about_others,
--     has_function_privilege('anon', 'public.model_may_apply()', 'execute')               as anon_may_call,
--     (select tgenabled from pg_trigger
--       where tgrelid = 'public.sessions'::regclass and tgname = 'session_apply_gate')    as trigger_enabled,
--     (select permissive from pg_policies where schemaname = 'public'
--       and tablename = 'sessions' and policyname = 'sessions_applicant_is_eligible')     as policy_kind;
--
--   Expect: 2, true, FALSE, FALSE, 'O', 'RESTRICTIVE'.
--   auth_may_ask_about_others MUST be false — it answers about someone's
--   money and ID.
--
-- ── BLOCK B — what the rule says about the people who exist. Read-only ──
--
-- Counts and roles only.
--
--   select u.role,
--          count(*)                                          as members,
--          count(*) filter (where public.model_may_apply(u.id)) as may_apply
--   from public.users u
--   group by u.role order by u.role;
--
--   Models with may_apply below members is expected and fine — it is the
--   people who have not paid or not done the ID check. Compare it with
--   Block E, which is the number that must be zero.
--
-- ── BLOCK C — ⭐ refused and allowed, for real. Rolls itself back ───────
--
-- Inserts a booking as an INELIGIBLE member (expects CV003), then as an
-- eligible one (expects success). `set local role authenticated` with
-- request.jwt.claims is what makes the policy and the trigger apply at all.
--
--   do $$
--   declare
--     v_good constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';  -- model test acct
--     v_bad  uuid;
--     v_prov uuid; v_treat uuid; v_slot uuid;
--     v_bad_result text; v_good_result text; v_id uuid;
--   begin
--     if not public.model_may_apply(v_good) then
--       raise exception 'ROLLED BACK. The model test account is not eligible itself, so the positive half cannot be tested. Run Block B and read why.';
--     end if;
--     select u.id into v_bad from public.users u
--      where not public.model_may_apply(u.id) and u.id <> v_good limit 1;
--     if v_bad is null then
--       raise exception 'ROLLED BACK. Every member is eligible, so the refusal cannot be tested on real data.';
--     end if;
--
--     -- ⚠️ CORRECTED 23 Sep 2026, AFTER ITS FIRST RUN. This used to pick any
--     -- provider, picked one with NO treatments, and the insert then failed on
--     -- sessions.treatment_id NOT NULL — so the POSITIVE half proved nothing
--     -- while the block still "passed" on the refusal. Pick a provider that
--     -- HAS a treatment, and put that treatment in the slot.
--     select p.id, t.id into v_prov, v_treat
--     from public.providers p
--     join public.provider_treatments t on t.provider_id = p.id
--     order by (p.is_published is true) desc
--     limit 1;
--     if v_prov is null then
--       raise exception 'ROLLED BACK. No provider with a treatment exists, so a booking cannot be built.';
--     end if;
--
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--     values (v_prov, current_date + 30, '10:00', '11:00', array[v_treat::text], false)
--     returning id into v_slot;
--
--     execute format('set local role authenticated');
--
--     -- 1. the ineligible member
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_bad, 'role', 'authenticated')::text);
--     begin
--       insert into public.sessions (provider_id, model_id, model_user_id, availability_id,
--                                    treatment_id, date, start_time, end_time,
--                                    scheduled_at, duration_minutes, location_type, status)
--       values (v_prov, v_bad, v_bad, v_slot, v_treat, current_date + 30, '10:00', '11:00',
--               (current_date + 30)::timestamptz + interval '10 hours', 60, 'provider', 'pending');
--       v_bad_result := 'ACCEPTED  <-- WRONG, the gate did not hold';
--     exception
--       when sqlstate 'CV003' then v_bad_result := 'refused, CV003 (correct): ' || sqlerrm;
--       when insufficient_privilege then v_bad_result := 'refused by RLS (correct, but the trigger did not speak first)';
--       when others then v_bad_result := 'refused by something else: ' || sqlstate || ' ' || sqlerrm;
--     end;
--
--     -- 2. the eligible member
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_good, 'role', 'authenticated')::text);
--     begin
--       insert into public.sessions (provider_id, model_id, model_user_id, availability_id,
--                                    treatment_id, date, start_time, end_time,
--                                    scheduled_at, duration_minutes, location_type, status)
--       values (v_prov, v_good, v_good, v_slot, v_treat, current_date + 30, '10:00', '11:00',
--               (current_date + 30)::timestamptz + interval '10 hours', 60, 'provider', 'pending')
--       returning id into v_id;
--       v_good_result := 'accepted (correct), session ' || v_id::text;
--     exception
--       when others then v_good_result := 'REFUSED <-- WRONG: ' || sqlstate || ' ' || sqlerrm;
--     end;
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nineligible member: %\neligible member:   %',
--       v_bad_result, v_good_result;
--   end $$;
--
-- ── BLOCK D — the existing mobile call still works. Rolls itself back ───
--
-- Calls create_session_with_consent with its 17 arguments, unchanged, as the
-- eligible model. This is the signature the installed app build sends; if it
-- has moved, this fails and the app stops booking.
--
--   do $$
--   declare
--     v_me constant uuid := 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130';
--     v_prov uuid; v_treat uuid; v_slot uuid; v_session uuid;
--     v_doc record;
--   begin
--     select id, version, content_hash, acknowledgements into v_doc
--     from public.consent_documents where is_active limit 1;
--     if v_doc.id is null then
--       raise exception 'ROLLED BACK. No active consent document, so the RPC cannot be exercised.';
--     end if;
--
--     -- Same correction as Block C: a provider with no treatment cannot carry
--     -- a booking, because sessions.treatment_id is NOT NULL.
--     select p.id, t.id into v_prov, v_treat
--     from public.providers p
--     join public.provider_treatments t on t.provider_id = p.id
--     limit 1;
--     insert into public.availability (provider_id, date, start_time, end_time, active_treatments, is_taken)
--     values (v_prov, current_date + 31, '12:00', '13:00', array[v_treat::text], false) returning id into v_slot;
--
--     execute format('set local role authenticated');
--     execute format('set local request.jwt.claims = %L', json_build_object('sub', v_me, 'role', 'authenticated')::text);
--
--     v_session := public.create_session_with_consent(
--       v_prov, v_slot, current_date + 31, '12:00', '13:00',
--       (current_date + 31)::timestamptz + interval '12 hours', 60,
--       v_treat, 'provider', 'Verify 0049 — rolled back', '{}',
--       v_doc.id, v_doc.version, v_doc.content_hash, v_doc.acknowledgements
--     );
--
--     reset role;
--     raise exception E'ROLLED BACK ON PURPOSE.\nthe 17-argument call still works: session %', v_session;
--   end $$;
--
--   A CV003 here means the model test account has lapsed, not that the
--   signature moved. Block B tells you which.
--
-- ── BLOCK E — nobody was locked out. Read-only, run it after ────────────
--
-- The same question the ASSERT asked, asked again now it is live. Must be 0.
--
--   select count(distinct s.model_user_id) as models_now_refused
--   from public.sessions s
--   join public.users u on u.id = s.model_user_id
--   where s.date >= current_date - interval '90 days'
--     and not public.model_may_apply(s.model_user_id);
