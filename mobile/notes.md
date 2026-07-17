# Guinea Pig — App State Notes

Quick current-state snapshot of the mobile app. Durable stack/schema lives in `CLAUDE.md`; blow-by-blow session history lives in `guinea-pig-handover.md`. This is the "where is the app right now" reference.

_Anchored to latest commit `f5eef16`._

---

## What works today (ground-truth flows)

### Auth / onboarding
- **Signup** via `WelcomeScreen` (pick Model or Stylist) → `SignupScreen` (rendered by `AppEntry`, not a route). Collects first name, **full last name (private)**, email, password+confirm, **18+** and **Terms/Privacy** checkboxes (both required).
- Public identity = **first name + surname initial** ("Sarah B."). The **full surname is stored privately** (`users.last_name`, never in `public_profiles`); the public `last_initial` is derived from it at signup.
- **Name is locked** after signup — first name + last initial are read-only in Settings (fixed identity); only bio/email/password are editable.
- **Email confirmation is OFF** for testing → signup drops straight into the app. ⚠️ Re-enable before launch (`ConfirmEmailScreen` flow exists and is wired).
- `ensureProfile` self-heals a missing `users`/`providers` row from auth metadata; the `auth.users` trigger `handle_new_auth_user` is the primary row creator.

### Model journey
- **Free browse:** model home ("Dashboard"), search + distance filters (**'Any'** default), nearby **published** stylists, favourites (heart), view a stylist shop (bio, availability, treatments, portfolio, reviews).
- **Apply gate:** must have an **active subscription (£4.99/mo)** AND **identity verification** — otherwise routed to `/subscribe` then `/verify-payment`.
- **Apply wizard (7 steps):** date → time slot → treatment → note → photos → ConsentGate → review+confirm (patch-test tick) → creates a `sessions` row (`status='pending'`).
- Model profile (`model_attributes`: hair/skin/etc.), reviews, settings.

### Stylist journey
- Lands on **provider dashboard**. Shop starts **Offline**.
- **£14.99 pay-first verification** (`verify-payment`): pay → selfie → admin approves → `is_verified` + `is_published` set by admin. Identity selfie is **shared** (one per person; models verify free, no £14.99).
- **Shop setup** (`edit-shop`): display name, bio, location, treatment **categories** (Nails/Lashes/Brows/Hair/Makeup/Spray Tan). Note: treatments are category-only in the mobile UI (`name`==`category`; no per-treatment price/colour field).
- **Availability** wizard: dates → treatments per day → half-hour slots (07:00–22:00) with per-slot treatments; booked slots are protected from deletion.
- **Publish gate (see Gates below).**

### Booking / lifecycle (both parties)
- `sessions.status`: `pending → accepted|declined → completed`, plus `cancelled` (only via block auto-cancel).
- Stylist **Accepts/Declines** (dashboard Applications or Sessions screen) and **Marks complete**; each transition notifies the model.
- **Reviews are bidirectional** (model↔stylist) after completion; "Treatments to review" prompt on both dashboards.

### Messaging
- Chat is **gated on session status**: locked while `pending`, live when `accepted`, read-only when `completed`. Realtime send/receive + read receipts. Message text column is `messages.body`.
- Conversation list excludes completed/cancelled/declined; unread badge only counts readable (`accepted`) sessions; reloads on focus.

### Safety
- **Mutual block** (`blocks` table, either direction) from the chat ⋮ menu → **auto-cancels** pending/accepted sessions between the pair → sends a neutral **"Booking cancelled"** notification to the **other party only** (never mentions blocking). Unblock in Settings.
- **Block filtered on 6 surfaces:** model browse, messages list, chat (read-only "You can't message this user"), provider profile Apply, stylist's pending applications, Settings blocked-list.
- **Report** from chat ⋮ → free-text reason modal → `reports` row (`status='open'`) → shows in admin Reports.

### Account
- **Delete account:** two-tap confirm → `delete-account` edge fn (JWT-derived id, full FK-safe cascade + storage + auth user last) → signed out. **Also cancels the user's Stripe subscription** (keeps the Stripe customer/invoices for tax/legal) before erasing.

