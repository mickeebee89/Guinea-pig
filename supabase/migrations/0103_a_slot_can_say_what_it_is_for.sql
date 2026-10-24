-- ===========================================================================
-- 0103_a_slot_can_say_what_it_is_for
--
-- ⚠️ Apply 0102 first. One nullable column and one length check. Nothing else.
--
-- A stylist can post a time but not say what it is FOR. "Tuesday 2pm, £15" is
-- the same row whether she wants a model for balayage practice, a half-head of
-- foils for an assessment, or anyone at all. `active_treatments` says which
-- treatments are on offer; it cannot say "colour correction, I need someone
-- with box dye to lift" — and that sentence is the difference between a model
-- applying and a model scrolling past.
--
-- ── ⚠️ NULLABLE, NO DEFAULT, AND THE DIFFERENCE MATTERS ──────────────────
-- A default of '' would make every existing row carry an empty note, which
-- reads as "she wrote nothing" rather than "this was never asked". NULL is the
-- honest state for the slots that already exist, and the editor treats null and
-- '' the same on the way in.
--
-- ── ⚠️ 280 CHARACTERS, ENFORCED HERE AND NOT ONLY IN THE TEXTAREA ────────
-- `maxLength` on an input is a convenience for the person typing; it is not a
-- constraint. A crafted PostgREST call carries whatever it likes, and this
-- column is rendered to other members. The check is the thing that is true.
--
-- `note is null or char_length(note) <= 280` rather than a bare length test,
-- because a CHECK that evaluates to NULL passes — so `char_length(note) <= 280`
-- alone would be satisfied by a null and read as if it had been considered.
-- It is written out so the null case is visibly a decision.
--
-- ⚠️ char_length, NOT length or octet_length. They differ the moment somebody
-- uses an emoji or an accented character, and the count the textarea shows has
-- to be the count the database enforces, or a stylist is refused by a limit she
-- was never shown reaching.
--
-- ── ⚠️ NO GRANT CHANGES, AND THAT IS CHECKED RATHER THAN ASSUMED ─────────
-- `availability` is granted table-wide — `authenticated=arwdDxtm`, with NO
-- column-level ACLs (read live, 24 Oct 2026). So a new column is covered by
-- the existing grant and needs nothing added.
--
-- ⚠️ THIS IS NOT TRUE OF EVERY TABLE AND MUST NOT BE GENERALISED. 0088 revoked
-- table-wide UPDATE on `public.users` and re-granted named columns, which is
-- why 0099 had to extend that list from 8 to 10 — a new column there is
-- invisible to writers until it is named. The difference is per table, and the
-- only way to know is to look.
--
-- RLS is unchanged: the existing policies key on the owning provider, not on
-- any column list, so they cover this one as written.
-- ===========================================================================
begin;

alter table public.availability add column note text;

alter table public.availability add constraint availability_note_len
  check (note is null or char_length(note) <= 280);

-- MIGRATION FOOTER
insert into public.schema_migrations (version, name, checksum)
values ('0103', 'a_slot_can_say_what_it_is_for', '870c10e3864a594b353fbb55fcc1f8fea8562bac7dca9a6de1541ce9472b6fe4');

commit;

notify pgrst, 'reload schema';
