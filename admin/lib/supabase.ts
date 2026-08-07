import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Auth-aware browser client for App Router client components. Via @supabase/ssr the
// session is persisted in COOKIES (not localStorage), so middleware/server can read
// it later. Still the anon key — anon key + a logged-in Supabase session is how
// Supabase Auth works (no service-role key here). Same `supabase` export the pages
// already import, so nothing else changes yet.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
