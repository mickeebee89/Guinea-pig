import Link from 'next/link'
import { SelfieCapture } from '@/components/SelfieCapture'
import type { IdCheck } from '@/lib/queries/idCheck'

/**
 * The ID check, as a step inside the apply flow. Audit item 82.
 *
 * ── WHY IT IS A STEP AND NOT A PAGE ───────────────────────────────────────
 * ⚠️ There must be no standalone "get verified" entry for a model, and this
 * component must never be rendered on one. The app had those buttons and they
 * were removed because they produced accounts that were verified but not
 * subscribed — people who had done the work and still could not apply.
 * /verify keeps refusing model accounts for that reason, and says so.
 *
 * The rule is also enforced in submitSelfie(): a model with no active
 * membership is refused there, on the server, so a UI mistake cannot
 * re-create those accounts.
 *
 * ── THE FOUR STATES ───────────────────────────────────────────────────────
 * none      take the photo
 * rejected  the reviewer's note, then take another — the note is the only
 *           thing that makes a rejection fixable
 * pending   nothing to do; a person looks at it
 * approved  never rendered; the flow moves past this step
 *
 * ── THE WORDING IS NOT MINE ───────────────────────────────────────────────
 * It matches the dashboard's, deliberately: "a selfie holding a handwritten
 * note, looked at by a person… It is not an identity check — nobody sees a
 * passport or a driving licence." The product calls this an ID check and the
 * audit already found the app calling it "identity verification" in three
 * places, which claims something nobody does.
 */
export function IdCheckStep({
  check, hasProfilePic = true,
}: {
  check: IdCheck
  /**
   * ⚠️ Her ID check photo is compared against her profile photo, so there has
   * to be one. Defaulted true so an older caller renders exactly as before —
   * the server refuses either way (submitSelfie, item 101), and this only
   * decides whether she finds out before or after taking the selfie.
   */
  hasProfilePic?: boolean
}) {
  if (check.state !== 'pending' && !hasProfilePic) {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">Add a profile photo first</h2>
        <p className="mt-2 text-sm text-muted">
          A person compares your ID check photo against your profile photo — so there has to be
          one to compare it with. It’s also the first thing a stylist sees of you.
        </p>
        {/* Her page, not the stylist's. The same gate sends a stylist to
            /shop, because that is where hers lives. */}
        <Link
          href="/profile"
          className="mt-5 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
        >
          Add your photo
        </Link>
        <p className="mt-4 text-xs text-muted">
          Come back to your application afterwards — everything you’ve filled in is kept.
        </p>
      </section>
    )
  }

  if (check.state === 'pending') {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">Your photo is with us</h2>
        <p className="mt-2 text-sm text-muted">
          A person looks at these — not a computer — usually within 24 hours. There’s nothing else
          for you to do, and we’ll let you know either way. You can carry on and come back to your
          application once it’s done.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-5">
      <h2 className="font-display text-xl text-warm-dark">
        {check.state === 'rejected' ? 'That one didn’t pass' : 'One last thing: your ID check'}
      </h2>

      {check.state === 'rejected' && check.note && (
        <p className="mt-2 rounded-md bg-input-bg px-3 py-2 text-sm text-warm-dark">{check.note}</p>
      )}

      <p className="mt-3 text-sm text-muted">
        A selfie holding a handwritten note, looked at by a person. It shows there’s a real person
        behind the account and that your profile photo hasn’t been taken from somewhere else.{' '}
        <span className="font-bold text-warm-dark">It isn’t an identity check</span> — nobody sees a
        passport or a driving licence, and no document is kept.
      </p>

      {/* ⚠️ The four steps are /verify's, word for word (page.tsx:134-138).
          A model told to write something different from what the reviewer is
          looking for gets rejected for following our own instructions, and the
          rejection note is the only thing that would tell her why. */}
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

      <p className="mt-4 text-sm text-muted">
        Stylists do this too, before their shop can go live. It’s once per account, and it’s the
        reason both of you can trust who you’re meeting.
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
