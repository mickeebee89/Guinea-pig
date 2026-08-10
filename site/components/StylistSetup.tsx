import Link from 'next/link'
import type { StylistSetup } from '@/lib/queries/shop'

/**
 * The stylist's route from signing up to being findable.
 *
 * ── WHY A PANEL AND NOT A WIZARD ──────────────────────────────────────────
 * The steps are not strictly ordered — you can add treatments before writing a
 * bio — and one of them (the ID check) is finished by somebody else, on their
 * own schedule. A wizard would have to pretend that waiting is a step you take.
 * A panel says where you stand on all of it at once, which is the question a
 * stylist actually has: "is there anything I should be doing right now?"
 *
 * ── IT DESCRIBES THE ID CHECK MODESTLY, AND THAT IS A RULE ────────────────
 * The check is a person comparing a selfie holding a handwritten note against
 * the profile photo. It shows a real person made the effort and that the photo
 * is not lifted from somewhere else. It is NOT identity verification: no
 * document is asked for, seen or kept.
 *
 * A model weighs this when deciding whether to be alone with a stranger.
 * Someone who believes we checked a passport accepts a risk they would not
 * otherwise accept, on the strength of our wording. Say less than is true,
 * never more.
 */

type StepState = 'done' | 'todo' | 'waiting' | 'attention'

const MARK: Record<StepState, { glyph: string; className: string; sr: string }> = {
  done:      { glyph: '✓', className: 'bg-rose text-white',        sr: 'done' },
  todo:      { glyph: '·', className: 'bg-input-bg text-muted',    sr: 'still to do' },
  waiting:   { glyph: '…', className: 'bg-soft-pink text-rose',    sr: 'waiting on us' },
  attention: { glyph: '!', className: 'bg-danger/10 text-danger',  sr: 'needs your attention' },
}

