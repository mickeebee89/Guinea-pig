import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getMyProfile } from '@/lib/queries/my-profile'
import { getDashboardUser } from '@/lib/queries/dashboard'
import { getIdCheck } from '@/lib/queries/idCheck'
import { getGateFlags } from '@/lib/verification'
import { isModel as isModelRole } from '@/lib/roles'
import { EmptyState, LoadError } from '@/components/ui'
import { AvatarUpload } from '@/components/AvatarUpload'
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
  // A 'both' account has a model side, so it gets this page (item 116).
  if (!isModelRole(me.role)) {
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

  // ⚠️ getIdCheck, not getStylistSetup — she has no provider row, and that
  // function answers EMPTY_SETUP (idCheck: 'none') for anyone who has not.
  // ⚠️ TWO DIFFERENT QUESTIONS, AND THE CARD NEEDS BOTH. `getIdCheck` is
  // whether she has passed; the flag is whether anyone is asking her to. With
  // the flag off the card is an offer, and with it on the card is a gate.
  const [idCheck, flags] = await Promise.all([
    getIdCheck(supabase, user.id),
    getGateFlags(supabase),
  ])
  const idCheckRequired = flags.verificationRequired

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

      {/* ⚠️ THE ONE LINK THAT MAKES /verify REACHABLE FOR A MODEL. Added
          6 Nov 2026 with the ID check moving there. /verify is in no nav for
          either role — a stylist arrives from the setup panel or Settings, and
          until today a model had no reason to arrive at all. The dashboard
          checklist is the other route; this is the one that sits beside the
          profile photo her check is compared against. */}
      {/* ── ⚠️⚠️ KEPT AND REWORDED, NOT DROPPED, AND THE REASON IS REACH ──
          With `verification_required_to_apply` false, nothing on this website
          asks a model to verify — the dashboard checklist row is gone with the
          gate. /verify is in no nav for either role, so THIS CARD IS THE ONLY
          WAY A MODEL CAN FIND IT. Dropping it while the flag is off would make
          voluntary verification unreachable for the role it matters most to,
          which is the opposite of keeping the route open.

          ⚠️ SO THE CARD CHANGES REGISTER, NOT PRESENCE. While the flag is off:
          the rose border goes (it is the styling this file uses for something
          that needs attention), the heading says "optional" in the first word,
          and the body sells the badge instead of naming a condition. Nothing
          in it may imply anything is owed.

          ⚠️ "it doesn’t need a membership first" IS GONE EITHER WAY. There is
          no membership to need: `subscription_enabled` is false, so the
          sentence reassures her about an obstacle that does not exist and
          tells her there is one. */}
      {idCheck.state !== 'approved' && (
        <section className={`mb-8 rounded-lg border bg-white p-5 shadow-card ${
          idCheckRequired ? 'border-rose/30' : 'border-hairline'
        }`}>
          <h2 className="font-display text-lg text-warm-dark">
            {idCheck.state === 'pending' ? 'Your ID check is with us'
              : idCheck.state === 'rejected' ? 'Your ID check needs doing again'
              : idCheckRequired ? 'Your ID check'
              : 'Optional: the ID check'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {idCheck.state === 'pending'
              ? 'A person looks at these — not a computer — usually within 24 hours. Nothing for you to do.'
              : idCheckRequired
                ? 'One selfie holding a handwritten note, looked at by a person. You can do it now — you don’t need to have chosen a stylist first.'
                : 'One selfie holding a handwritten note, looked at by a person. It puts a “photo checked” badge on your profile, which is what a stylist looks for when she’s deciding who to take. You don’t need it to apply for anything — it just makes it easier for someone to say yes.'}
          </p>
          {idCheck.state !== 'pending' && (
            <Link
              href="/verify"
              className={`mt-4 inline-flex min-h-11 items-center rounded-[999px] px-6 text-sm font-bold ${
                idCheckRequired
                  ? 'bg-rose text-white'
                  // Not the primary pink pill while it is optional: on a page
                  // whose own intro says "you don't have to fill any of it in",
                  // the loudest button should not be the one thing nobody is
                  // asking for.
                  : 'bg-input-bg text-rose hover:bg-soft-pink'
              }`}
            >
              {idCheck.state === 'rejected' ? 'Try again' : 'Do your ID check'}
            </Link>
          )}
        </section>
      )}

      <div className="space-y-8">
        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="mb-4 font-display text-xl text-warm-dark">Your photo</h2>
          <AvatarUpload initialUrl={profile.avatarUrl} name={profile.name} audience="model" />
        </section>

        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <AttributesForm
            initial={profile.attributes}
            initialBio={profile.bio}
            initialInstagram={profile.instagram}
          />
        </section>

        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <PhotoManager photos={profile.photos} categories={profile.categories} />
        </section>
      </div>
    </>
  )
}
