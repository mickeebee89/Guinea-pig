import { requireUser } from '@/lib/supabase-server'
import { SignOutButton } from '@/components/SignOutButton'

/**
 * Placeholder. Slice 1 is auth only — this exists to prove a session survives
 * the round trip and to host the sign-out button. The real member area is
 * slice 2.
 */
export default async function Dashboard() {
  const user = await requireUser()

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-warm-dark">You’re signed in</h1>
      <p className="mt-2 text-muted">{user?.email}</p>

      <dl className="mt-8 space-y-3 rounded-lg border border-hairline bg-white p-6 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Role</dt>
          <dd className="font-bold text-warm-dark">{String(user?.user_metadata?.role ?? '—')}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Name</dt>
          <dd className="font-bold text-warm-dark">
            {String(user?.user_metadata?.first_name ?? '')}{' '}
            {String(user?.user_metadata?.last_initial ?? '')}
          </dd>
        </div>
        {user?.user_metadata?.signup_source ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Signed up via</dt>
            <dd className="font-bold text-warm-dark">{String(user.user_metadata.signup_source)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </section>
  )
}
