import { supabase } from '@/lib/supabase'

// Model booking photos live in the PRIVATE `model-photos` bucket. Files are served
// via short-lived signed URLs (not public URLs), so only authenticated users — the
// owner and a stylist viewing them — can load an image. The DB stores the object
// PATH (`<userId>/<file>.jpg`); this helper mints a signed URL at render time.
//
// It is deliberately tolerant: it accepts either a bare path OR a legacy full public
// URL (`…/object/public/model-photos/<path>`), so rows written before the migration
// still render without a backfill. Signed URLs are cached by path so the same
// <Image> URI is reused within a session (cache hits, no re-download churn).

const BUCKET = 'model-photos'
const PUBLIC_MARKER = `/object/public/${BUCKET}/`
const SIGN_TTL_SECONDS = 3600 // signed-URL validity (1 hour)
const CACHE_TTL_MS = 50 * 60 * 1000 // re-sign a little before expiry so URLs never go stale mid-view

type CacheEntry = { url: string; expires: number }
const cache = new Map<string, CacheEntry>()

// Recover the storage object path from a stored value that may be a bare path or a
// legacy full public URL. Strips any leading slash and query string (cache-buster).
export function toObjectPath(stored: string): string {
  if (!stored) return ''
  const i = stored.indexOf(PUBLIC_MARKER)
  const raw = i >= 0 ? stored.slice(i + PUBLIC_MARKER.length) : stored
  return raw.replace(/^\/+/, '').split('?')[0]
}

// Sign many stored values at once. Returns a Map keyed by the ORIGINAL stored value
// → signed URL, so a caller can look up by whatever string it holds. On a signing
// failure the original value is returned as a best-effort fallback.
export async function signModelPhotos(stored: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const out = new Map<string, string>()
  const need: { stored: string; path: string }[] = []

  for (const s of stored) {
    if (!s) { out.set(s, s); continue }
    const path = toObjectPath(s)
    const hit = cache.get(path)
    if (hit && hit.expires > now) out.set(s, hit.url)
    else need.push({ stored: s, path })
  }
  if (need.length === 0) return out

  const paths = [...new Set(need.map(n => n.path))]
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS)
  if (error || !data) {
    console.warn('signModelPhotos: createSignedUrls failed:', error?.message)
    for (const n of need) out.set(n.stored, n.stored) // fallback: original value
    return out
  }

  const byPath = new Map<string, string>()
  for (const row of data) {
    if (row.signedUrl && row.path) byPath.set(row.path, row.signedUrl)
  }
  for (const n of need) {
    const url = byPath.get(n.path)
    if (url) {
      cache.set(n.path, { url, expires: now + CACHE_TTL_MS })
      out.set(n.stored, url)
    } else {
      out.set(n.stored, n.stored) // per-file fallback
    }
  }
  return out
}

// Sign a single stored value (used right after an upload to render immediately).
export async function signModelPhoto(stored: string): Promise<string> {
  const m = await signModelPhotos([stored])
  return m.get(stored) ?? stored
}
