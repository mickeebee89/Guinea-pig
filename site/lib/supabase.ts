import { createClient } from '@supabase/supabase-js'

/**
 * Anonymous, server-side-only Supabase client for the public website.
 *
 * DELIBERATELY NOT `@supabase/ssr`'s createBrowserClient (which is what the
 * admin app's lib/supabase.ts uses). That client is cookie- and session-bound;
 * reading cookies makes a route implicitly dynamic and opts it out of static
 * rendering, which would break SEO for every page on this site. There is no
 * user here and never will be — no session to persist, no token to refresh.
 *
 * The env var is SUPABASE_ANON_KEY, WITHOUT the NEXT_PUBLIC_ prefix. The key is
 * public by design (it ships inside the mobile app), so this is not a security
 * boundary — it is a forcing function. Unprefixed, the key is unreachable from
 * Client Components, which makes it impossible to accidentally write a
 * client-side query that bypasses the ISR cache, breaks SEO for that content,
 * and hits Supabase once per visitor instead of once per revalidate window.
 *
 * Every read goes through the public_* views. Those are the only objects anon
 * can reach; all base tables return zero rows to this client by design.
 */

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_ANON_KEY must be set. Copy site/.env.local.example to site/.env.local.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

/** Shape of one row of public_stylists. Mirrors supabase/public-web-views.sql. */
export interface PublicStylist {
  id: string
  slug: string
  short_id: string
  name: string
  bio: string | null
  region: string | null
  location: string | null
  location_slug: string | null
  profile_pic_url: string | null
  banner_url: string | null
  is_verified: boolean
  level: string | null
  status_text: string | null
  categories: string[]
  category_slugs: string[]
  rating: number | null
  review_count: number
  has_open_slots: boolean
}

export interface PublicCategory {
  slug: string
  name: string
  icon_name: string | null
  colour_hex: string | null
  sort_order: number | null
}
