-- ===========================================================================
-- 0046_a_review_is_of_the_other_party
--
-- A review must be OF the other person in the booking: a model reviews that
-- booking's stylist, and the stylist reviews that booking's model. Audit
-- item 70, found while building review-leaving on the web, 22 Sep 2026.
--
-- ⚠️ Apply 0045 first (for order only; nothing here depends on it).
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- The INSERT policy "write own review for own session" (review-integrity.sql)
-- checks the REVIEWER: it must be the caller, a participant of the booking,
-- and the booking must be completed. It never looks at `reviewee_id`. So
-- anyone with one completed booking could file their one review for it about
-- ANY user, and recompute_provider_rating (AFTER INSERT on reviews, snapshot
-- :210-227) would fold it into THAT person's rating and review count — shown on
-- their profile, on browse, and on the public site's cards.
--
-- Both clients set it correctly (mobile leave-review.tsx:302, and the web's
-- leaveReview, which derives it from the booking). The hole was only ever
-- reachable by writing to the API directly, which is exactly what RLS exists
-- to stop.
--
-- ── THE CHANGE ──────────────────────────────────────────────────────────
-- A BEFORE INSERT OR UPDATE trigger that reads the booking and refuses unless
-- (reviewer, reviewee) is (model, stylist) or (stylist, model), with 23514.
-- A trigger rather than a policy clause so it holds for EVERY writer, the
-- service role included: seed/seed.mjs already writes reviews that way, and a
-- review of the wrong person is wrong whoever writes it.
--
-- Existing rows are NOT changed. MEASURE counts any that already break the
-- rule, so a non-zero number is visible rather than silently grandfathered.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.reviews') is null then
    raise exception '0046: public.reviews is missing.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'reviews'
         and column_name in ('session_id', 'reviewer_id', 'reviewee_id')) <> 3 then
    raise exception '0046: reviews does not have session_id, reviewer_id and reviewee_id.';
  end if;
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.reviews'::regclass and tgname = 'trg_reviews_reviewee_is_other_party') then
    raise exception '0046: trg_reviews_reviewee_is_other_party already exists. Read it before applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- MEASURE — reviews that already name someone other than the other party.
-- A count only. They are left as they are.
-- ---------------------------------------------------------------------------
insert into public.migration_findings (version, item, value)
select '0046', 'reviews_total', count(*)::text from public.reviews;

insert into public.migration_findings (version, item, value)
select '0046', 'reviews_of_the_wrong_person', count(*)::text
from public.reviews r
left join public.sessions s on s.id = r.session_id
left join public.providers p on p.id = s.provider_id
where not (
  (r.reviewer_id = s.model_user_id and r.reviewee_id = p.user_id)
  or (r.reviewer_id = p.user_id and r.reviewee_id = s.model_user_id)
);

-- ---------------------------------------------------------------------------
-- THE CHANGE
-- ---------------------------------------------------------------------------
create function public.guard_review_reviewee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model   uuid;
  v_stylist uuid;
begin
  -- Definer, so it can read the booking whatever the caller's RLS allows.
  select s.model_user_id, p.user_id
    into v_model, v_stylist
  from public.sessions s
  left join public.providers p on p.id = s.provider_id
  where s.id = new.session_id;

  if (new.reviewer_id = v_model   and new.reviewee_id = v_stylist)
  or (new.reviewer_id = v_stylist and new.reviewee_id = v_model) then
    return new;
  end if;

  raise exception 'A review has to be of the other person in the booking.'
    using errcode = '23514',
          hint = 'A model reviews the booking''s stylist; the stylist reviews the booking''s model.';
end
$$;

comment on function public.guard_review_reviewee() is
  'Refuses a review whose reviewee is not the other party to its booking: model → that booking''s '
  'stylist (providers.user_id), stylist → that booking''s model. The INSERT policy checks only the '
  'reviewer, so before 0046 a completed-booking participant could file their review about anyone and '
  'recompute_provider_rating would count it against that person. Every writer, service role included. '
  'Audit item 70.';

revoke all on function public.guard_review_reviewee() from public, anon, authenticated;

create trigger trg_reviews_reviewee_is_other_party
  before insert or update of session_id, reviewer_id, reviewee_id on public.reviews
  for each row execute function public.guard_review_reviewee();

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0046', 'a_review_is_of_the_other_party', 'b367c5ba57ba8796c7305661c65933aca901bc2d65d2c2db807ea336e519f33e');

commit;


-- ===========================================================================
-- VERIFY — one block at a time, in the Supabase SQL editor.
-- ===========================================================================
--
-- ── BLOCK A — installed, and what MEASURE found. Read-only ──────────────
--
--   select
--     exists (select 1 from pg_trigger
--              where tgrelid = 'public.reviews'::regclass
--                and tgname = 'trg_reviews_reviewee_is_other_party' and tgenabled = 'O') as trigger_on,
--     (select value from public.migration_findings where version = '0046' and item = 'reviews_total')              as reviews_total,
--     (select value from public.migration_findings where version = '0046' and item = 'reviews_of_the_wrong_person') as wrong_person_before;
--
--   Expect trigger_on true. wrong_person_before should be 0; anything else is
--   a review already counted against the wrong person, to look at by hand.
--
-- ── BLOCK B — the wrong person is refused, the right one is allowed.
--               Rolls itself back ──────────────────────────────────────────
--
-- Uses one of Micky B's completed bookings that he hasn't reviewed yet, as
-- the STYLIST reviewing that booking's model. Runs as the SQL editor, so RLS
-- doesn't apply — this tests the trigger alone, which is the point: it must
-- hold for every writer.
--
-- The insert names the same columns as seed/seed.mjs's review insert, which has
-- run against this table; `reviews` itself is created by no file in the repo.
--
--   do $$
--   declare
--     v_me constant uuid := 'ff06d568-8936-45fa-ad5f-0b88c150ec30';
--     v_sess uuid; v_model uuid; v_log text := '';
--   begin
--     select s.id, s.model_user_id into v_sess, v_model
--     from public.sessions s join public.providers p on p.id = s.provider_id
--     where p.user_id = v_me and s.status = 'completed'
--       and not exists (select 1 from public.reviews r where r.session_id = s.id and r.reviewer_id = v_me)
--     limit 1;
--     if v_sess is null then
--       raise exception 'Block B: no completed booking of Micky B''s without his review. Nothing was tested.';
--     end if;
--
--     begin
--       insert into public.reviews (session_id, reviewer_id, reviewee_id, overall_rating, tags)
--         values (v_sess, v_me, v_me, 5, '{}');
--       v_log := v_log || E'\nwrong person (himself): INSERTED  <-- NOT GUARDED';
--     exception
--       when sqlstate '23514' then v_log := v_log || E'\nwrong person (himself): refused, 23514 (correct)';
--       when others then v_log := v_log || format(E'\nwrong person (himself): refused %s (%s)  <-- unexpected', sqlstate, sqlerrm);
--     end;
--
--     begin
--       insert into public.reviews (session_id, reviewer_id, reviewee_id, overall_rating, tags)
--         values (v_sess, v_me, v_model, 5, '{}');
--       v_log := v_log || E'\nthe booking''s model:   inserted (correct)';
--     exception when others then
--       v_log := v_log || format(E'\nthe booking''s model:   REFUSED %s (%s)  <-- WRONG', sqlstate, sqlerrm);
--     end;
--
--     raise exception E'ROLLED BACK ON PURPOSE.%', v_log;
--   end $$;
--
--   Expect: wrong person refused 23514; the booking's model inserted. The
--   rollback removes the test review, and with it any change to a rating.