### Payments / billing (Stripe — TEST mode)
- **£14.99 provider fee** + **£4.99/mo model sub** via the `stripe-payment` edge fn (pay-first for providers). Successful payments are recorded server-side (`verification_payments` / `subscriptions`) with **errors surfaced** — the client never reports success on a failed write (a failed record shows a Retry screen; the money is never re-charged).
- **Cancel subscription = end-of-period:** calls Stripe `cancel_at_period_end`, sets `subscriptions.status` + `users.subscription_status='cancelling'`; access continues until `current_period_end`, then the apply gate blocks. Settings shows "Ends on {date}".
- **`users.subscription_status` is CHECK-constrained** to `['none','trialling','active','cancelled','cancelling']` (British spelling). `'none'` = no sub (NOT `'free'`). Writing a value outside this set fails — that's what silently broke the first cancel attempt (wrote `'canceling'`).
- **No Stripe webhook handler exists** — state is reconciled at write time and cancellation expiry is **date-driven** (`hasActiveSubscription` checks `current_period_end` for canceling subs).
- Failed Stripe cancel during account delete → logged to `admin_audit_log` (`billing_orphan_on_delete`); erasure still proceeds.

### Admin (web app, separate — repo root Next.js)
Verification queue, Reports, Moderation, Users (with **Free access / waive-fee** toggle + Fee status column, full-surname visible), Waitlist, Revenue, Audit log, Settings (founding-provider limit/toggle).

---

## Key gates (business rules)
- **Model can apply** ⇢ `active subscription` **AND** `is_verified`.
- **Stylist can publish a shop** ⇢ `is_verified` **AND** `feeSettled` **AND** `≥1 treatment`, where **`feeSettled = has a verification_payments row (£14.99) OR is_founding_provider OR provider_fee_waived`**. _(This closed the publish-without-paying loophole — identity alone is no longer enough.)_
- **One email = one account** (Supabase `auth.users`). A `role='both'` value exists and the Settings "Mode" switcher reads it, but **nothing in-app writes it** — it's DB-only. (An in-app "become both roles" opt-in was investigated and **deliberately dropped**.)

---

