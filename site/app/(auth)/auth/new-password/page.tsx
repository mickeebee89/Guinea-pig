import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase-server'
import { NewPasswordForm } from './NewPasswordForm'

export const metadata = { title: 'Choose a new password', robots: { index: false, follow: false } }

/**
 * Set a new password after arriving from a reset link.
 *
 * /auth/reset already exchanged the link for a session, so reaching this page
 * without one means the link was never followed, was already used, or has
 * expired. Sending those to /auth/problem is deliberate: this page must not
 * render a password form to someone who has not proved they own the mailbox.
 */
export default async function NewPasswordPage() {
  const user = await getUser()
  if (!user) {
    redirect('/auth/problem?reason=Open%20the%20reset%20link%20from%20your%20email%20first')
  }

  return (
    <section className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-display text-3xl text-warm-dark">Choose a new password</h1>
      <p className="mt-2 text-muted">Signed in as {user.email}</p>
      <NewPasswordForm />
    </section>
  )
}
