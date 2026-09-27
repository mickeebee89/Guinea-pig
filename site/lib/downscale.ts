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
 * ⚠️ WHAT A MEMBER IS TOLD WHEN WE CANNOT READ THEIR PHOTO.
 *
 * One message, in one place, because it is shown on five surfaces and the
 * remedy is the same on all of them. It names what to DO, not what went wrong:
 * "unsupported format" tells somebody they have failed at something they did
 * not know they were doing.
 */
export const UNREADABLE_IMAGE_MESSAGE =
  'We can’t read that photo — phone photos are often saved as HEIC, which browsers can’t open. ' +
  'Save or export it as JPEG and try again.'

/** Thrown when the browser could not decode the file at all. */
export class UnreadableImageError extends Error {
  constructor() {
    super(UNREADABLE_IMAGE_MESSAGE)
    this.name = 'UnreadableImageError'
  }
}

/**
 * The same thing, for callers that want a File to put in a FormData.
 *
 * ── ⚠️ IT USED TO SWALLOW THE FAILURE, AND THAT WAS THE BUG ──────────
 *
 * Until 27 Sep 2026 this caught a decode failure and returned the ORIGINAL, so
 * a photo was "always sent". Three callers relied on that and each wrote down
 * why — and all three arguments rested on a SIZE CAP catching what the decoder
 * could not read. HEIC is engineered to be small, so it passes every cap this
 * product has: 3MB on the selfie, 8MB on an application photo, 10MB on a
 * portfolio image. A phone HEIC is 1–3MB.
 *
 * So the file uploaded, the UI said it worked, and it rendered nowhere. On the
 * ID check that meant an admin opening a blank image against a paid £14.99.
 *
 * VERIFIED 27 Sep in the browser pane rather than inferred: an undecodable file
 * typed image/jpeg makes createImageBitmap throw InvalidStateError, comes back
 * from here byte-identical, and fails to render in an <img> while a real PNG
 * through the same path renders. Audit item 125.
 *
 * `downscale()` already answers "can this browser render it?" for free. The
 * answer is now passed on instead of discarded.
 */
export async function downscaleToFile(file: File, name = 'photo.jpg'): Promise<File> {
  try {
    const blob = await downscale(file)
    // A resize that made it bigger is not a resize. Small PNGs re-encoded as
    // JPEG can do this, and sending the larger one would be an odd way to save
    // bandwidth. Safe to keep the original here: it DECODED, so it renders.
    if (blob.size >= file.size) return file
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (err) {
    console.warn('[downscale] the browser could not decode this file', err)
    throw new UnreadableImageError()
  }
}
