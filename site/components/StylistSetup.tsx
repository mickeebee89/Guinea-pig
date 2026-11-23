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
 *
 * ── ⚠️⚠️ THE ID CHECK NO LONGER HOLDS A SHOP BACK ─────────────────
 * `verification_required_to_publish` is false, so a shop publishes itself the
 * moment it has a name and a categorised treatment, verified or not —
 * `publish_provider_if_eligible` and `enforce_publish_requires_verified` both
 * read that flag and neither refuses an unverified stylist any more.
 *
 * ⚠️ SO THE STEP MOVES OUT OF THE LIST RATHER THAN CHANGING ITS WORDS. A row
 * in an ordered list headed "Getting your shop live", with an empty circle
 * beside it, IS a claim that the shop is not going live until it is ticked —
 * whatever the sentence underneath says. While the flag is off the ID check is
 * rendered below the list as an optional badge; while it is on, the list is
 * exactly what it always was. Same reasoning as the fee step, which has been
 * hidden on `feeEnabled` since 0102 rather than deleted.
 *
 * ⚠️ AND IT IS NOT HIDDEN ALTOGETHER, because a stylist can still choose to
 * do it and a model still reads the badge. "Not required" is not "not worth
 * doing", and deleting it would take away the only reason she has to.
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

export function StylistSetupPanel({
  setup,
  modelsSignedUp = null,
}: {
  setup: StylistSetup
  /**
   * How many models have signed up, or null when we could not ask.
   *
   * ⚠️ ONLY THE DASHBOARD PASSES IT, and only for an unpublished shop. /shop
   * renders this same panel and does NOT pass it — she is already on the page
   * that fixes the problem, so a line about who is waiting would be a nudge
   * where an instruction belongs.
   */
  modelsSignedUp?: number | null
}) {
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
        {/* ⚠️ WHICH LIVE. Item 183. "Live" means published and bookable inside
            Cavy, consistently across this codebase — the word is not wrong. The
            fault was that it stood alone while the panel below might be about
            to say she is missing from the public website, so a stylist had no
            way to tell which of two states she was in from the sentence that
            announced it. */}
        <h2 className="font-display text-xl text-warm-dark">
          {setup.inPublicView ? 'Your shop is live' : 'Your shop is live in Cavy'}
        </h2>
        {/* ⚠️ THIS LINE IS CORRECT ONLY BECAUSE OF ITS SUBJECT. "find you" is
            the same verb the panel below uses for the public pages ("where
            people who aren’t members yet can find you"), and the two states are
            told apart by WHO is doing the finding — models, versus people who
            are not members. Shorten it to "You can be found" or "People can
            find you" and the sentence silently starts claiming the thing the
            panel underneath is about to deny. Item 183: the one place 183’s
            vocabulary crosses the boundary it exists to draw. */}
        <p className="mt-1 text-sm text-muted">
          Models can find you and apply for your open slots.
          {setup.treatmentCount === 0 &&
            ' You haven’t listed any treatments yet, so you won’t come up when models filter by one.'}
        </p>

        {/* Live, but not on the public website. Two different things, and
            saying so is the whole point: this stylist is bookable right now.
            Framed as an opportunity, never as a problem — nothing is broken and
            nothing is blocked. */}
        {/* ⚠⚠ DRIVEN BY THE VIEW, NOT BY THE BLOCKER LIST. Item 183.
            This used to render when websiteBlockers was non-empty, which meant
            the panel appeared only for reasons the dashboard already modelled —
            and stayed silent for any other, telling her nothing while she was
            missing from the public site. Now absence from public_stylists is
            what shows it, and the sentence is the explanation when there is
            one. */}
        {setup.isPublished && !setup.inPublicView && (
          <div className="mt-3 rounded-md bg-input-bg px-3 py-2">
            <p className="text-sm font-bold text-warm-dark">Want to show up on Google too?</p>
            <p className="mt-1 text-sm text-muted">
              You’re bookable in Cavy either way — models can find you, apply and book.
              This is about the public cavybeauty.com pages, where people who aren’t
              members yet can find you.
            </p>
            {/* ⚠️ The database's own sentence when we have one, and an honest
                shrug when we do not. Guessing a reason here would be the
                mirror defect returning: the view already told us she is not
                listed, and not knowing why is better said than invented. */}
            {setup.websiteBlockers.length > 0 ? (
              <p className="mt-1 text-sm text-muted">
                You’d need {setup.websiteBlockers.join(' and ')}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">
                We can’t tell from here what’s holding it up — check your shop name,
                your treatments and your about, or get in touch.
              </p>
            )}
          </div>
        )}
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

  // ⚠️ THE ID CHECK NO LONGER HOLDS A SHOP BACK, so the panel's own branches
  // must stop asking about it. One name, read in five places below, so the
  // flag cannot be honoured in some of them and forgotten in others.
  const verifyGates = setup.verifyRequiredToPublish

  // Hidden by the stylist: everything done, been live before, and not live now.
  // Without this branch the panel read "Getting your shop live" over four
  // ticked steps and promised "there's no switch for you to flip", which
  // stopped being true when the web gained one (audit item 66).
  //
  // ⚠️ `isVerified` WAS AN UNCONDITIONAL CONDITION HERE. With the flag off an
  // unverified stylist CAN have been published and CAN have hidden it, so she
  // would have fallen through to "Getting your shop live" over a shop that was
  // already finished — told to set up something she had set up and then hidden.
  if (setup.everPublished && (!verifyGates || setup.isVerified)
      && setup.feeSettled && setup.publishBlockers.length === 0) {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-warm-dark">Your shop is hidden</h2>
        <p className="mt-1 text-sm text-muted">
          You’ve hidden your shop, so models can’t find you or apply. Everything else is set up,
          so you can publish it again whenever you’re ready.
        </p>
        <p className="mt-3">
          {/* To the control itself, not just the page: on /shop a plain "/shop"
              link went nowhere (item 66). Elsewhere it lands on the same place. */}
          <Link href="/shop#visibility" className="text-sm font-bold text-rose hover:underline">
            Publish it from your shop →
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
  // ⚠️ IMPOSSIBLE WHILE THE FLAG IS OFF, AND THAT IS THE POINT. "Waiting on us"
  // means a finished shop is being held by a person's decision. Nothing is
  // held by that decision now, so a stylist whose selfie is in the queue is NOT
  // waiting on us — her shop is already live. Saying otherwise would be the
  // panel inventing a delay the product no longer has.
  const waitingOnUs = verifyGates
    && setup.publishBlockers.length === 0 && setup.feeSettled && setup.idCheck === 'pending'

  // Publication is waiting on the STYLIST and on nothing else — the state 0016
  // created, which before auto-publish was a dead end only an admin could
  // notice. It now resolves itself the moment the list below is empty, so the
  // list has to be on the screen.
  //
  // ⚠️ TRUE FOR EVERYONE WHILE THE FLAG IS OFF, not just the verified. That is
  // the honest reading: if the ID check cannot hold a shop back then every
  // stylist with an incomplete shop is in exactly this state, and the heading
  // and the note below are worded for both cases rather than claiming she is
  // verified when she is not.
  const nothingLeftButHer = !verifyGates || setup.isVerified
  const verifiedButIncomplete = nothingLeftButHer && setup.publishBlockers.length > 0

  return (
    <section className="rounded-lg border border-rose/30 bg-white p-5 shadow-card">
      <h2 className="font-display text-xl text-warm-dark">
        {waitingOnUs ? 'Waiting on us'
          : verifiedButIncomplete
            // ⚠️ ONLY CLAIMS THE ID CHECK WHEN THE ID CHECK IS WHY. With the
            // flag off this branch is reached by unverified stylists too, and
            // "You're verified" would be false for most of them.
            ? (verifyGates ? 'You’re verified — one thing left' : 'Nearly there')
          : 'Getting your shop live'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {waitingOnUs ? (
          <>
            You’ve done everything. Your shop stays{' '}
            <span className="font-bold text-warm-dark">not published</span> until someone here has
            checked your ID selfie — that’s a person, not a computer, and it usually takes less
            than 24 hours. Nothing is broken and there’s nothing left for you to do.
          </>
        ) : verifiedButIncomplete ? (
          <>
            {verifyGates && 'Your ID check has passed. '}
            Your shop goes live{' '}
            <span className="font-bold text-warm-dark">by itself, the moment</span> it has
            everything a model needs — no one has to approve anything.
          </>
        ) : (
          <>
            Your shop is <span className="font-bold text-warm-dark">not published</span> yet, so
            models can’t see or book you. Here’s what’s left.
          </>
        )}
      </p>

      {/* ⚠⚠ THE ONE SENTENCE THAT REPLACED A WHOLE PANEL, 24 Nov 2026.
          Everything else here tells her WHAT TO DO; nothing told her whether
          doing it is worth anything, and /models cannot — it is gated on
          publication, so it shows her nothing until after the work is done.

          ⚠⚠ OUTSIDE THE THREE-WAY PARAGRAPH ABOVE, AND THAT IS THE WHOLE
          POINT. It was first written inside the "not published yet" branch,
          which looked like the right one and is not: with the verification
          flag off, `nothingLeftButHer` is always true, so ANY unpublished shop
          that still has blockers takes the "Nearly there" branch instead.
          Measured 24 Nov 2026 — 9 of the 12 unpublished shops have neither a
          name nor a treatment, so the branch it was in would have missed
          exactly the nine who need it most. Caught by rendering it, not by
          reading it.

          ⚠️ IT CLAIMS SIGNED UP, NOT WAITING. They have not been told about
          her and are not expecting her. "87 models are waiting for you" is the
          sentence the demand panel existed to avoid, and it would be no truer
          in a smaller font.

          ⚠️ SKIPPED ENTIRELY WHEN THE COUNT IS NULL, never rendered as a zero
          — see getSignedUpModelCount. And only the DASHBOARD passes it: /shop
          renders this same panel without it, because she is already on the
          page that fixes the problem. */}
      {modelsSignedUp != null && (
        <p className="mt-2 text-sm text-muted">
          <span className="font-bold text-warm-dark">
            {modelsSignedUp} models have signed up
          </span>{' '}
          looking for treatments, and you’ll be able to invite them once your shop is live.
        </p>
      )}

      {/* Never make someone guess which field. This is the list the database
          actually checks — provider_shop_is_publishable() in 0016 — so an empty
          list here means publication really will happen.

          It does NOT include the bio. A short bio keeps a shop off the public
          website and nothing else; putting it here would tell a stylist they
          are blocked when they are only invisible to Google. */}
      {setup.publishBlockers.length > 0 && (
        <div className="mt-3 rounded-md bg-input-bg px-3 py-2">
          <p className="text-sm font-bold text-warm-dark">
            Your shop still needs{setup.publishBlockers.length === 1 ? '' : ':'}
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-muted">
            {setup.publishBlockers.map(b => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

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

        {/* ⚠️⚠️ NOT DRAWN AT ALL WHILE THE FEE IS OFF, WHICH IT HAS BEEN SINCE
            0102 (23 Oct 2026). `feeSettled` is TRUE for everybody while the fee
            is switched off, so this step used to render for every stylist as
            "The one-off fee — Settled. Nothing to pay." Read by someone who has
            never been asked for money, that says Cavy HAS a fee and that hers
            was mysteriously cleared; the Founding Provider line thanked her for
            a slot that confers nothing now. Both contradict the
            free-for-stylists pitch on /for-stylists, and this is the first
            screen a new stylist sees.

            ⚠️ HIDDEN ON THE FLAG RATHER THAN DELETED. The fee can be switched
            back on (supabase/FEE-REINSTATEMENT.md), and a deleted step comes
            back as an unannounced charge. This returns the moment
            provider_fee_enabled() does, with its original wording intact. */}
        {setup.feeEnabled && (
          <Step state={setup.feeSettled ? 'done' : 'todo'} title="The one-off fee">
            {setup.feeSettled
              ? setup.isFoundingProvider
                ? 'Covered — you’re a Founding Provider, so there’s nothing to pay.'
                : 'Settled. Nothing to pay.'
              : <>£14.99, once, ever. You can pay it on the ID check page.</>}
          </Step>
        )}

        {/* ⚠⚠ IN THE LIST ONLY WHILE IT GATES PUBLICATION. An unticked row in
            an ordered list headed "Getting your shop live" is itself a claim
            that the shop is waiting on it — the sentence underneath cannot
            take that back. While the flag is off the same information is
            rendered below the list, as an optional badge. */}
        {verifyGates && (
          <Step
            state={
              setup.idCheck === 'approved' ? 'done'
              : setup.idCheck === 'pending' ? 'waiting'
              : setup.idCheck === 'rejected' ? 'attention'
              : 'todo'
            }
            title="The ID check"
            // Only offered once the fee is settled, matching what /verify itself
            // will do. A link that lands on "the fee comes first" is a link that
            // wasted the tap.
            href={setup.feeSettled && setup.idCheck !== 'approved' && setup.idCheck !== 'pending'
              ? '/verify' : undefined}
            linkLabel={setup.idCheck === 'rejected' ? 'Try again' : 'Do the ID check'}
          >
            {setup.idCheck === 'approved' && 'Passed.'}
            {setup.idCheck === 'pending' &&
              'Sent. A person looks at these, usually within 24 hours — nothing for you to do.'}
            {setup.idCheck === 'rejected' && (
              <>
                We couldn’t accept the last one, so it needs doing again.
                {setup.idCheckNote && <> The reviewer said: “{setup.idCheckNote}”</>}
              </>
            )}
            {setup.idCheck === 'none' && (
              <>
                A selfie holding a handwritten note, looked at by a person. It shows there’s a real
                person behind the shop and that the profile photo hasn’t been taken from somewhere
                else — it isn’t an identity check, and nobody sees a passport or a driving licence.
              </>
            )}
          </Step>
        )}
      </ol>

      {/* ⚠️ OUTSIDE THE LIST, AND NOT NUMBERED. Offered, never owed: it earns
          a badge models can see, and it holds nothing up. The description of
          what the check IS is the same sentence as everywhere else — a
          stylist told to write something different from what the reviewer is
          looking for gets rejected for following our own instructions. */}
      {!verifyGates && setup.idCheck !== 'approved' && (
        <div className="mt-4 rounded-md border border-hairline bg-white px-3 py-3">
          <p className="text-sm font-bold text-warm-dark">
            {setup.idCheck === 'pending' ? 'Your ID check is with us'
              : setup.idCheck === 'rejected' ? 'Your ID check needs doing again'
              : 'Optional: the ID check'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {setup.idCheck === 'pending'
              ? 'A person looks at these, usually within 24 hours. Nothing for you to do, and your shop isn’t waiting on it.'
              : setup.idCheck === 'rejected'
                ? <>
                    We couldn’t accept the last one. Your shop isn’t affected — have another go
                    whenever you like.
                    {setup.idCheckNote && <> The reviewer said: “{setup.idCheckNote}”</>}
                  </>
                /* ⚠️ THE BADGE SENTENCE IS GONE (23 Nov 2026) AND MUST NOT
                   COME BACK — lib/verification.ts, above isIdentityVerified,
                   has the measurement. What is KEPT is the last clause: "it
                   isn't an identity check, nobody sees a passport" is the
                   oldest rule on this feature and the one most worth saying,
                   because it is the claim a reader supplies for herself if we
                   stay quiet. */
                : <>
                    A selfie holding a handwritten note, looked at by a person. It isn’t needed
                    to go live, nothing is waiting on it, and your shop looks no different
                    afterwards — we keep the result on your account and show it nowhere on
                    Cavy. It isn’t an identity check either: nobody sees a passport or a
                    driving licence.
                  </>}
          </p>
          {setup.idCheck !== 'pending' && (
            <p className="mt-1">
              <Link href="/verify" className="text-sm font-bold text-rose hover:underline">
                {setup.idCheck === 'rejected' ? 'Try again' : 'Do the ID check'} →
              </Link>
            </p>
          )}
        </div>
      )}

      <p className="mt-4 rounded-md bg-input-bg px-3 py-2 text-xs text-muted">
        {/* ⚠️ THE THIRD ARM WAS THE UNTRUE ONE. It read "a person here looks
            at your ID selfie — if it passes we publish your shop for you",
            which described the ID check as the last thing between her and
            going live. With the flag off nobody is looking and nothing is
            held: the shop publishes on its own two requirements. Kept for the
            flag coming back, not deleted. */}
        {waitingOnUs
          ? 'We’ll send you a notification the moment it’s approved, and your shop goes live at the same time — there’s no switch for you to flip.'
          : verifiedButIncomplete
            ? 'Fill in what’s listed above and your shop publishes itself — you won’t need to ask anyone or wait again.'
            : verifyGates
              ? 'When the other steps are done, a person here looks at your ID selfie — usually within 24 hours. If it passes we publish your shop for you and send you a notification, so there’s no switch for you to flip.'
              : 'Your shop publishes itself as soon as it has a name and one treatment — nobody has to approve it, and there’s no switch for you to flip.'}
      </p>
    </section>
  )
}