## Recent changes (latest first)
- **Stripe monthly price env-var'd (go-live prep).** `stripe-payment` now resolves the £4.99/mo price from `STRIPE_MONTHLY_PRICE_ID` (real `price_...` id) instead of `prices.retrieve('guinea_pig_monthly_499')` — that string was never a valid price id so the retrieve always missed and a new Product+Price was spawned on **every** signup. Fallback when the secret is unset: a lookup_key find-or-create that reuses one price (also fixes the duplicate bug). **Go-live:** create the live £4.99/mo GBP recurring Price, `supabase secrets set STRIPE_MONTHLY_PRICE_ID=price_...`, redeploy. Confirmed the app uses **standard Stripe** (PaymentIntents + Subscriptions, we're MoR) — activate standard, NOT Managed Payments. Code committed; **not yet deployed**.
- **P6 — Auth UX: email read-only + dedicated forgot-password screen DONE + verified.** Client-side JS only. `settings.tsx`: email Row made read-only (dropped `onPress`, mirrors the locked name rows) + dead-email cleanup (`EditField`→`'bio'`, email branch/modal conditionals removed; bio still edits). New `src/screens/auth/ForgotPasswordScreen.tsx`: email-only reset entry point (no password field) with presence+`@` validation and a persistent "Check your email" confirmation; reset handler moved out of LoginScreen (same web-reset `redirectTo`). Wired via a new `'forgot-password'` view + `forgotEmail` state in `AppEntry.tsx`; Login's "Forgot password?" now calls `onGoForgot(email)` (email prefilled on the new screen).
- **P5 — Notification-type audit + removed all notification toggles DONE + verified.** Audited every notification `type` (created vs handled) — **no create/handle typo mismatches remain**. Fixed: `new_availability` insert now carries `data.provider_id` so its tap opens the shop; `admin_warning`/`admin_message` got inbox icons; `admin_warning` gained a tappable "About this warning" explanation modal + card line. `review_reminder` is created nowhere (dead) — left routing/icon latent, removed only its toggle. **Removed the entire Notification preferences section** from `settings.tsx` (the 3 toggles were essential / dead / mislabelled; no real marketing type exists) and **removed the `send-push` preference gate + redeployed** so stored `promotions:false` prefs can't keep silently suppressing pushes. `notification_preferences` column left in place, now unread. Verified on device incl. a push arriving on a `promotions:false` account.
- **P4 — Completed-chat visibility + realtime unread badge DONE + verified on two phones.** A four-symptom cluster that collapsed to two root causes. **Client-side JS only** (no SQL/edge/rebuild — `messages` was already in the realtime publication; RLS on `messages` is participant-scoped, not status-scoped). Root cause A ("completed = invisible & unreachable"): the inbox query bucketed `completed` with `cancelled`/`declined` and filtered it out, even though completed chats stay readable (chat screen loads `accepted||completed` read-only) and reachable via the accepted-notification deep-link. Root cause B ("badge focus-polled, not realtime"): `HeaderIcons`/`messages.tsx` recalculated only on `useFocusEffect`; the only realtime sub lived in the chat screen. **Fixes** (`messages.tsx` + `HeaderIcons.tsx`): (1) inbox filter now excludes only `(cancelled,declined)` so completed returns; (2) unread gate counts `accepted`+`completed` (matches HeaderIcons) so the stuck dot can clear — opening the now-reachable completed chat runs the existing mark-as-read; (3) completed chats grouped under a collapsible **"Past chats"** section (`FlatList`→`SectionList`), rows shown read-only with a check badge + "Completed" tag instead of the lock; (4) both `messages.tsx` and `HeaderIcons` subscribe to `messages` postgres_changes (unique channel per mount, 300 ms debounce) → live badge. **Bug 4 diagnosis: saved-but-hidden, not dropped** (message insert has no status guard, RLS isn't status-scoped) — surfacing completed chats reveals it; no code change. **Verified two-phone:** completed chat in Past chats read-only ✅, stuck dot clears on open + stays clear ✅, realtime badge live on model home + provider dashboard ✅, at-completion message present ✅. We deliberately do NOT force-mark-read on completion (would falsely clear the other party's genuine unreads).
- **`588107d`/`f5eef16` — Push notifications (P3) DONE + verified on two real devices.** OS push that reaches a CLOSED app, on top of the existing in-app notifications. Architecture: DB `AFTER INSERT` trigger on `notifications` (covers all existing types) + one on `messages` (new-message, resolves recipient + sender) → `pg_net` → **`send-push` edge fn** (secret-guarded `x-push-secret`, respects `notification_preferences`, batches to Expo push API, prunes `DeviceNotRegistered`). Client (`lib/push.ts`): `expo-notifications` registers a per-device token into `push_tokens` on login, foreground handler (v56 `shouldShowBanner/shouldShowList`), tap-routing shared with the in-app screen (`lib/notificationRouting.ts`); token cleared on sign-out. **Required a fresh EAS dev build** (native module) + **FCM** (Android `google-services.json` + FCM V1 key in Expo). **Verified two-phone, app closed:** new application ✅, accept/decline ✅, new message ✅, treatment completed ✅.
- **`b3d988c` — Password reset FIXED + verified end-to-end (launch blocker).** The reset link redirected to `guineapigapp://` (bare scheme) but the app is built with `scheme:"mobile"`, has no deep-link handler (`detectSessionInUrl:false`) and no in-app reset screen → blank page, account unrecoverable. Fixed via a **web reset page** (not native deep links): `web/auth-reset.html` hosted at `guineapigapp.co.uk/auth/reset` (supabase-js, **anon key only**, secured by the emailed recovery token) — new-password form → `updateUser()` → success; expired-link state. `LoginScreen.forgotPassword` now passes `redirectTo` to it. **Verified:** forgot-password → email → link → set new password → logged into the app with the new password. `SignupScreen` `emailRedirectTo` wired to `web/auth-confirmed.html` (a friendly landing) so signup-confirmation is ready when re-enabled. ⚠️ Change only took effect after `npx expo start -c` (stale bundle sent the old redirect). Native in-app reset (guineapigapp scheme + handler + screen) deferred post-launch.
- **`619d7ee` — Revenue now reads from STRIPE (source of truth); VERIFIED matching.** The page summed our DB tables, which can't equal the Stripe transaction list (`subscriptions` is one row per user = MRR not total collected; verification rows only exist for recorded charges; a stray `amount_pence` gave the £2.99). New admin-gated **`revenue_summary`** action in `stripe-payment`: lists every succeeded Stripe charge (paginated), nets refunds, classifies subscription (has an `invoice`) vs one-off verification, buckets today/week/month/all-time + recent list. Revenue page + dashboard render these. **Verified: page All-Time = Stripe exactly** — 11 × £14.99 = £164.89 verifications, 11 × £4.99 = £54.89 subscriptions (22 succeeded Stripe charges). `verification_payments`/`subscriptions` + RLS policies stay for Fee/`feeSettled`/funnel, just not revenue.
- **`5ef4180` + RLS fix — "£14.99 not recorded / £0 revenue" was NOT a write bug.** Payments were always recording (`verification_payments` had rows). Three causes stacked: **(1) RLS** — `verification_payments` had RLS **on with ZERO policies** (only the service-role edge fn could touch it), so the admin, the mobile "already paid?" check, and the dashboard `feeSettled` all read **nothing**; `subscriptions` SELECT was owner-only (no admin read). Fixed with two SELECT policies. **(2) Revenue read logic** — verification total only counted `selfie_status='passed'` (never set → always £0); now counts ALL payments (both Revenue page + dashboard). **(3) `confirm_subscription` never wrote `amount_pence`** → sub revenue £0; now writes amount/currency/plan (from the Stripe price) + existing rows backfilled. Also added a `create_verification_intent` dedupe so a stale client can't double-charge (that double-charge WAS the RLS bug — the client couldn't see its own payment row). Verified: admin Fee flips to **Paid** once the RLS policy is added.
- **`5f21c20` — Cancel bug root cause + cleanup (DONE + VERIFIED).** The cancel wrote `subscription_status='canceling'`, but `users.subscription_status` has a **CHECK constraint** that rejected it → the DB write failed (Stripe was already cancelled, so it looked half-done). Fixed by allowing the value; then standardised on **British `'cancelling'`** across code + DB, and replaced the app's stale `'free'` checks with the real values (`'none'`, `isPaid = active/trialling/cancelling`). Constraint migration applied in the live DB (`['none','trialling','active','cancelled','cancelling']`). **Verified on device + Stripe:** app shows "Ends on {date}", Stripe cancels at period end, DB persists `'cancelling'`.
- **`0db4cf4`** — **Subscription cancel + account delete now actually stop Stripe billing** (were local-flag-only / no-op). New `cancel_subscription` edge action (`cancel_at_period_end`, `status='canceling'`, access until period end); `delete-account` cancels the Stripe sub before the cascade, keeps the customer, logs an orphan to `admin_audit_log` on failure.
- **`154fbcf`** — **Fixed the £14.99 verification payment not recording.** `confirm_verification` inserted two non-existent columns (`stripe_payment_intent_id`/`currency`) and swallowed the error → charge succeeded, no row, payer locked out. Now uses `stripe_payment_id`/`currency_code`, captures the error, and the client shows a Retry screen instead of a false success.
- **`cc111dd`** — Fixed model→stylist application notification type (`session_application` → `session_applied`) so the stylist's "New application" push is tappable and routes to the dashboard.
- **`a226aab`** — Closed the £14.99 publish loophole: publish now requires `feeSettled` (dashboard toggle/Switch/banner), `verify-payment` lets a verified-unpaid provider pay the fee and skip the selfie, and the admin Users page gained a **Free access** toggle (`provider_fee_waived`) + Fee status. DB: `users.provider_fee_waived` added; 8 existing verified-unpaid providers backfilled to waived.
- **`b542670`** — Full surname collected privately + name locked; admin surfaces show full name + email + user_id (disambiguation).
- **Waitlist** — public signup edge fn `waitlist-signup` (CORS locked to guineapigapp.co.uk) + admin Waitlist page.

