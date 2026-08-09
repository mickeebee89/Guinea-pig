'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PortfolioMedia {
  id: string
  mediaUrl: string
  mediaType: string | null
}

/**
 * Portfolio grid with a full-screen viewer.
 *
 * Built on the native <dialog> element rather than a hand-rolled overlay,
 * because showModal() gives focus trapping, Escape-to-close, inert background
 * content and the ::backdrop pseudo-element for free — all things a div-based
 * lightbox has to reimplement and usually gets wrong for keyboard users.
 *
 * The grid itself is unchanged in shape: fixed aspect-ratio tiles so an image
 * and a video occupy identical space and nothing shifts when video appears.
 */
export function PortfolioGallery({ items, stylistName }: { items: PortfolioMedia[]; stylistName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(0)

  const open = (i: number) => {
    setIndex(i)
    dialogRef.current?.showModal()
  }
  const close = () => dialogRef.current?.close()

  const step = useCallback((delta: number) => {
    setIndex(i => (i + delta + items.length) % items.length)
  }, [items.length])

  // Arrow keys while the viewer is open. Escape is already handled by <dialog>.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!dialogRef.current?.open) return
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const current = items[index]

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item, i) => (
          <li key={item.id} className="overflow-hidden rounded-md border border-hairline bg-white">
            <button
              type="button"
              onClick={() => open(i)}
              className="block aspect-square w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
              aria-label={`Open image ${i + 1} of ${items.length} from ${stylistName}’s work`}
            >
              {item.mediaType === 'video' ? (
                <video src={item.mediaUrl} preload="none" playsInline className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage, unknown dimensions
                <img src={item.mediaUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        // Clicking the backdrop closes. The check is on the dialog itself
        // because the backdrop is not a separate element to listen on.
        onClick={e => { if (e.target === dialogRef.current) close() }}
        className="max-h-[90dvh] max-w-[95vw] rounded-lg bg-transparent p-0 backdrop:bg-warm-dark/80"
      >
        {current && (
          <div className="relative flex flex-col items-center">
            {current.mediaType === 'video' ? (
              <video src={current.mediaUrl} controls playsInline autoPlay className="max-h-[80dvh] max-w-[95vw] rounded-lg" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- as above
              <img src={current.mediaUrl} alt={`${stylistName}’s work, ${index + 1} of ${items.length}`}
                   className="max-h-[80dvh] max-w-[95vw] rounded-lg object-contain" />
            )}

            <div className="mt-3 flex items-center gap-3">
              {items.length > 1 && (
                <>
                  <button onClick={() => step(-1)} aria-label="Previous"
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[999px] bg-white/90 font-bold text-warm-dark">
                    ‹
                  </button>
                  <span className="text-sm font-bold text-white">{index + 1} / {items.length}</span>
                  <button onClick={() => step(1)} aria-label="Next"
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
