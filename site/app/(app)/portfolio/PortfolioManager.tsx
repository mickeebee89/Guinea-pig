'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

export interface PortfolioRow {
  id: string
  mediaUrl: string
  mediaType: string | null
  moderationStatus: string | null
}

/**
 * 10MB. It was 50 — Supabase's default object cap — which existed to let a
 * video through. A photo does not need it, and nothing here downscales before
 * upload, so the cap is the only thing between a 40MB camera file and every
 * model who loads this stylist's profile.
 *
 * (Portfolio uploads do NOT use lib/downscale.ts, which the selfie and the
 * application photos both do. That is worth fixing and is not this change.)
 */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Upload and remove portfolio media.
 *
 * ── ⚠️ VIDEO WAS ACCEPTED HERE AND IS NOT ANY MORE — ITEM 111, 24 Sep 2026
 *
 * This was the ONLY place in the product that could upload a video, and
 * nothing could show one back:
 *
 *   * MOBILE rendered an <Image> pointed at the video file with a play icon
 *     over it — a blank square with a button that did nothing;
 *   * THE ADMIN QUEUE rendered a <video> with NO `controls`, so a reviewer saw
 *     a static black box and had to approve or reject something they could not
 *     watch. **A video could be uploaded and could never be moderated.**
 *
 * That second one is the reason this is a removal rather than a playback fix.
 * Approving unwatchable media is not a thing to make prettier.
 *
 * Mobile never accepted video (MediaTypeOptions.Images, media_type hardcoded
 * 'photo'), so the two clients now agree, which they did not before.
 *
 * The old note, kept because it explains the rows that exist:
 * ~~VIDEO IS NEW HERE, NOT PORTED… It RENDERS video if a row happens to have
 * media_type 'video'.~~
 * The mobile portfolio screen only ever picks images
 * (portfolio.tsx:168, MediaTypeOptions.Images) and hardcodes media_type:
 * 'photo'. It RENDERS video if a row happens to have media_type 'video', but
 * nothing in the app can create one. So this is a new capability rather than
 * parity, and it comes with limits worth stating rather than discovering:
 *
 *   * no transcoding — the file is served exactly as uploaded, so a phone
 *     video straight off a camera roll can be large and slow for viewers
 *   * no poster frame — portfolio_items has no poster_url column
 *     (public-web-views.sql:45), so a video tile shows the first frame the
 *     browser decodes
 *   * 50MB cap, which is Supabase's default object limit
 *
 * ── UPLOADS ARE NOT VISIBLE IMMEDIATELY ───────────────────────────────────
 * portfolio_items.moderation_status defaults to pending and the public view
 * requires 'approved', so an upload does not appear on the profile until an
 * admin clears it. Said plainly below, because otherwise it reads as a
 * failed upload.
 */
export function PortfolioManager({
  providerId, userId, initial,
}: { providerId: string; userId: string; initial: PortfolioRow[] }) {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const upload = async (file: File) => {
    setError(null); setNotice(null)

    // ⚠️ PHOTOS ONLY. Video was accepted here — the only entry point in the
    // product — and removed on 24 Sep 2026 (item 111) because nothing could
    // show it back. See the header.
    if (!file.type.startsWith('image/')) {
      setError('That needs to be a photo.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That photo is ${(file.size / 1024 / 1024).toFixed(0)}MB. The limit is 10MB — try a smaller one.`)
      return
    }

    setBusy(true)
    try {
      // Keyed by USER id, matching mobile (portfolio.tsx:213). That path is
      // what makes account deletion sweep these files: the delete-account
      // function clears `${userId}/` in this bucket.
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      /* Inside an upload handler, not a render body. A unique filename per
         upload is the point, and the rule does not track that this runs from
         an event. */
      // eslint-disable-next-line react-hooks/purity
      const path = `${userId}/${Date.now()}-portfolio.${ext}`

      const { data: up, error: upErr } = await supabase.storage
        .from('portfolio-photos')
        .upload(path, file, { contentType: file.type })
      if (upErr) throw upErr

      const { data: urlData } = supabase.storage.from('portfolio-photos').getPublicUrl(up.path)

      const { error: insErr } = await supabase.from('portfolio_items').insert({
        provider_id: providerId,
        media_url: urlData.publicUrl,
        // Always 'photo' now, matching what mobile has always written
        // (portfolio.tsx:229). The column stays because existing rows use it.
        media_type: 'photo',
      })
      if (insErr) throw insErr

      setNotice('Uploaded. It’ll appear on your profile once it’s been reviewed.')
      router.refresh()
    } catch (e) {
      console.error('[portfolio] upload failed', e)
      setError('That didn’t upload. Nothing has been added.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: PortfolioRow) => {
    if (!confirm('Remove this from your portfolio?')) return
    setError(null); setNotice(null); setBusy(true)
    try {
      const { error: delErr } = await supabase.from('portfolio_items').delete().eq('id', item.id)
      if (delErr) throw delErr
      // The storage object is left behind deliberately: account deletion sweeps
      // the whole folder, and a failed object delete must not leave a row
      // pointing at a file that is already gone.
      router.refresh()
    } catch (e) {
      console.error('[portfolio] delete failed', e)
      setError('That didn’t remove. Reload and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="rounded-lg border border-hairline bg-white p-5">
        <label htmlFor="media" className="block text-sm font-bold text-warm-dark">
          Add a photo
        </label>
        <p className="mt-1 text-xs text-muted">
          Up to 10MB. Photos appear on your profile once they’ve been reviewed —
          a shorter clip loads faster for the people looking at it.
        </p>
        <input
          id="media"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
          className="mt-3 block w-full text-sm text-muted file:mr-3 file:min-h-11 file:rounded-[999px] file:border-0 file:bg-rose file:px-5 file:text-sm file:font-bold file:text-white"
        />
        {busy && <p className="mt-2 text-sm text-muted">Uploading…</p>}
        {notice && <p role="status" className="mt-2 text-sm font-bold text-rose">{notice}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      {initial.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing in your portfolio yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {initial.map(item => (
            <li key={item.id} className="overflow-hidden rounded-md border border-hairline bg-white">
              <div className="aspect-square">
                {item.mediaType === 'video' ? (
                  /* A row that predates 24 Sep 2026. Nothing can upload one
                     now, and this says so rather than showing a player that
                     does not work (item 111). */
                  <div className="flex h-full w-full items-center justify-center bg-input-bg px-2 text-center text-xs text-muted">
                    Video isn’t supported — remove this and add a photo
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage
                  <img src={item.mediaUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className={`text-xs font-bold ${
                  item.moderationStatus === 'approved' ? 'text-muted' : 'text-rose'
                }`}>
                  {item.moderationStatus === 'approved' ? 'Live' : 'Being reviewed'}
                </span>
                <button
                  onClick={() => remove(item)}
                  disabled={busy}
                  className="text-xs font-bold text-danger hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
