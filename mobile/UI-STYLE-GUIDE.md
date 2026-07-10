# Guinea Pig — UI / Design System Reference

A description of the current mobile app UI (React Native / Expo, Android-first). Aesthetic:
**soft, playful, feminine "pink" theme** on a near-white pink-tinted background, rounded
shapes, chunky friendly headings, white cards with soft shadows. Mascot: a dusty-rose
(mauve) cartoon **guinea pig**. App name "Guinea Pig App", tagline "Someone's gotta be the
guinea pig."

Source of truth in code: `src/constants/Colors.ts` (tokens), `src/components/` (shared
components), `src/app/(app)/` + `src/screens/auth/` (screens).

## Colour tokens

| Token | Hex | Use |
|-------|-----|-----|
| primary pink (`rose`) | `#DB4B86` | CTAs, active states, links, wordmark, verified ticks, unread accents |
| deep pink (`roseDark`) | `#C23A71` | pressed / darker CTA, icon accents |
| soft pink (`softPink`) | `#FFE3EF` | light accent fills, inactive chips, header bands, avatar placeholders |
| category accent | `#F5388F` | treatment category chips/stripes (unified pink) |
| page bg (`cream`) | `#FFF7FA` | very light pink page background |
| card (`white`) | `#FFFFFF` | card / surface backgrounds |
| heading text (`warmDark`) | `#2B2531` | near-black plum, primary text + headings |
| secondary text (`muted`) | `#6E6675` | captions, meta, placeholders |
| border | `#F6E1EA` | soft pink hairline borders |
| input bg (`inputBg`) | `#FFF0F6` | text inputs, chips, badges |
| error | `#DC2626` | error states only |
| star amber | `#F59E0B` | star-rating icons only |

## Typography

- **Display / big titles / wordmark:** `Fredoka` (SemiBold 600) — chunky, rounded, playful.
  Used for page titles ("Dashboard"), the "Guinea Pig App" wordmark, hero names — often in
  primary pink.
- **Section titles / subheads:** `Quicksand` Bold (700), ~18px, in warmDark.
- **Body / labels:** `Quicksand` Regular (400) / Bold (700), 13–16px.
- Type scale (approx): display 28–32 · h1 24 · section 18 · body 14–15 · caption 11–13.

## Shape, elevation, spacing

- **Radius:** sm 10 · md 14 · **lg 20** (cards) · xl 28 · pill 999 (buttons).
- **Cards:** white bg, radius ~18–20, 1px `border` hairline, soft shadow (subtle pink or
  neutral), padding 12–16.
- **Shadows:** soft — either a faint pink glow (primary buttons) or a low-opacity neutral lift.
- **Spacing scale:** 4 · 8 · 12 · 16 · 20 · 24.
- Page horizontal padding ~16–24.

## Core components

- **Primary button:** full-width pink pill (radius ~20), white Quicksand-Bold label, soft pink
  glow shadow. Secondary = soft-pink fill with pink label. Ghost = transparent, pink label.
- **Text input:** pink-tint fill (`inputBg`), rounded (radius 14), 1.5px border that turns pink
  on focus; label above in muted bold; optional show/hide eye for passwords.
- **Chips / pills:** inactive = soft-pink/inputBg fill with muted or pink text + pink outline;
  active/selected = solid pink fill with white text. Used for filters, categories, distance.
- **Cards:** white rounded cards with soft shadow + pink hairline border (dashboard cards,
  session cards, review rows, stat tiles).
- **Header icons:** white circular buttons (chat, bell, settings) with a small pink dot/badge
  for unread; profile avatar (circular) at far right with a pink verified check overlay.
- **Avatars:** circular; image or soft-pink placeholder with the person's initial in pink.
- **Verified tick:** pink `checkmark-circle`.
- **Segmented toggle / switches:** pink when active.
- **Consent checkbox:** rounded square, pink fill + white check when ticked (signup 18+/terms,
  application consent gate).
- **Header bands:** some screens (signup, get-verified, profiles) have a soft-pink top band.

## Navigation & structure

