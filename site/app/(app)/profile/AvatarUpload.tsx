'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { downscale } from '@/lib/downscale'
import { uploadAvatar } from './actions'
import { Avatar } from '@/components/ui'

/**
 * Her profile picture. Audit item 99.
 *
 * ⚠️ THE FIRST THING site/ HAS EVER WRITTEN TO profile_pic_url. Until now a
 * member who had only ever used the website was a grey circle to everyone,
 * permanently — and the ID check compares a selfie against this photo, so for
 * a web-only stylist that comparison had nothing to compare against (item 98).
 *
 * ── WHY downscale() AND NOT downscaleToFile() ─────────────────────────────
 * downscaleToFile keeps the ORIGINAL when the re-encode comes out bigger,
 * which small images do. That is the right trade for an application photo and
 * the wrong one here: going through the canvas is what **strips EXIF, and EXIF
 * on a phone photo routinely carries the GPS coordinates it was taken at.**
 * A photo of your own face is usually taken at home.
 *
 * So this re-encodes always and only falls back to the original if the browser
 * genuinely cannot decode the image — a refused upload would be worse, and the
 * server caps size and type either way.
 */
export function AvatarUpload({
  initialUrl, name,
}: {
  initialUrl: string | null
  name: string
}) {
  const router = useRouter()
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      let toSend: File = file
      try {
        const blob = await downscale(file)
        toSend = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      } catch (e) {
        console.warn('[avatar] falling back to the original file', e)
      }

      const fd = new FormData()
      fd.append('avatar', toSend)
      const res = await uploadAvatar(fd)
      if (!res.ok) { setError(res.error); return }
      setUrl(res.url)
      start(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar src={url} name={name} size={72} />

      <div>
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[999px] bg-input-bg px-5 text-sm font-bold text-rose hover:bg-soft-pink">
          {busy ? 'Uploading…' : url ? 'Change photo' : 'Add a photo'}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={e => onPick(e.target.files?.[0])}
            className="sr-only"
          />
        </label>

        {/* Says what it is FOR, not just what it is. The ID check compares a
            selfie against this photo, so "a clear photo of your face" is a
            requirement rather than advice — and a stylist deciding whether to
            take a stranger is looking at it too. */}
        <p className="mt-2 max-w-sm text-xs text-muted">
          Use a clear photo of your face. Stylists see it on your profile, and it’s what your ID
          check photo is compared against.
        </p>
        {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}
