'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { downscaleToFile } from '@/lib/downscale'
import { uploadApplicationPhoto } from '../stylist/[id]/apply/actions'
import { savePhotoCaption, setPhotoCategory, deletePhoto, addPhotoCategory } from './actions'
import type { MyPhoto } from '@/lib/queries/my-profile'

/**
 * Her photo library. Audit item 99.
 *
 * ── THESE ROWS ALREADY EXISTED AND SHE COULD NOT SEE THEM ─────────────────
 * The apply wizard uploads into `model_photos` on pick, so a web-only model
 * already had photos — uncategorised, uncaptioned, and visible only to a
 * stylist reading her profile. This is the first place she can look at them.
 *
 * ── THE UPLOAD IS THE WIZARD'S, ON PURPOSE ────────────────────────────────
 * `uploadApplicationPhoto` is reused rather than reimplemented: same bucket,
 * same user-id path prefix, same size and type checks, same row insert. Two
 * upload paths into one table would drift, and the wizard's is the one that
 * has run against real uploads.
 */
export function PhotoManager({
  photos, categories,
}: {
  photos: MyPhoto[]
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        // The shared 1080px/0.85 resize. A phone photo is 3–5MB and the upload
        // happens on whatever signal she has.
        const small = await downscaleToFile(file, 'photo.jpg')
        const fd = new FormData()
        fd.append('photo', small)
        const res = await uploadApplicationPhoto(fd)
        if (!res.ok) { setError(res.error); break }
      }
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? 'That didn’t work.'); return }
      router.refresh()
    })
  }

  return (
    <div>
      <h2 className="font-display text-xl text-warm-dark">Your photos</h2>
      <p className="mt-1 text-sm text-muted">
        Stylists see these on your profile. Photos you add to an application end up here too.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white">
          {uploading ? 'Uploading…' : 'Add photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            onChange={e => onPick(e.target.files)}
            className="sr-only"
          />
        </label>

        <span className="text-xs text-muted">JPG or PNG, up to 8MB each.</span>
      </div>

      {/* Groups are hers to name — the same `model_photo_categories` rows
          mobile's "Add category" writes, so a group made on either shows on
          both. */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="new-cat" className="block text-xs font-bold text-warm-dark">
            New group
          </label>
          <input
            id="new-cat"
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            placeholder="e.g. Hair, Nails"
            maxLength={40}
            className="mt-1 min-h-11 w-44 rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark"
          />
        </div>
        <button
          onClick={() => run(async () => {
            const res = await addPhotoCategory(newCategory)
            if (res.ok) setNewCategory('')
            return res
          })}
          disabled={pending || !newCategory.trim()}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-rose disabled:text-muted"
        >
          Add group
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {photos.length === 0 ? (
        <p className="mt-4 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          No photos yet. Stylists choose models partly on what your hair, skin or nails look like
          now, so a few recent photos make a real difference to whether you’re picked.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {photos.map(p => (
            <li key={p.id} className="rounded-lg border border-hairline bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, unknown dimensions */}
              <img
                src={p.url}
                alt={p.caption ?? 'Your photo'}
                className="h-48 w-full rounded-md object-cover"
              />

              <div className="mt-2 space-y-2">
                {editing === p.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={captionDraft}
                      onChange={e => setCaptionDraft(e.target.value)}
                      maxLength={120}
                      placeholder="Add a caption"
                      className="min-h-11 flex-1 rounded-md border border-hairline px-2 text-sm"
                    />
                    <button
                      onClick={() => run(async () => {
                        const res = await savePhotoCaption(p.id, captionDraft)
                        if (res.ok) setEditing(null)
                        return res
                      })}
                      disabled={pending}
                      className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-4 text-sm font-bold text-white"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditing(p.id); setCaptionDraft(p.caption ?? '') }}
                    className="text-sm text-rose hover:underline"
                  >
                    {p.caption ? `“${p.caption}” — edit` : 'Add a caption'}
                  </button>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`cat-${p.id}`} className="sr-only">Group</label>
                  <select
                    id={`cat-${p.id}`}
                    value={p.categoryId ?? ''}
                    onChange={e => run(() => setPhotoCategory(p.id, e.target.value))}
                    disabled={pending}
                    className="min-h-11 rounded-md border border-hairline bg-white px-2 text-sm text-warm-dark"
                  >
                    <option value="">No group</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>

                  <button
                    onClick={() => run(() => deletePhoto(p.id))}
                    disabled={pending}
                    className="ml-auto min-h-11 px-2 text-sm font-bold text-muted hover:text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
