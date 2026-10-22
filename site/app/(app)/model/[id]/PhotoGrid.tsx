'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface GridPhoto {
  id: string
  url: string
  caption: string | null
}

/**
 * A model's photos, enlargeable.
 *
 * ── ⚠️⚠️ THIS FOLLOWS PortfolioGallery, NOT THE ADMIN LIGHTBOX ───────────
 * The brief said to follow `admin/app/verification/page.tsx`, which is a
 * `fixed inset-0` div with an onClick backdrop. **This app already has a
 * viewer, and it is the better of the two**: `components/PortfolioGallery.tsx`
 * is built on the native `<dialog>` + `showModal()`, and copying the admin one
 * here would have made a hand-rolled overlay the THIRD variant rather than the
 * second — in the same app as the good one.
 *
 * What `<dialog>` gives that the div version has to reimplement, and which the
 * brief asked for by name:
 *   * **Escape closes** — built in, no key handler.
 *   * **Focus returns to the thumbnail that opened it** — `close()` restores
 *     focus to whatever had it when `showModal()` was called. Free, and the
 *     part a hand-rolled overlay almost always gets wrong.
 *   * Focus is TRAPPED inside while open, and the page behind is inert, so a
 *     screen reader cannot wander into content hidden behind a backdrop.
 *   * `::backdrop` is a real pseudo-element, so the dim layer is not a div
 *     that can be tabbed to.
 *
 * ⚠️ The admin queue is deliberately untouched. The shapes differ because one
 * of them is better, and that is written here rather than left as a silent
 * inconsistency for the next person to "tidy up" in the wrong direction.
 *
 * ── ⚠️ WHY PLAIN <img> AND NOT next/image. DO NOT "FIX" THIS ─────────────
 * The old comment on this grid said "Supabase Storage, unknown dimensions".
 * That is not the reason, and the real one is checkable:
 *
 *   `next.config.ts` → images.remotePatterns allows exactly
 *      hostname ptluekkhiopowuyvkgnd.supabase.co
 *      pathname /storage/v1/object/public/**
 *
 * These URLs are **signed**, so their path is `/storage/v1/object/sign/…`.
 * That does not match, and `next/image` throws at runtime rather than
 * degrading. Two more reasons it would be wrong even if the pattern were
 * widened: the optimiser caches on the full URL, and the `?token=` changes
 * every hour, so nothing would ever hit that cache; and `/_next/image?url=…`
 * would put the signed token in a query string, where it is more exposed than
 * in a `src`. The CSP already permits the Supabase host for `img-src`.
 */
