/**
 * Shrink a photo in the browser before it is uploaded. Audit item 86.
 *
 * ── WHY IT IS SHARED, AND WHY IT WAS NOT ──────────────────────────────────
 * This was written inside SelfieCapture, where the reasoning is recorded: a
 * modern phone photo is 3–5MB, most of it detail nobody needs, and the upload
 * happens on whatever signal a salon has.
 *
 * Every word of that is equally true of the photos a model attaches to an
 * application — and those went up whole, because the resize lived in the one
 * component that happened to need it first. Same numbers here, in one place,
 * so the two cannot drift into "the selfie is resized and the application
 * photos are not" a second time.
 *
 * ── IT IS BEST-EFFORT, AND THE CALLER MUST TREAT IT THAT WAY ──────────────
 * createImageBitmap, canvas and toBlob can all fail — an image format the
 * browser cannot decode, a canvas the OS refuses to allocate, a HEIC from an
 * older iPhone. On failure the ORIGINAL should be sent: a large upload is a
 * worse experience, a refused upload is a lost application. Both callers do
 * that, and the server caps the size either way.
 */

/** Long edge, in pixels. Matches mobile's ImageManipulator resize. */
const MAX_WIDTH = 1080
const QUALITY = 0.85

export async function downscale(file: File): Promise<Blob> {
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

/**
 * The same thing, for callers that want a File to put in a FormData and do not
 * want to write the fallback themselves. Never throws: the original comes back
 * if anything goes wrong, so a photo is always sent.
 */
export async function downscaleToFile(file: File, name = 'photo.jpg'): Promise<File> {
  try {
    const blob = await downscale(file)
    // A resize that made it bigger is not a resize. Small PNGs re-encoded as
    // JPEG can do this, and sending the larger one would be an odd way to save
    // bandwidth.
    if (blob.size >= file.size) return file
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[downscale] falling back to the original file', err)
    return file
  }
}
