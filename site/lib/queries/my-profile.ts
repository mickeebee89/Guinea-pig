import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A model's OWN profile, for editing. Audit item 99.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS: THE NAV GAVE A STYLIST THREE ROUTES AND A MODEL NONE
 * ══════════════════════════════════════════════════════════════════════════
 * A stylist has Shop, Availability and Portfolio — three places to build what
 * other people see of her. A model had zero. Nothing in `site/` wrote
 * `model_attributes`, nothing set a profile picture, and every `/model/[id]`
 * link on the site pointed at somebody else, so she could not even LOOK at
 * her own profile.
 *
 * What that cost her is specific, not cosmetic: the nine attributes are what
 * a stylist picks on, and item 96 has just made a stylist's view of a model
 * richer still. A web-only model applied as a name and a photo she could not
 * choose, and had no way to find out why she was being refused.
 *
 * ── THE ONE THING SHE COULD ALREADY DO, BY ACCIDENT ───────────────────────
 * The apply wizard uploads into `model_photos`, so a web-only model DOES have
 * photos — uncategorised, uncaptioned, and until now invisible to her. That
 * is why photo management is part of this rather than a later nicety: the
 * rows already existed and she could not see them.
 */

export interface MyPhoto {
  id: string
  url: string
  caption: string | null
  categoryId: string | null
}

export interface MyProfile {
  userId: string
  name: string
  avatarUrl: string | null
  instagram: string | null
  bio: string | null
  /** Raw column values, keyed by column name. Empty string means "not set". */
  attributes: Record<AttributeKey, string>
  photos: MyPhoto[]
  categories: { id: string; name: string }[]
}

const BUCKET = 'model-photos'
const PUBLIC_MARKER = `/object/public/${BUCKET}/`
const SIGN_TTL_SECONDS = 3600

/** Port of mobile's toObjectPath — tolerates a bare path or a legacy public URL. */
function toObjectPath(stored: string): string {
  if (!stored) return ''
  const i = stored.indexOf(PUBLIC_MARKER)
  const raw = i >= 0 ? stored.slice(i + PUBLIC_MARKER.length) : stored
  return raw.replace(/^\/+/, '').split('?')[0]
}

/**
 * ⚠️ THE ORDER AND THE OPTIONS MUST MATCH mobile's ATTR_DEFS EXACTLY
 * (model-profile.tsx:62-72). Two clients offering different words for the same
 * column would put "Dark Brown" and "dark brown" in one table, and the stylist
 * filters read the stored string.
 *
 * `model_attributes` also carries a `*_custom` column for all nine. NOTHING
 * writes any of them, on either client, so they are not offered here — adding
 * a free-text option on one client only would create a value the other cannot
 * show.
 */

/**
 * The nine columns, as a union rather than `string`.
 *
 * ⚠️ NOT COSMETIC. The write is `{ [key]: value }` with a computed key, and a
 * `string` key widens that to an index signature the generated Update type
 * refuses — which is exactly what it should do, since an arbitrary key would
 * be a column that does not exist. Same class as the review insert in item 84,
 * and caught the same way: by the types, before anything ran.
 *
 * (The block above governs the OPTIONS; this one governs the KEYS.)
 */
export type AttributeKey =
  | 'hair_colour' | 'hair_type' | 'hair_length' | 'hair_condition'
  | 'skin_tone' | 'skin_type'
  | 'eye_colour' | 'eye_shape' | 'nail_condition'

