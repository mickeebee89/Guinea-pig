import { getUser } from '@/lib/supabase-server'

// Placeholder. Its only job right now is to be a real cookie-reading route, so
// the build proves that (public) stays static alongside one.
export default async function Dashboard() {
  const user = await getUser()
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-warm-dark">Signed in</h1>
      <p className="mt-2 text-muted">{user?.email}</p>
    </section>
  )
}
