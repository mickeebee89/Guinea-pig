'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitSelfie } from './actions'

/**
 * Take the ID-check photo and send it.
 *
 * ── A FILE INPUT, NOT getUserMedia ────────────────────────────────────────
 * `capture="user"` opens the front camera directly on a phone, which is where
 * this will almost always be done — you need a piece of paper in shot, and
 * nobody writes their name on paper at a desktop.
 *
 * A live getUserMedia preview would look better and costs a permission prompt,
 * a video element, canvas capture, mirroring and orientation handling. A
 * declined camera permission is also close to permanent in Chrome, which is the
 * same reason the location prompt is deferred until engagement. Not worth it
 * for a once-per-account action.
 *
 * ⚠️ ON DESKTOP, `capture` IS IGNORED and this is an ordinary file picker, so
 * an existing photo can be chosen. Mobile's version uses launchCameraAsync and
 * cannot. That is a real weakening of the check on desktop and it is why the
 * copy says a person compares this against the profile photo: the review is
 * what makes the check mean anything, not the capture method. If that trade
 * ever stops being acceptable, the answer is to require a phone, not to pretend
 * a file picker is a camera.
 *
 * ── RESIZED BEFORE IT LEAVES THE BROWSER ──────────────────────────────────
 * Same 1080px / 0.85 JPEG as mobile. A modern phone photo is 3–5MB, most of it
 * detail a person comparing two faces does not need, and the upload happens on
 * whatever signal a salon has.
 */

const MAX_WIDTH = 1080
const QUALITY = 0.85

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_WIDTH / bitmap.width)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      QUALITY,
    )
  })
}

export function SelfieCapture({ retake = false }: { retake?: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const resized = await downscale(file)
      setBlob(resized)
      setPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(resized)
      })
    } catch (err) {
      console.error('[verify] resize failed', err)
      // Sending the original is better than refusing outright — the action
      // caps the size, so the worst case is a clear message rather than a
      // silent failure on a phone whose photos this browser cannot decode.
      setBlob(file)
      setPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
    }
  }

  const send = () => {
    if (!blob) return
    setError(null)
    start(async () => {
      const form = new FormData()
      form.append('selfie', new File([blob], 'selfie.jpg', { type: 'image/jpeg' }))
      const res = await submitSelfie(form)
      if (!res.ok) { setError(res.error); return }
      if (preview) URL.revokeObjectURL(preview)
      setPreview(null)
      setBlob(null)
      router.refresh()
    })
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={choose}
        className="sr-only"
        id="selfie-input"
      />

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="The photo you just took, before sending it"
          className="mb-4 w-full max-w-xs rounded-lg border border-hairline"
        />
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className={`inline-flex min-h-11 items-center rounded-[999px] px-5 text-sm font-bold disabled:opacity-50 ${
            preview
              ? 'bg-input-bg text-warm-dark hover:bg-soft-pink'
              : 'bg-rose text-white hover:bg-rose-dark'
          }`}
        >
          {preview ? 'Take another' : retake ? 'Take a new photo' : 'Take your photo'}
        </button>

        {preview && (
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send for review'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