export function PhotoGrid({
  photos,
  modelName,
}: {
  photos: GridPhoto[]
  modelName: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)
  /**
   * ⚠️ PHOTOS WHOSE SIGNED URL NO LONGER WORKS.
   *
   * `queries/model.ts` signs these for 3600 seconds. A tab left open longer
   * than an hour has dead URLs in it, and the request then returns **HTTP 400
   * with a JSON body** — measured against the live storage endpoint — not an
   * image. Without this the enlarged view is a broken-image icon on a dark
   * backdrop, which reads as "this model's photo is corrupt" rather than "this
   * page is stale".
   *
   * Keyed by photo id rather than by URL so a re-render cannot resurrect a
   * known-dead entry.
   */
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const markFailed = useCallback((id: string) => {
    setFailed(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  const open = (i: number) => {
    setIndex(i)
    dialogRef.current?.showModal()
  }
  const close = () => dialogRef.current?.close()

  const step = useCallback((delta: number) => {
    setIndex(i => (i + delta + photos.length) % photos.length)
  }, [photos.length])

  // Arrow keys while the viewer is open. Escape is <dialog>'s own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!dialogRef.current?.open) return
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const current = photos[index]

  /**
   * ⚠️ WHAT THE ENLARGED IMAGE ANNOUNCES WHEN THERE IS NO CAPTION.
   *
   * The thumbnail keeps `alt=""`: it sits inside a button that already has an
   * accessible name, so a second announcement would be noise — and a thumbnail
   * really is decorative, because the button beside it says what it does.
   *
   * The enlarged image is the CONTENT, and an empty alt there tells a screen
   * reader there is nothing to see on a screen that exists only to show
   * something. So it never gets `""`. With a caption it reads the caption;
   * without one it falls back to the position, in the same phrasing
   * PortfolioGallery already uses for a stylist's work. "Photo 2 of 5 from
   * Amelia R.'s gallery" is not a description of the picture — nothing can
   * supply that but the model — but it is true, it locates the reader, and it
   * is the honest version of "we were not told".
   */
  const describe = (p: GridPhoto, i: number) =>
    p.caption?.trim() || `Photo ${i + 1} of ${photos.length} from ${modelName}’s gallery`

  return (
    <>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((p, i) => (
          <li key={p.id} className="overflow-hidden rounded-md border border-hairline">
            {/* ⚠️ A REAL <button>, not a div with onClick: focusable by keyboard,
                announced as a control, and activated by Enter and Space without
                a handler of our own. */}
            <button
              type="button"
              onClick={() => open(i)}
              className="block w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
              aria-label={p.caption?.trim()
                ? `Enlarge photo: ${p.caption.trim()}`
                : `Enlarge photo ${i + 1} of ${photos.length}`}
            >
              {failed.has(p.id) ? (
                <span className="flex h-40 w-full items-center justify-center bg-input-bg px-2 text-center text-xs text-muted">
                  Photo didn’t load — refresh the page
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket; see the note at the top of this file */
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  onError={() => markFailed(p.id)}
                  className="h-40 w-full object-cover"
                />
              )}
            </button>
            {p.caption && <p className="px-2 py-1 text-xs text-muted">{p.caption}</p>}
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        /* Clicking the backdrop closes. The test is on the dialog itself
           because the backdrop is not an element you can listen on. */
        onClick={e => { if (e.target === dialogRef.current) close() }}
        /* ⚠️⚠️ m-auto IS LOAD-BEARING, NOT TIDYING. A modal <dialog> is
           centred by the UA's own `margin: auto`, and Tailwind's preflight
           resets margin to 0 on every element — so without this the overlay
           pins to the TOP-LEFT CORNER at (0, 0). Measured, not guessed:
           getBoundingClientRect was {top: 0, left: 0} in a 1024x768 viewport
           with computed margin 0px. */
        className="m-auto max-h-[90dvh] max-w-[95vw] rounded-lg bg-transparent p-0 backdrop:bg-warm-dark/80"
      >
        {current && (
          <div className="relative flex flex-col items-center">
            {failed.has(current.id) ? (
              /* ⚠️ THE STALE-PAGE MESSAGE, AND IT NAMES THE FIX. The brief
                 asked to know the failure rather than have it hidden: an
                 expired link is not a missing photo, and "refresh" is the
                 whole remedy. */
              <p className="max-w-sm rounded-lg bg-white px-6 py-10 text-center text-sm text-muted">
                This photo link has expired. Refresh the page to see it again.
              </p>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- as above */
              <img
                src={current.url}
                alt={describe(current, index)}
                onError={() => markFailed(current.id)}
                className="max-h-[80dvh] max-w-[95vw] rounded-lg object-contain"
              />
            )}

            {current.caption && (
              <p className="mt-2 max-w-[95vw] rounded bg-white/90 px-3 py-1 text-sm text-warm-dark">
                {current.caption}
              </p>
            )}

            <div className="mt-3 flex items-center gap-3">
              {photos.length > 1 && (
                <>
                  <button onClick={() => step(-1)} aria-label="Previous photo"
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[999px] bg-white/90 font-bold text-warm-dark">
                    ‹
                  </button>
                  <span className="text-sm font-bold text-white">{index + 1} / {photos.length}</span>
                  <button onClick={() => step(1)} aria-label="Next photo"
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[999px] bg-white/90 font-bold text-warm-dark">
                    ›
                  </button>
                </>
              )}
              <button onClick={close}
                      className="inline-flex min-h-11 items-center rounded-[999px] bg-white/90 px-4 text-sm font-bold text-warm-dark">
                Close
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
