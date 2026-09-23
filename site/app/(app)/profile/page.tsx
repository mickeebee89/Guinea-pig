import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getMyProfile } from '@/lib/queries/my-profile'
import { getDashboardUser } from '@/lib/queries/dashboard'
import { EmptyState, LoadError } from '@/components/ui'
import { AvatarUpload } from './AvatarUpload'
import { AttributesForm } from './AttributesForm'
import { PhotoManager } from './PhotoManager'

export const metadata = { title: 'Your profile' }

/**
 * A model's own profile. Audit item 99.
 *
 * ── THE ASYMMETRY THIS CLOSES ─────────────────────────────────────────────
 * A stylist has Shop, Availability and Portfolio — three routes to build what
 * other people see of her. A model had none: nothing in `site/` wrote
 * `model_attributes`, nothing set a profile picture, and every `/model/[id]`
 * link pointed at somebody else, so she could not even look at her own
 * profile. She applied as a name and a photo she could not choose.
 *
 * ── WHY "See what stylists see" IS A LINK AND NOT A PREVIEW ───────────────
 * `/model/[id]` already renders exactly what a stylist sees, and it works for
 * her own id — `isSelf` only hides the safety menu. A second preview would be
 * a copy that could disagree with the real one, which is how the stylist's
 * "See what models see" was worth building and a duplicate would not be.
 */
export default async function ProfilePage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  // The same guard as /browse, and for the same reason: hiding the nav link
  // from a stylist is not a gate, and a stylist who typed the URL would get a
  // page for editing model attributes that her account has no use for.
  const me = await getDashboardUser(supabase, user.id)
  if (me.role === 'provider') {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Your profile</h1>
        <EmptyState title="This is for model accounts">
          Your shop is what models see of you — edit it under{' '}
          <Link href="/shop" className="font-bold text-rose hover:underline">Shop</Link>, and your
          work under <Link href="/portfolio" className="font-bold text-rose hover:underline">Portfolio</Link>.
        </EmptyState>
      </>
    )
  }

  const profile = await getMyProfile(supabase, user.id).catch(e => {
    console.error('[profile] load failed', e)
    return null
  })
  if (!profile) return <LoadError what="your profile" />

  return (
    <>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-warm-dark">Your profile</h1>
        <Link
          href={`/model/${profile.userId}`}
          className="text-sm font-bold text-rose hover:underline"
        >
          See what stylists see →
        </Link>
      </div>

      <p className="mb-6 max-w-2xl text-sm text-muted">
        This is what a stylist looks at when deciding who to take. You don’t have to fill any of
        it in — but the more of it you do, the easier it is for someone to say yes.
      </p>

      <div className="space-y-8">
        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="mb-4 font-display text-xl text-warm-dark">Your photo</h2>
          <AvatarUpload initialUrl={profile.avatarUrl} name={profile.name} />
        </section>

        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <AttributesForm initial={profile.attributes} initialBio={profile.bio} />
        </section>

        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <PhotoManager photos={profile.photos} categories={profile.categories} />
        </section>
      </div>
    </>
  )
}