- **Auth flow** (pre-login) is a custom in-app flow: Welcome → Login / Signup → Confirm email
  (`src/screens/auth/*`), no URL routing.
- **Post-auth** uses an Expo Router stack rendered over a faint scattered-motif **wallpaper**
  (`PatternBackground`), inside a rounded bordered "card" container.
- **No bottom tab bar.** Navigation is via the header icons (messages, notifications), the
  profile avatar, and push navigation from cards/buttons.

## Screen inventory

**Auth**
- **Welcome:** centered mascot (guinea pig) on a soft-pink circle, "Guinea Pig App" Fredoka
  wordmark in pink, tagline, "I want to be a…" prompt + two role cards (Stylist / Model) as
  large pink filled cards with emoji, subtitle, chevron; "Already have an account? Log in".
- **Login / Signup:** name (first + last initial), email, password fields; signup has a
  soft-pink header band, a role pill, and two required checkboxes (18+ confirmation, agree to
  Terms/Privacy with tappable links). **Confirm email** screen after signup.

**Model (client) side**
- **Dashboard (home):** "Dashboard" pink Fredoka title + header icons + profile avatar; sections:
  Upcoming treatments (horizontal cards), Needs your attention (pending applications, stylist
  invites, **treatments to review**), Favourites (horizontal strip), Nearby stylists (search bar
  + Filter chip → category/distance/verified filters + horizontal stylist cards), Subscription,
  Your impact (stat tiles).
- **Stylist profile:** soft-pink hero band, large avatar, name + pink verified tick, stat row
  (treatments · rating · reviews · response), pink "Book with…" button, About, Portfolio grid,
  reviews.
- **Filters:** grouped chip sets (hair colour / type / length, skin tone, distance pills,
  "Verified only" toggle) + a pink "Show N stylists" button.
- **Apply / booking:** multi-step (treatment → time slot → confirm); time-slot chips, patch-test
  consent gate, "Application sent!" success screen.

**Stylist (provider) side**
- **Dashboard:** "Dashboard" + "Welcome back, {name}"; Shop-status live toggle card; stat tiles
  (Treatment history · Rating · Portfolio); Applications list; Upcoming treatments (horizontal);
  **Treatments to review**; Quick links (Manage availability · View shop · Edit shop); Nearby
  models strip.
- **Model profile:** hero name, pink verified badge, attribute chips (hair / skin / eyes /
  nails), photo gallery, reviews, review button.
- **Availability:** multi-step editor with a **month calendar** (available vs selected days in
  pink) and per-day half-hour time slots.
- **Edit shop / Portfolio:** forms + image grids.

**Shared**
- **Chat:** header (avatar, name, date, ⋮ menu → Block / Report / Mark complete); "Keep chats in
  Guinea Pig" safety banner; message bubbles (**sent = pink**, **received = white** with sender
  avatar), date separators, read receipts; bottom input bar when active, or a "Leave a review"
  button when completed, or a "You can't message this user" bar when blocked.
- **Messages list:** conversation rows (avatar, name, last-message preview, time, pink unread
  badge). Hides finished/cancelled/declined threads.
- **Notifications:** filter tabs (All / Treatments / Activity); cards with a coloured icon,
  title, body, relative time; unread = soft-pink card with a pink left accent + pink title;
  some cards have a "⭐ Leave a review" CTA.
- **Leave a review:** star rating, sub-ratings, tag chips, comment; "Review model" or "Leave a
  review" depending on direction.
- **Settings:** profile header + edit rows, notification toggles, blocked-users list, legal
  links, delete account.
- **Subscribe / Get verified:** soft-pink header, price emphasis, pink CTA (£4.99/mo model sub;
  £14.99 one-off provider verification).
- **Sessions / Treatment history:** status pills, chat/review actions.

## Notes for a redesign tool

- Keep the **mascot** and app name as-is (dusty-rose guinea pig, "Guinea Pig App").
- The look is **light-mode only** currently.
- Everything is **token-driven** — recolouring is a single-file change (`Colors.ts`), so a new
  palette can be applied globally without touching screens.
