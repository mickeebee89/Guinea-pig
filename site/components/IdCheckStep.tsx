import Link from 'next/link'
import { SelfieCapture } from '@/components/SelfieCapture'
import type { IdCheck } from '@/lib/queries/idCheck'

/**
 * The ID check, for both roles and both surfaces. Audit item 82.
 *
 * ── ⚠️ THE RULE THIS USED TO CARRY IS GONE. 6 Nov 2026. ───────────────────
 * This file said: "There must be no standalone 'get verified' entry for a
 * model, and this component must never be rendered on one." The reason was
 * that the app's old "Get verified" buttons produced accounts that were
 * verified but not subscribed — people who had done the work and still could
 * not apply.
 *
 * That was a real problem when it was written. It is not the problem now: a
 * verified-but-unsubscribed account is the warmest lead on the platform. The
 * ID check is now available any time after signup, on /verify, for everyone,
 * and the £4.99 membership is the LAST gate before applying rather than the
 * first.
 *
 * ⚠️ THIS REMOVES AN OBSTACLE BEFORE ANYONE REACHES IT. IT DOES NOT RECOVER
 * LOST CONVERSIONS AND MUST NOT BE DESCRIBED AS DOING SO. Thirty days to
 * 6 Nov 2026: 1,180 homepage visitors, 279 reached /sign-up, 107 reached a
 * dashboard, 43 browsed, 32 opened a stylist, 1 reached the apply flow — with
 * 7 pageviews against that 1 visitor, which is testing. /subscribe has had 2
 * visitors ever. All 55 real model accounts are unverified and unsubscribed
 * because none of them has been asked, not because any refused: the membership
 * wall has been rendered to almost nobody, and one real bookable slot has ever
 * existed before 5 Nov 2026 (posted 24 Oct for 28 Oct, passed unbooked). The
 * gain is that a new model has something to do on day one.
 *
 * ── ONE RENDERER, TWO AXES ────────────────────────────────────────────────
 * `surface` is WHERE it is: inside the apply flow, or on its own page.
 * `photoHref` is WHOSE it is: a model sets her photo on /profile, a stylist
 * sets his on /shop. They are independent — a model meets this component in
 * both places.
 *
 * /verify had its own copy of this screen until today. Two renderings of one
 * thing, on two surfaces, with nothing showing them side by side, is how the
 * four steps come to say different words in each — and a member told to write
 * something different from what the reviewer is looking for gets rejected for
 * following our own instructions.
 *
 * ── THE FOUR STATES ───────────────────────────────────────────────────────
 * none      take the photo
 * rejected  the reviewer's note, then take another — the note is the only
 *           thing that makes a rejection fixable
 * pending   nothing to do; a person looks at it
 * approved  rendered on `page`; on `apply` the flow has already moved past it
 *
 * ── THE WORDING IS NOT MINE, AND THE STANDARD IS "SAY LESS THAN IS TRUE" ──
 * A person compares a selfie holding a handwritten note against the profile
 * photo. It shows a real person made the effort and that the photo is not
 * lifted from somewhere else. It is NOT identity verification — no document is
 * requested, seen or kept.
 *
 * A model weighs this when deciding whether to be alone with a stranger.
 * Someone who believes a passport was checked accepts a risk they would not
 * otherwise accept, on the strength of our wording.
 */

/** Whose photo it is compared against, and where they go to set one. */
const PHOTO = {
  '/profile': {
    heading: 'Add a profile photo first',
    body: 'A person compares your ID check photo against your profile photo — so there has to be one to compare it with. It’s also the first thing a stylist sees of you.',
    alsoDoneBy: 'Stylists do this too, before their shop can go live. It’s once per account, and it’s the reason both of you can trust who you’re meeting.',
  },
  '/shop': {
    heading: 'Add a photo of yourself first',
    body: 'A person compares your ID check photo against the photo on your shop — so there has to be one there to compare it with. It only takes a moment, and it’s the same photo models see when they’re deciding whether to apply to you.',
    alsoDoneBy: 'Models do this too, before they can apply to you. It’s once per account, and it’s the reason both of you can trust who you’re meeting.',
  },
} as const

