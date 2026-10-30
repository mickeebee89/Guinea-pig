/**
 * ONE DEFINITION OF THE PINK PILL, because there were about to be two.
 *
 * RoleGate's Panel renders the pill as a <span> inside a <Link>: there, the
 * whole card is the control, so the pill deliberately carries no hover and no
 * focus ring of its own — the card owns both. /for-stylists needed the same
 * pill as a real link, which does need them.
 *
 * Written out twice, those two would have drifted apart on the first restyle —
 * one of them silently, because nothing renders them side by side. So the
 * shared half is named once here, and the interactive half is added only where
 * the pill IS the control.
 *
 * ⚠️ THIS IS NOT A REPO-WIDE BUTTON SYSTEM, and should not be read as the start
 * of one. There are ~40 hand-written variants of this pill across app/(app).
 * This covers the public marketing pages, which is where a second definition
 * was about to appear. Widening it is a separate job with a separate review.
 *
 * ⚠️ Keep every class name written out in full in the literals below. Tailwind
 * finds classes by scanning source text, so a name assembled at runtime from
 * fragments is a class that never gets generated.
 */

/** The pill's look. Use this when something ELSE is the clickable control. */
export const PILL_PRIMARY =
  'inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white'

/** The pill when the pill itself is the link or the button. */
export const PILL_PRIMARY_CONTROL = [
  PILL_PRIMARY,
  'transition-colors hover:bg-rose-dark',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose',
].join(' ')
