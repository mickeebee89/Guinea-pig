import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase-server'
import { SignInForm } from './SignInForm'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
}

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ next?: string }> }) {
  const user = await getUser()
  if (user) redirect('/dashboard')

  const { next } = await searchParams
  // Only same-origin paths. An open redirect on a sign-in page hands attackers
  // a credible-looking link that lands somewhere else entirely.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  return (
    <section className="mx-auto max-w-md px-6 py-12 sm:py-16">
      <h1 className="font-display text-4xl text-warm-dark">Sign in</h1>
      <p className="mt-2 text-muted">Same account as the app.</p>
      <SignInForm next={safeNext} />
    </section>
  )
}