export const ATTRIBUTE_DEFS: { key: AttributeKey; label: string; options: string[] }[] = [
  { key: 'hair_colour',    label: 'Hair colour',    options: ['Black', 'Dark Brown', 'Medium Brown', 'Light Brown', 'Blonde', 'Platinum Blonde', 'Red', 'Auburn', 'Grey', 'White', 'Dyed'] },
  { key: 'hair_type',      label: 'Hair type',      options: ['Straight', 'Wavy', 'Curly', 'Coily'] },
  { key: 'hair_length',    label: 'Hair length',    options: ['Short', 'Medium', 'Long', 'Very Long'] },
  { key: 'hair_condition', label: 'Hair condition', options: ['Healthy', 'Dry', 'Oily', 'Colour-treated', 'Damaged'] },
  { key: 'skin_tone',      label: 'Skin tone',      options: ['Fair', 'Light', 'Medium', 'Olive', 'Brown', 'Dark Brown', 'Deep'] },
  { key: 'skin_type',      label: 'Skin type',      options: ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive', 'Acne-prone'] },
  { key: 'eye_colour',     label: 'Eye colour',     options: ['Brown', 'Dark Brown', 'Hazel', 'Green', 'Blue', 'Grey', 'Amber'] },
  { key: 'eye_shape',      label: 'Eye shape',      options: ['Round', 'Almond', 'Hooded', 'Monolid', 'Upturned', 'Downturned'] },
  { key: 'nail_condition', label: 'Nails',          options: ['Healthy', 'Brittle', 'Bitten', 'Long natural', 'Short', 'Acrylic', 'Gel'] },
]

/** The bio cap, matching mobile's counter exactly. */
export const BIO_MAX = 200

export async function getMyProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyProfile | null> {
  // users, not public_profiles: this is her own row, and profile_pic_url is
  // on both but the rest of what she may edit is not.
  const { data: me } = await supabase
    .from('users')
    .select('id, first_name, last_initial, profile_pic_url, instagram_handle')
    .eq('id', userId)
    .maybeSingle()
  if (!me) return null
  const u = me as {
    id: string; first_name: string | null; last_initial: string | null
    profile_pic_url: string | null; instagram_handle: string | null
  }

  const [{ data: attrData }, { data: photoData }, { data: catData }] = await Promise.all([
    supabase.from('model_attributes')
      .select('hair_colour, hair_type, hair_length, hair_condition, skin_tone, skin_type, ' +
              'eye_colour, eye_shape, nail_condition, bio')
      .eq('user_id', userId).maybeSingle(),
    supabase.from('model_photos')
      .select('id, photo_url, caption, category_id')
      .eq('user_id', userId).order('created_at', { ascending: true }),
    supabase.from('model_photo_categories')
      .select('id, name, sort_order')
      .eq('user_id', userId).order('sort_order'),
  ])

  const attrs = (attrData ?? {}) as Record<string, string | null>

  // Same private bucket and the same per-file fallback as the profile a
  // stylist sees, so the two renders of her photos cannot disagree.
  const rows = (photoData ?? []) as {
    id: string; photo_url: string; caption: string | null; category_id: string | null
  }[]
  const signedByPath = new Map<string, string>()
  if (rows.length > 0) {
    const paths = [...new Set(rows.map(r => toObjectPath(r.photo_url)).filter(Boolean))]
    const { data: signed, error } = await supabase
      .storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS)
    if (error) console.warn('[my-profile] createSignedUrls failed:', error.message)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  return {
    userId: u.id,
    name: `${u.first_name ?? ''}${u.last_initial ? ' ' + u.last_initial + '.' : ''}`.trim() || 'You',
    avatarUrl: u.profile_pic_url,
    instagram: u.instagram_handle,
    bio: attrs.bio ?? null,
    // Built by mapping the DEFS, so every key is real and every one is
    // present — a missing key and an empty one must look the same to the form.
    attributes: ATTRIBUTE_DEFS.reduce(
      (acc, d) => { acc[d.key] = attrs[d.key] ?? ''; return acc },
      {} as Record<AttributeKey, string>,
    ),
    photos: rows.map(r => ({
      id: r.id,
      url: signedByPath.get(toObjectPath(r.photo_url)) ?? r.photo_url,
      caption: r.caption,
      categoryId: r.category_id,
    })),
    categories: ((catData ?? []) as { id: string; name: string }[])
      .map(c => ({ id: c.id, name: c.name })),
  }
}
