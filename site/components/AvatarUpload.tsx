'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { downscale, UNREADABLE_IMAGE_MESSAGE } from '@/lib/downscale'
import { uploadAvatar } from '@/lib/queries/avatar-action'
import { Avatar } from '@/components/ui'
import { attempt } from '@/lib/attempt'

/**
 * A profile picture. BOTH ROLES. Audit items 99 and 101.
 *
 * Moved out of the model's profile folder once the stylist needed it too:
 * a stylist has no /profile page, so gating her ID check on having a picture
 * without giving her somewhere to set one would have relocated the dead end
 * rather than closed it. Hers lives on /shop.
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
/**
 * ⚠️ WHO SEES THE PHOTO DEPENDS ON WHOSE PAGE THIS IS, and the sentence below
 * used to be hardcoded for the model side. On /shop a STYLIST was told
 * "Stylists see it on your profile" about her own photograph — backwards, on a
 * page she uses, directly under a heading that correctly says models see it.
 *
 * One component, two audiences, one sentence written for one of them. Found in
 * a frame of the stylist walkthrough, 30 Sep 2026.
 */
const SEEN_BY = {
  model: 'Stylists see it on your profile',
  stylist: 'Models see it on your shop and in search results',
} as const

export function AvatarUpload({
  initialUrl, name, audience,
}: {
  initialUrl: string | null
  name: string
  /** Whose page this is — NOT who is being described. See SEEN_BY above. */
  audience: keyof typeof SEEN_BY
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
      // ⚠️ REFUSE RATHER THAN SEND SOMETHING THAT RENDERS NOWHERE. This used
      // to fall back to the original with a console.warn, so a HEIC uploaded,
      // the UI said it worked, and the avatar was blank everywhere after.
      // Item 125.
      let toSend: File
      try {
        const blob = await downscale(file)
        toSend = new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
      } catch {
        setError(UNREADABLE_IMAGE_MESSAGE)
        return
      }

      const fd = new FormData()
      fd.append('avatar', toSend)
      const res = await attempt(() => uploadAvatar(fd), 'avatar')
      if (!res.ok) { setError(res.error ?? 'That didn’t upload.'); return }
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
            accept="image/jpeg,image/png,image/webp"
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
          Use a clear photo of your face. {SEEN_BY[audience]}, and it’s what your ID
          check photo is compared against.
        </p>
        {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}
