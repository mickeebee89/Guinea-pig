import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase-server'
import { SignUpForm } from './SignUpForm'
import type { SignupRole } from '@/lib/signup'

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Join Cavy as a stylist building your portfolio, or as a model who wants the treatment.',
  // Deliberately not indexed. The public pages are the SEO surface; a signup
  // form ranking for nothing while diluting them helps no one.
  robots: { index: false, follow: true },
}

/**
 * ?role=stylist|model  — preselects the role, so /for-stylists and /for-models
 *                        can link straight in rather than asking twice.
 * ?ref=<code>          — cohort attribution. A course leader shares a link and
 *                        their tranche is identifiable, so Founding Provider
 *                        status can be honoured for the group.
 *
 * ATTRIBUTION ONLY. It records where a signup came from; it creates nothing on
 * anyone's behalf. Bulk-creating accounts for a cohort would mean the college
 * owns them, students inherit accounts they never signed up for, and both
 * consent and the 18+ gate break — you cannot confirm someone else is over 18
 * or accept terms for them.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; ref?: string }>
}) {
  // Already signed in? Nothing here is useful.
  const user = await getUser()
  if (user) redirect('/dashboard')

  const { role: roleParam, ref } = await searchParams

  // The public pages speak of "stylists"; the database says "provider".
  const initialRole: SignupRole | null =
    roleParam === 'stylist' || roleParam === 'provider' ? 'provider'
    : roleParam === 'model' ? 'model'
    : null

  const source = ref?.trim().slice(0, 120) || null

  return (
    <section className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
      <h1 className="font-display text-4xl text-warm-dark">Create your account</h1>
      <p className="mt-2 text-muted">
        Same account on the web and in the app — sign up here, sign in there.
      </p>

      {source && (
        <p className="mt-4 rounded-md border border-hairline bg-white px-4 py-3 text-sm text-muted">
          Signing up via <strong className="text-warm-dark">{source}</strong>.
        </p>
      )}

      <div className="mt-8">
        <SignUpForm initialRole={initialRole} source={source} />
      </div>
    </section>
  )
}
