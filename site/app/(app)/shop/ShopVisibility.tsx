'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setShopPublished } from './actions'

/**
 * Publish or hide the shop. The web copy of mobile's Provider Dashboard toggle
 * (provider-dashboard.tsx:731-783), which goes through the same write: see
 * setShopPublished in ./actions.
 *
 * Only rendered once the shop has been live, or could be published now (see
 * the page). Before then, the setup panel is the guide, and it is right that
 * going live the first time has no switch.
 *
 * Hiding asks first because it takes the stylist out of every model's view.
 * Publishing doesn't, because it only puts back what they had.
 */
export function ShopVisibility({
  isPublished,
  refusal,
  onPublicSite,
}: {
  isPublished: boolean
  /** publishRefusal(setup): why publishing would be refused, or null. */
  refusal: string | null
  /** Live AND over the public site's content bar, so it really is on cavybeauty.com. */
  onPublicSite: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = (publish: boolean) => {
    setError(null)
    start(async () => {
      const res = await setShopPublished(publish)
      setConfirming(false)
      if (!res.ok) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl text-warm-dark">Who can see your shop</h2>
        <span
          className={`rounded-[999px] px-3 py-0.5 text-xs font-bold ${
            isPublished ? 'bg-rose text-white' : 'bg-input-bg text-muted'
          }`}
        >
          {isPublished ? 'Live' : 'Hidden'}
        </span>
      </div>

      <p className="mt-1 text-sm text-muted">
        {isPublished
          ? onPublicSite
            ? 'Models can find you and apply for your slots, and you appear on the public cavybeauty.com pages.'
            : 'Models can find you and apply for your slots.'
          : 'Your shop is hidden. Models can’t find you or apply, and you don’t appear on the public cavybeauty.com pages.'}
      </p>

      {!isPublished && refusal && (
        <p className="mt-3 rounded-md bg-input-bg px-3 py-2 text-sm text-warm-dark">{refusal}</p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4">
        {isPublished ? (
          confirming ? (
            <div className="rounded-lg border border-hairline bg-input-bg p-3">
              <p className="text-sm font-bold text-warm-dark">Hide your shop?</p>
              <p className="mt-1 text-sm text-warm-dark">
                It will stop appearing to models in Cavy and on the public cavybeauty.com pages,
                so nobody new will find you. Bookings you already have stay as they are. You can
                publish it again here whenever you like.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => change(false)}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {pending ? 'Hiding…' : 'Yes, hide my shop'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center rounded-[999px] bg-white px-5 text-sm font-bold text-muted"
                >
                  Keep it live
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setError(null); setConfirming(true) }}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-5 text-sm font-bold text-rose"
            >
              Hide my shop
            </button>
          )
        ) : (
          !refusal && (
            <button
              type="button"
              onClick={() => change(true)}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Publishing…' : 'Publish my shop'}
            </button>
          )
        )}
      </div>
    </section>
  )
}