function Step({
  state, title, children, href, linkLabel,
}: {
  state: StepState
  title: string
  children: React.ReactNode
  href?: string
  linkLabel?: string
}) {
  const mark = MARK[state]
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[999px] text-sm font-bold ${mark.className}`}
        aria-hidden="true"
      >
        {mark.glyph}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-warm-dark">
          {title}
          <span className="sr-only">: {mark.sr}</span>
        </p>
        <p className="text-sm text-muted">{children}</p>
        {href && (
          <p className="mt-1">
            <Link href={href} className="text-sm font-bold text-rose hover:underline">
              {linkLabel ?? 'Open'} →
            </Link>
          </p>
        )}
      </div>
    </li>
  )
}

export function StylistSetupPanel({ setup }: { setup: StylistSetup }) {
  if (!setup.providerId) {
    // The signup trigger makes this row, so its absence is a real fault rather
    // than a state to guide someone through. Say so plainly.
    return (
      <section className="rounded-lg border border-danger/30 bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-warm-dark">Your shop isn’t set up</h2>
        <p className="mt-1 text-sm text-muted">
          Your account doesn’t have a stylist profile attached to it, which shouldn’t happen.
          This is a problem at our end — get in touch and we’ll fix it.
        </p>
      </section>
    )
  }

  if (setup.isPublished) {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-warm-dark">Your shop is live</h2>
        <p className="mt-1 text-sm text-muted">
          Models can find you and apply for your open slots.
          {setup.treatmentCount === 0 &&
            ' You haven’t listed any treatments yet, so you won’t come up when models filter by one.'}
        </p>
        <p className="mt-3 flex flex-wrap gap-4">
          <Link href="/shop" className="text-sm font-bold text-rose hover:underline">
            Edit your shop →
          </Link>
          <Link href={`/stylist/${setup.providerId}`} className="text-sm font-bold text-rose hover:underline">
            See what models see →
          </Link>
        </p>
      </section>
    )
  }

  const detailsMissing = !setup.name?.trim()
    ? 'a name'
    : !setup.locationText?.trim() ? 'the area you work in' : null

  // Everything the stylist controls is done and the only thing left is us.
  // This is the state the panel most needs to explain: someone who has finished
  // all four steps and still reads "Not published" will assume it is broken,
  // and the honest answer — a person has not looked at it yet — is nowhere on
  // the screen unless it is put there.
  const waitingOnUs =
    setup.detailsDone && setup.treatmentCount > 0 && setup.feeSettled && setup.idCheck === 'pending'

  return (
    <section className="rounded-lg border border-rose/30 bg-white p-5 shadow-card">
      <h2 className="font-display text-xl text-warm-dark">
        {waitingOnUs ? 'Waiting on us' : 'Getting your shop live'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {waitingOnUs ? (
          <>
            You’ve done everything. Your shop stays{' '}
            <span className="font-bold text-warm-dark">not published</span> until someone here has
            checked your ID selfie — that’s a person, not a computer, and it usually takes less
            than 24 hours. Nothing is broken and there’s nothing left for you to do.
          </>
        ) : (
          <>
            Your shop is <span className="font-bold text-warm-dark">not published</span> yet, so
            models can’t see or book you. Here’s what’s left.
          </>
        )}
      </p>

      <ol className="mt-4 space-y-3">
        <Step
          state={setup.detailsDone ? 'done' : 'todo'}
          title="Your shop details"
          href="/shop"
          linkLabel={setup.detailsDone ? 'Edit your details' : 'Add your details'}
        >
          {setup.detailsDone
            ? <>
                {setup.name} · {setup.locationText}
                {!setup.bio?.trim() && ' — worth adding a few lines about yourself.'}
              </>
            : <>Models need {detailsMissing} to find you. A short bio helps too.</>}
        </Step>

        <Step
          state={setup.treatmentCount > 0 ? 'done' : 'todo'}
          title="What you offer"
          href="/shop"
          linkLabel={setup.treatmentCount > 0 ? 'Change your treatments' : 'Pick your treatments'}
        >
          {setup.treatmentCount > 0
            ? `${setup.treatmentCount} treatment${setup.treatmentCount === 1 ? '' : 's'} listed.`
            : 'Pick the treatments you do. Models filter on these, so an empty list means an empty diary.'}
        </Step>

        <Step state={setup.feeSettled ? 'done' : 'todo'} title="The one-off fee">
          {setup.feeSettled
            ? setup.isFoundingProvider
              ? 'Covered — you’re a Founding Provider, so there’s nothing to pay.'
              : 'Settled. Nothing to pay.'
            : <>£14.99, once, ever. Paying it is in the Cavy app for now — it’s coming to the web
               shortly.</>}
        </Step>

        <Step
          state={
            setup.idCheck === 'approved' ? 'done'
            : setup.idCheck === 'pending' ? 'waiting'
            : setup.idCheck === 'rejected' ? 'attention'
            : 'todo'
          }
          title="The ID check"
        >
          {setup.idCheck === 'approved' && 'Passed.'}
          {setup.idCheck === 'pending' &&
            'Sent. A person looks at these, usually within 24 hours — nothing for you to do.'}
          {setup.idCheck === 'rejected' && (
            <>
              We couldn’t accept the last one, so it needs doing again.
              {setup.idCheckNote && <> The reviewer said: “{setup.idCheckNote}”</>}
              {' '}Retaking it is in the Cavy app for now.
            </>
          )}
          {setup.idCheck === 'none' && (
            <>
              A selfie holding a handwritten note, looked at by a person. It shows there’s a real
              person behind the shop and that the profile photo hasn’t been taken from somewhere
              else — it isn’t an identity check, and nobody sees a passport or a driving licence.
              Doing it is in the Cavy app for now.
            </>
          )}
        </Step>
      </ol>

      <p className="mt-4 rounded-md bg-input-bg px-3 py-2 text-xs text-muted">
        {waitingOnUs
          ? 'We’ll send you a notification the moment it’s approved, and your shop goes live at the same time — there’s no switch for you to flip.'
          : 'When the other steps are done, a person here looks at your ID selfie — usually within 24 hours. If it passes we publish your shop for you and send you a notification, so there’s no switch for you to flip.'}
      </p>
    </section>
  )
}