---

## Known issues / watch-list
- 🔒 **Email confirmation is OFF** — re-enable before launch, then re-test. The landing page (`web/auth-confirmed.html` at `/auth/confirmed`) + `SignupScreen` `emailRedirectTo` are already wired and the URL is in Supabase Redirect URLs, so re-enabling should just work (confirmation completes server-side; the page is a friendly landing).
- 💳 **Stripe is LIVE** — mobile `pk_live` in `.env` (local) + `eas.json` (preview + production); edge fns `stripe-payment` + `delete-account` on `sk_live` + live `STRIPE_MONTHLY_PRICE_ID` (`price_1Tu7cA…`). Standard Stripe, we're merchant of record (VAT/tax is ours). _(Keys swapped + functions redeployed; confirm with one real live transaction.)_
- 🧾 Mobile treatments are **category-only** (no per-treatment pricing/colour in the app UI).
- ⚠️ **No Stripe webhook** — payment/sub state is reconciled at write time; cancellation expiry is date-driven. Fine for now, but a webhook would be the robust long-term reconciler (e.g. external cancellations, failed renewals).
- ✅ ~~Provider "New application" notification not tappable~~ — **fixed** in `cc111dd`.
- ✅ ~~£14.99 payment succeeded but never recorded (payer locked out)~~ — **fixed** in `154fbcf`.
- ✅ ~~Subscription cancel + account delete didn't stop Stripe billing~~ — **fixed** in `0db4cf4`.

