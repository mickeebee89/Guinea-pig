import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getStylistSetup } from '@/lib/queries/shop'
import { EmptyState } from '@/components/ui'
import { SelfieCapture } from './SelfieCapture'

export const metadata = { title: 'ID check' }

/**
 * The ID check, on the web. Piece 4 of the stylist setup path, and the last
 * "in the Cavy app for now" notice on that path.
 *
 * ── DESCRIBED MODESTLY, AND THAT IS A RULE ────────────────────────────────
 * A person compares a selfie holding a handwritten note against the profile
 * photo. It shows a real person made the effort and that the photo is not
 * lifted from somewhere else. It is NOT identity verification — no document is
 * requested, seen or kept.
 *
 * A model weighs this when deciding whether to be alone with a stranger.
 * Someone who believes a passport was checked accepts a risk they would not
 * otherwise accept, on the strength of our wording. Say less than is true.
 *
 * ── PROVIDERS ONLY, DELIBERATELY ──────────────────────────────────────────
 * There is no standalone model entry point here and there must not be one. The
 * app had "Get verified" buttons for models and they were removed because they
 * produced verified-but-unsubscribed accounts that could still not apply for
 * anything. Model verification belongs inside the apply gate, with the
 * subscription, and arrives with the apply flow.
 */
/** Shared chrome for every state of this page. Defined at module scope, not
 *  inside the component: a component created during render is a new type on
 *  every render, so React unmounts and remounts its whole subtree. eslint
 *  caught this one — which it could only do because the config was fixed. */
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">ID check</h1>
      <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">{children}</section>
      <p className="mt-4 text-sm">
        <Link href="/shop" className="font-bold text-rose hover:underline">← Back to your shop</Link>
      </p>
    </>
  )
}

export default async function VerifyPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const setup = await getStylistSetup(supabase, user.id)

  if (!setup.providerId) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">ID check</h1>
        <EmptyState title="This is for stylist accounts">
          Stylists do the ID check to make their shop live. On a model account it happens when
          you apply for your first session, together with membership — so there’s nothing to do
          here.
        </EmptyState>
      </>
    )
  }

  if (setup.idCheck === 'approved') {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">Passed</h2>
        <p className="mt-1 text-sm text-muted">
          Your ID check is done. There’s nothing to send again.
        </p>
      </Wrap>
    )
  }

  if (setup.idCheck === 'pending') {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">With us now</h2>
        <p className="mt-1 text-sm text-muted">
          Your photo has been sent. A person looks at these — not a computer — usually within
          24 hours. There’s nothing else for you to do, and we’ll send you a notification either
          way.
        </p>
      </Wrap>
    )
  }

  // The fee gate. Settled means paid OR Founding Provider OR waived — never
  // just paid. Reading it as "paid" is what had founding stylists shown a
  // £14.99 wall in the app until 14 Aug.
  if (!setup.feeSettled) {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">The one-off fee comes first</h2>
        <p className="mt-1 text-sm text-muted">
          There’s a £14.99 one-off charge before the ID check, and it’s settled once, ever.
          Paying it is in the Cavy app for now — it’s coming to the web shortly.
        </p>
      </Wrap>
    )
  }

  return (
    <Wrap>
      <h2 className="font-display text-xl text-warm-dark">
        {setup.idCheck === 'rejected' ? 'That one didn’t pass' : 'Take your ID check photo'}
      </h2>

      {setup.idCheck === 'rejected' && (
        <p className="mt-1 rounded-md bg-input-bg px-3 py-2 text-sm text-warm-dark">
          {setup.idCheckNote
            // The reviewer's note is the only thing that makes a rejection
            // fixable. Without it someone retakes the same unusable photo.
            ? <>The reviewer said: “{setup.idCheckNote}”</>
            : <>We couldn’t accept the last one. Have another go, following the steps below.</>}
        </p>
      )}

      <p className="mt-3 text-sm text-muted">
        A person compares this photo against your profile picture. It shows there’s a real person
        behind the shop and that your profile photo hasn’t been taken from somewhere else.{' '}
        <span className="font-bold text-warm-dark">It isn’t an identity check</span> — nobody sees
        a passport or a driving licence, and no document is kept.
      </p>

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

      <p className="mt-4 text-xs text-muted">
        On a phone this opens the camera. On a computer it opens your files, so have the photo
        ready.
      </p>

      <div className="mt-4">
        <SelfieCapture retake={setup.idCheck === 'rejected'} />
      </div>
    </Wrap>
  )
}
