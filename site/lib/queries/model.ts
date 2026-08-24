import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'

/**
 * A model's profile, for signed-in members on the web.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * It did not, and `ChatThread.tsx` said so in a comment: "a model's id here is
 * an auth user id and there is no page for it yet." A stylist on the web could
 * open a model's chat and nothing else — so when report and block moved onto
 * profile screens, a stylist on the web would still have had nowhere to report
 * a model FROM. The gap would have moved rather than closed, on the side of the
 * marketplace being actively recruited.
 *
 * ── THE ID IS AN AUTH USER ID ─────────────────────────────────────────────
 * Unlike `/stylist/[id]`, which takes a `providers.id`. The two profile routes
 * on this site take different kinds of id and always will, because a model has
 * no provider row. That asymmetry is the reason `lib/report.ts` takes a tagged
 * subject rather than a string.
 *
 * Reads identity through `public_profiles` rather than `users`, matching mobile
 * — a first name plus initial is what a stranger is allowed to see.
 */

const BUCKET = 'model-photos'
const PUBLIC_MARKER = `/object/public/${BUCKET}/`
const SIGN_TTL_SECONDS = 3600

export type ModelPhoto = {
  id: string
  url: string
  caption: string | null
  categoryId: string | null
}

export type ModelProfile = {
  userId: string
  name: string
  avatarUrl: string | null
  instagram: string | null
  bio: string | null
  attributes: { label: string; value: string }[]
  photos: ModelPhoto[]
  categories: { id: string; name: string }[]
  isSelf: boolean
  isBlocked: boolean
}

/** Port of mobile's toObjectPath — tolerates a bare path or a legacy public URL. */
function toObjectPath(stored: string): string {
  if (!stored) return ''
  const i = stored.indexOf(PUBLIC_MARKER)
  const raw = i >= 0 ? stored.slice(i + PUBLIC_MARKER.length) : stored
  return raw.replace(/^\/+/, '').split('?')[0]
}

/** Attribute rows, in the order a person reads them. Empty values are dropped. */
const ATTRIBUTE_FIELDS: [keyof ModelAttrRow, string][] = [
  ['hair_colour',     'Hair colour'],
  ['hair_type',       'Hair type'],
  ['hair_length',     'Hair length'],
  ['hair_condition',  'Hair condition'],
  ['skin_tone',       'Skin tone'],
  ['skin_type',       'Skin type'],
  ['eye_colour',      'Eye colour'],
  ['eye_shape',       'Eye shape'],
  ['nail_condition',  'Nails'],
]

type ModelAttrRow = {
  hair_colour: string | null
  hair_type: string | null
  hair_length: string | null
  hair_condition: string | null
  skin_tone: string | null
  skin_type: string | null
  eye_colour: string | null
  eye_shape: string | null
  nail_condition: string | null
  bio: string | null
}

export async function getModelProfile(
  supabase: SupabaseClient,
  modelUserId: string,
  viewerId: string,
): Promise<ModelProfile | null> {
  const { data: prof } = await supabase
    .from('public_profiles')
    .select('id, first_name, last_initial, profile_pic_url, instagram_handle')
    .eq('id', modelUserId)
    .maybeSingle()

  // Not found and not visible to you both land here, on purpose — same as
  // /stylist/[id]. Note this is the PROFILE being absent, which is different
  // from the account being absent: a deleted account has no public_profiles row
  // either, and reporting one is handled by lib/report.ts, not here.
  if (!prof) return null

  const p = prof as {
    id: string; first_name: string | null; last_initial: string | null
    profile_pic_url: string | null; instagram_handle: string | null
  }

  const [{ data: attrData }, { data: photoData }, { data: catData }, blocked] = await Promise.all([
    supabase.from('model_attributes')
      .select('hair_colour, hair_type, hair_length, hair_condition, skin_tone, skin_type, ' +
              'eye_colour, eye_shape, nail_condition, bio')
      .eq('user_id', modelUserId).maybeSingle(),
    supabase.from('model_photos')
      .select('id, photo_url, caption, category_id')
      .eq('user_id', modelUserId).order('created_at', { ascending: true }),
    supabase.from('model_photo_categories')
      .select('id, name, sort_order')
      .eq('user_id', modelUserId).order('sort_order'),
    getBlockedIds(supabase, viewerId).catch(() => new Set<string>()),
  ])

  const attrs = (attrData ?? null) as ModelAttrRow | null
  const attributes = attrs
    ? ATTRIBUTE_FIELDS
        .map(([key, label]) => ({ label, value: (attrs[key] ?? '') as string }))
        .filter(a => a.value.trim().length > 0)
    : []

  // Booking photos live in a PRIVATE bucket. The row stores the object path, so
  // a signed URL is minted per render. Signing failures fall back to the stored
  // value per file rather than dropping the whole gallery.
  const rows = ((photoData ?? []) as {
    id: string; photo_url: string; caption: string | null; category_id: string | null
  }[])
  const signedByPath = new Map<string, string>()
  if (rows.length > 0) {
    const paths = [...new Set(rows.map(r => toObjectPath(r.photo_url)).filter(Boolean))]
    const { data: signed, error: signErr } = await supabase
      .storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS)
    if (signErr) console.warn('[model] createSignedUrls failed:', signErr.message)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  return {
    userId: p.id,
    name: `${p.first_name ?? ''}${p.last_initial ? ' ' + p.last_initial + '.' : ''}`.trim() || 'Model',
    avatarUrl: p.profile_pic_url,
    instagram: p.instagram_handle,
    bio: attrs?.bio ?? null,
    attributes,
    photos: rows.map(r => ({
      id: r.id,
      url: signedByPath.get(toObjectPath(r.photo_url)) ?? r.photo_url,
      caption: r.caption,
      categoryId: r.category_id,
    })),
    categories: ((catData ?? []) as { id: string; name: string }[])
      .map(c => ({ id: c.id, name: c.name })),
    isSelf: p.id === viewerId,
    isBlocked: blocked.has(p.id),
  }
}