---

## Pre-launch checklist (operational, not code)
- ⚠️ **IAP decision** (Apple may require in-app purchase for the digital sub/unlock — grey zone; #1 rejection risk).
- Stripe TEST → LIVE keys.
- Re-enable email confirmation.
- ICO registration; solicitor review of ToS/privacy/consent (selfies = special-category); insurance.
- Paste the 5 branded email templates into Supabase.
- Production build tested on a 2nd physical device.

---

## Live DB changes (applied directly in Supabase — NOT versioned in the repo)
There are no migration files; schema changes are run by hand in the SQL editor. Recent ones to be aware of:
- `users.provider_fee_waived boolean not null default false` (admin free-access for the £14.99 gate) + backfill of existing verified-unpaid providers.
- `users.last_name text` (private full surname) + `handle_new_auth_user` trigger updated to populate it.
- `users.subscription_status` CHECK constraint standardised to `['none','trialling','active','cancelled','cancelling']`.
- `verification_payments` real columns are `stripe_payment_id` + `currency_code` (the edge fn was fixed to match). Also has a CHECK on `selfie_status` (`pending/passed/failed/locked/refunded`).
- **RLS read policies (critical — without these the admin + app see nothing):**
  - `verification_payments` had RLS ON with **no policies** → added `verification_payments_select_own` = `for select to authenticated using (user_id = auth.uid() or is_admin())`.
  - `subscriptions` had owner-only SELECT → added `subscriptions_select_admin` = `for select to authenticated using (is_admin())`.
  - Writes go through the service-role edge fn (bypasses RLS), so no INSERT policy is needed.
- `subscriptions.amount_pence` backfilled to 499 (+ `currency_code='GBP'`, `plan='monthly'`) for rows the old `confirm_subscription` left null.
- **Booking guard (see `supabase/booking-guard.sql`):** partial unique index `sessions_active_slot_uniq` on `sessions (provider_id, date, start_time) where status in ('pending','accepted')` — atomically blocks a second active booking for the same slot (double-booking race). Completed/declined/cancelled are excluded, so a slot re-opens once its booking ends.
- **Push (see `supabase/push-setup.sql`):** `push_tokens` table (+RLS `push_tokens_own`), `pg_net` enabled, and two `AFTER INSERT` triggers — `notify_push` on `notifications` and `message_push` on `messages` — both call the `send-push` edge fn via `net.http_post` with the `PUSH_HOOK_SECRET` (set via `supabase secrets set`; the trigger bodies hold the literal — re-paste from the secret, don't commit it).

## Testing quick-reference
- **No new APK for JS changes** — the installed **dev build** hot-loads JS via Metro. Reload with `npx expo start -c --dev-client` (the `-c` avoids stale bundles). Both phones need the dev client installed (same APK). A new EAS build is only needed for native changes.
- **Test card:** `4242 4242 4242 4242`, exp `12/34`, CVC `123`.
- **Accounts:** model `micky.buckfield@hotmail.co.uk` (subscribed + verified); stylist `micky.buckfield@gmail.com` (Micky B — now **fee-waived**) and `nahitih259@bevriz.com` (also waived). ⚠️ Both test stylists are waived, so **create a FRESH stylist to test the £14.99 loophole**.
- A full **two-phone (Model + Stylist) launch-readiness test plan** exists (Model onboarding → Stylist onboarding → Payments incl. the loophole tests → Booking → Messaging → Safety → Settings → Deletion), tagged launch-critical vs nice-to-check.