/** What "afterwards" means, which differs by where she is standing. */
const SURFACE = {
  apply: {
    // ⚠️ NOT "One last thing" any more. It was, while the ID check was the
    // last gate; since 6 Nov 2026 it is the FIRST and the membership wall is
    // the one that says "one last thing". Two screens in one flow both
    // claiming to be the last step is how someone stops believing either.
    takeHeading: 'First, your ID check',
    afterPhoto: 'Come back to your application afterwards — everything you’ve filled in is kept.',
    whilePending: ' You can carry on and come back to your application once it’s done.',
  },
  page: {
    takeHeading: 'Take your ID check photo',
    afterPhoto: 'Come back here once it’s saved. Nothing else about your ID check changes.',
    whilePending: '',
  },
} as const

export function IdCheckStep({
  check,
  hasProfilePic = true,
  surface = 'apply',
  photoHref = '/profile',
}: {
  check: IdCheck
  /**
   * ⚠️ Her ID check photo is compared against her profile photo, so there has
   * to be one. Defaulted true so an older caller renders exactly as before —
   * the server refuses either way (submitSelfie, item 101), and this only
   * decides whether she finds out before or after taking the selfie.
   */
  hasProfilePic?: boolean
  /** Inside the apply flow, or standing on /verify. Changes only the copy. */
  surface?: keyof typeof SURFACE
  /** '/profile' for a model, '/shop' for a stylist. */
  photoHref?: keyof typeof PHOTO
}) {
  const photo = PHOTO[photoHref]
  const where = SURFACE[surface]

  // Rendered on /verify, where someone can arrive after the fact and wonder
  // whether it went through. Inside the apply flow the gate has already let
  // her past, so this never shows there.
  if (check.state === 'approved') {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">Passed</h2>
        <p className="mt-1 text-sm text-muted">
          Your ID check is done. There’s nothing to send again.
        </p>
      </section>
    )
  }

  if (check.state !== 'pending' && !hasProfilePic) {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">{photo.heading}</h2>
        <p className="mt-2 text-sm text-muted">{photo.body}</p>
        <Link
          href={photoHref}
          className="mt-5 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
        >
          Add your photo
        </Link>
        <p className="mt-4 text-xs text-muted">{where.afterPhoto}</p>
      </section>
    )
  }

  if (check.state === 'pending') {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">Your photo is with us</h2>
        <p className="mt-2 text-sm text-muted">
          A person looks at these — not a computer — usually within 24 hours. There’s nothing else
          for you to do, and we’ll let you know either way.{where.whilePending}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-5">
      <h2 className="font-display text-xl text-warm-dark">
        {check.state === 'rejected' ? 'That one didn’t pass' : where.takeHeading}
      </h2>

      {check.state === 'rejected' && (
        <p className="mt-2 rounded-md bg-input-bg px-3 py-2 text-sm text-warm-dark">
          {check.note
            // The reviewer's note is the only thing that makes a rejection
            // fixable. Without it someone retakes the same unusable photo.
            ? <>The reviewer said: “{check.note}”</>
            : <>We couldn’t accept the last one. Have another go, following the steps below.</>}
        </p>
      )}

      <p className="mt-3 text-sm text-muted">
        A selfie holding a handwritten note, looked at by a person. It shows there’s a real person
        behind the account and that your profile photo hasn’t been taken from somewhere else.{' '}
        <span className="font-bold text-warm-dark">It isn’t an identity check</span> — nobody sees a
        passport or a driving licence, and no document is kept.
      </p>

      {/* ⚠️ One list, now that there is one renderer. These four lines are what
          the reviewer is looking for, so they must not differ by surface or by
          role — someone rejected for following a different version of our own
          instructions has no way to find that out. */}
      <ol className="mt-4 space-y-2 text-sm text-muted">
        {[
          'Make sure your profile picture clearly shows your face — we compare it to this photo.',
          'Write your first name and “Cavy” on a piece of paper.',
          'Take a photo holding the paper up, with your face and the writing both visible.',
          'Send it. A person reviews it, usually within 24 hours.',
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[999px] bg-soft-pink text-sm font-bold text-rose"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-sm text-muted">{photo.alsoDoneBy}</p>

      <p className="mt-3 text-xs text-muted">
        On a phone this opens the camera. On a computer it opens your files, so have the photo
        ready.
      </p>

      <div className="mt-5">
        <SelfieCapture retake={check.state === 'rejected'} />
      </div>

      <p className="mt-4 text-xs text-muted">
        We keep the photo for up to 90 days after the check, or until you delete your account —{' '}
        <Link href="/privacy" className="font-bold text-rose hover:underline">
          Privacy
        </Link>{' '}
        explains what happens to it.
      </p>
    </section>
  )
}
