# Guinea Pig — Session Handover

_Use this to start a fresh chat with full context. Hand it to Claude at the start._

---

## HOW I WORK (read first)
- **Persona:** methodical, root-cause-first coder. Fix the first cause in a chain, not symptoms. Pivot instead of tinkering. Elegant code.
- **Format I want:** terse, numbered, **copy-paste-ready** commands/SQL blocks. One task at a time. Minimal forward-planning. Use the decision-button tool for choices.
- **Always remind me to add haptic feedback** when building new screens/interactions.
- **Recurring trap:** stale Metro bundles mask fixes. After ANY mobile change, reload with `npx expo start -c --dev-client` before concluding a fix failed.

## STACK / PATHS
- Mobile: React Native/Expo (Android-first, iOS planned), Expo Router, EAS. Runs via Metro tunnel on my phone.
- Backend: Supabase (Postgres/auth/storage/realtime), project `ptluekkhiopowuyvkgnd`.
- Admin: Next.js 16.2.7 / Vercel (App Router, Turbopack).
- Payments: Stripe (TEST mode). Media: Cloudinary. Email: Resend.
- Repo: github.com/mickeebee89/Guinea-pig (commit direct to main).
- Windows paths: repo root `C:\Users\micky\Documents\Guinea-pig` (admin app); mobile in `mobile\`.
- Run mobile: `cd C:\Users\micky\Documents\Guinea-pig\mobile` then `npx expo start -c --dev-client`.
- Deploy edge fn: from repo ROOT `npx supabase functions deploy <name>` (Docker-not-running warning is harmless).
- I work via Claude Code (terminal) + Supabase SQL editor + phone testing. I paste prompts/results/screenshots back. Claude Code paste-backs sometimes arrive empty — I re-paste in sections.

## KEY IDENTIFIERS
- Admin/provider "Micky B": user_id `ff06d568-8936-45fa-ad5f-0b88c150ec30` (micky.buckfield@gmail.com); providers.id `49d40aae-a830-41d1-bca8-0fbdb2695455`.
- Model test acct: `b0df9c2f-02c5-4fef-afb0-9b184c3b9130` (micky.buckfield@hotmail.co.uk, subscribed+verified).
- Provider test acct `nahitih259@bevriz.com`: user_id `517c2853-50bb-4e8f-87fe-d79311bc37c0`.
- Palette: gold #C2A14D, blush/softPink #F4DADC, off-white #FBF6F1, warmDark #3A302C, pinkVibrant #F45D9E, roseDark #A8862E.

## SCHEMA ANCHORS (verified against live DB)
- Bookings are `sessions` (not `bookings`). Model in sessions = `model_user_id` (also `model_id` col exists). Provider owner = `providers.user_id`; session→provider via `provider_id`→`providers.id`. All are auth.users ids.
- **`public.users` has NO FK to `auth.users`** — deleting the auth user does NOT cascade public.users; must delete it explicitly. CASCADE-from-users children hang off `public.users`.
- `blocks` table: blocker_id, blocked_id (both FK users, ON DELETE CASCADE), unique on the pair. Mutual block = either direction.
- `messages.body` (not content). British spelling `colour_hex`. No `profiles` table. `admins` table for admin status. `model_attributes` holds model profile data.
- RLS: use `authenticated` role. RESTRICTIVE policies AND with permissive ones (a permissive INSERT must also exist).

## PRICING (Stripe TEST mode — swap to LIVE before launch)
- Provider £14.99 one-off verification (first 100–200 free "Founding Providers"). Model £4.99/mo subscription.
- Both PAY-FIRST: Get Verified → pay → selfie → admin approves → unlock. Provider unlock = is_verified + is_published. Model = active subscription AND identity verification both required to apply (browse free).
- Admin approve() unlocks unconditionally (free-account override). Test card 4242 4242 4242 4242, 12/34, 123.

---

## ✅ DONE THIS SESSION

### Legal domain swap + blocked-names fix (latest)
- **Legal links + support email** (settings.tsx): Terms/Community/Privacy links and the delete-account support email swapped `guineapig.beauty` → `guineapigapp.co.uk`. Commit `74a83ce`, pushed.
- **Blocked-users names/pics fix:** the "Blocked users" list read other people's rows from `users`, which RLS blocks for non-self rows, so everyone showed as "User" + blank avatar. Switched to `public_profiles` (the app's standard cross-user read path, same columns). Verified on device — real names + photos now show. Commit `6cee65e` (local, **not yet pushed** — parked to bundle with other work).
- **CLAUDE.md:** added a "Plain English, always" working-style bullet (define terms on first use; lead bug reports with one plain sentence on user impact). Commit `0928f16`, pushed.

### Distance filters + model dashboard
- Model home + provider dashboard distance filters now have **'Any'** (no cap) as first + default chip.
- Model home renamed "Dashboard"; title-left + chat/notifications/avatar icons right.
- Model home: horizontal upcoming treatments (soonest first, count in title); search+filter relocated to mirror provider dashboard's "Nearby" section layout.
- Provider dashboard: verified-status now refreshes on focus via separate `isVerified` state (root cause was `if(!p) return p` dropping the update when provider was null at focus). Availability save now shows "Availability saved ✓".

### Email / domain (operational — DONE)
- Domain `guineapigapp.co.uk` bought via Cloudflare Registrar.
- Resend: domain added + verified, DNS auto-configured via Cloudflare (SPF/DKIM/DMARC).
- Supabase custom SMTP wired: host smtp.resend.com, port 465, user `resend`, sender `no-reply@guineapigapp.co.uk`. Emails send + deliver (spam-at-first is normal for new domain).
- 5 branded auth email templates drafted (file: guinea-pig-email-templates.html) — to paste into Supabase → Auth → Emails → Templates.
- Email confirmation stays OFF during testing — **re-enable before launch**.

### App Store / Play compliance ("THE REDS") — hard gates
- **RED #1 — Account deletion — ✅ DONE + DEPLOYED + TESTED.** Edge fn `delete-account` (own-id-only from JWT, FK-safe delete order, storage cleanup, explicit public.users delete before auth delete, best-effort). settings.tsx dialog fixed (removed fake "type DELETE"). Tested: all counts 0. Committed+pushed.
- **RED #2 — User blocking — ✅ DONE + TESTED (Parts 1–3).**
  - Part 1: handleBlock writes to correct `blocks` table (was `user_blocks`); `mobile/src/lib/blocks.ts` `getBlockedIds(userId)` returns mutual set; RLS enforced (blocks_insert_own/select_involved/delete_own + RESTRICTIVE messages_insert_not_blocked + sessions_insert_not_blocked). Enforcement tested (blocked send rejected). Committed+pushed.
  - Part 2: 6 surfaces filter getBlockedIds, fail-open (.catch→new Set()): model home, provider dashboard nearby, messages list, chat (shows "You can't message this user"), applications, provider profile Apply. Tested both ways.
  - Part 2b: auto-cancel pending/accepted bookings between pair on block + notify OTHER party only ("Booking cancelled", type `session_cancelled`, no mention of blocking). **✅ TESTED both directions (provider-blocks-model + model-blocks-model) — session flips to `cancelled`, notification lands on the other party only. Model-initiated cancel works under RLS.** Cosmetic follow-up: `session_cancelled` missing from `TYPE_CFG` (notifications.tsx) so it renders grey under "Activity" not "Sessions".
  - Part 3: settings.tsx "Blocked users" section (unblock own rows). Tested: unblock works, users reappear. Blocked names/pics now resolve via `public_profiles` (users RLS blocks reading other people's rows directly) — verified showing real names + photos. Commit `6cee65e`.
  - Earlier post-unblock "breakage" (empty messages/stuck chat/empty availability) was **stale state — resolved by restart, not a real bug.**
- **RED #3 — In-app legal screens — ✅ DONE (code side).** settings.tsx Terms/Community/Privacy links + delete-account support email swapped `guineapig.beauty` → `guineapigapp.co.uk`. Commit `74a83ce`, pushed. **Still needed (web/hosting, not app code):** `guineapigapp.co.uk/{terms,community,privacy}` must serve live pages, and `support@guineapigapp.co.uk` must be a live mailbox.

---

## 🔴 IMMEDIATE NEXT STEPS
1. ~~Finish testing Part 2b auto-cancel~~ — ✅ DONE (tested both directions, passing). RED #2 (blocking) now fully done + tested.
2. ~~Push the `public_profiles` fix~~ — ✅ pushed (commit `6cee65e`).
3. ~~Add `session_cancelled` to `TYPE_CFG`~~ — ✅ DONE (groups under Treatments with a close-circle icon).

## 📌 PARKED / SMALLER GAPS
- ~~Messages unread badge stale~~ — ✅ FIXED: messages list reloads on focus + unread only counts readable (`accepted`) sessions; HeaderIcons dot likewise. Cancelled/declined convos also hidden from the list. Commit `a512735`, pushed.
- **Legal pages must serve live content:** links now point at `guineapigapp.co.uk/{terms,community,privacy}` — those pages must actually exist/serve content, and `support@guineapigapp.co.uk` must be a live mailbox. Hosting task, not app code.
- Store gates: ✅ **18+ age confirmation** + ✅ **Terms/Privacy acceptance tick** now both live at signup — two required checkboxes in `src/screens/auth/SignupScreen.tsx` (records `age_confirmed` + `terms_accepted` in signup metadata; Terms/Privacy links open the guineapigapp.co.uk pages). ⚠️ The app renders `src/screens/auth/*` via `AppEntry`. ✅ **iOS camera/photo/location permission strings** added (app.json, commit `7c5937e`) — **all code-side store gates now cleared.**
- Paste 5 branded email templates into Supabase.

## ✅ ALSO DONE THIS SESSION (pink restyle + review flow)
- **App-wide pink restyle** — new design system (Fredoka display font, Quicksand body, pink palette in `Colors.ts` + Radius/Spacing/Shadow tokens) swept across every screen + component; dead `app/(auth)/*` + `app/index.tsx` routes deleted; native `expo-linear-gradient` dropped (replaced with soft-pink header bands so no dev-client rebuild is needed). Merged to `main`. UI reference doc: `mobile/UI-STYLE-GUIDE.md`.
- **Treatments-to-review prompt** (commit `fb6269e`) — both dashboards list completed sessions the current user hasn't reviewed, linking to leave-review with the right direction; dashboards now refresh on focus so the prompt clears after reviewing. Fixes the review being orphaned once completed chats are hidden from Messages.
- **Chat completed-state safe-area** fix; **`session_cancelled` notification icon** added.
- Confirmed **no calendar bug**: completing a booking already frees its slot (the `taken_slots` RPC counts only pending/accepted); `is_taken` is dead code.

## 🔴 LAUNCH CHECKLIST (mostly operational, long lead times)
- **#1 rejection risk = PAYMENTS/IAP:** model sub + provider fee unlock in-app features → Apple may require IAP on iOS (grey zone). DECIDE before iOS submit; consider asking Apple App Review directly. Don't guess.
- Swap Stripe TEST→LIVE keys (mobile .env pk_live + edge fn STRIPE_SECRET_KEY sk_live).
- Re-enable email confirmation.
- ICO registration (~£47/yr Tier 1, self-serve) — do before processing real user data; add a data-complaints route (ack within 30 days, new rule 19 Jun 2026).
- Solicitor: review ToS/privacy/consent (unqualified-practitioner model + identity selfies = special-category/Article 9 risk; define selfie retention period). Ltd company done.
- Insurance: public liability + professional indemnity.
- Production EAS build tested off dev machine (currently Metro tunnel) + 2nd physical device.
- App strengths to highlight in store review notes: identity verification, reviews, in-app report + block, moderation queue, consent gate, 18+.

## OUTPUT FILES FROM THIS SESSION (in /mnt/user-data/outputs)
- guinea-pig-email-templates.html — 5 branded Supabase auth email templates.
- guinea-pig-example-policies.md — illustrative ToS/Privacy/Consent drafts (NOT legal advice, for solicitor briefing).
- guinea-pig-store-compliance-checklist.md — Apple + Google pre-submission checklist tailored to the app.
