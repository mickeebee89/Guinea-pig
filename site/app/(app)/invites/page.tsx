import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getReceivedInvites } from '@/lib/queries/invites'
import { EmptyState, LoadError, Avatar } from '@/components/ui'
import { SafetyMenu } from '@/components/SafetyMenu'
import { DeclineButton } from './DeclineButton'

export const metadata = { title: 'Invites' }

/**
 * Invitations a model has been sent.
 *
 * ── ⚠️ WHY THIS IS A PAGE AND NOT JUST A NOTIFICATION ────────────────────
 * The notification already existed and already reached her inbox. What it
 * could not do is carry a VERB. A notification is a sentence; declining,
 * blocking and reporting are things she does, and they need somewhere to be
 * done. Before 0113 an invite had no "no" — the only responses available were
 * to apply or to let it sit.
 *
 * ── WHAT A DECLINE TELLS THE STYLIST ─────────────────────────────────────
 * The status on her own list, and nothing else. No notification, no email, no
 * reason. Saying no has to cost nothing, or it is not a real option.
 *
 * ── BLOCK AND REPORT ARE THE EXISTING ONES ───────────────────────────────
 * SafetyMenu, the `blocks` table and `reportUser` are reused exactly as they
 * are on a stylist's profile and in a chat. A second block that only applied
 * to invites would be a second thing to keep in step with the first, and the
 * one that already exists is the one with mutual filtering wired through
 * every surface — including invitable_models, so blocking a stylist here
 * removes the model from that stylist's list as well.
 */
export default async function InvitesPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const invites = await getReceivedInvites(supabase, user.id)

  return (
    <>
      <h1 className="mb-2 font-display text-3xl text-warm-dark">Invites</h1>
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Stylists with a published shop can invite you, at most once a day each. You don’t have
        to answer — and{' '}
        <span className="font-bold text-warm-dark">declining stops that stylist for good</span>,
        not just today. If you’d rather not be asked at all, you can turn invites off in{' '}
        <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>.
      </p>

      {invites === null ? (
        <LoadError what="invites" />
      ) : invites.length === 0 ? (
        <EmptyState title="No invites yet">
          When a stylist invites you, it’ll appear here and in your email.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {invites.map(inv => {
            const name = inv.shopName?.trim() || 'A stylist'
            return (
              <li key={inv.id}>
                <section className="rounded-lg border border-hairline bg-white p-4 shadow-soft">
                  <div className="flex items-start gap-3">
                    <Avatar src={inv.shopAvatarUrl} name={name} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-warm-dark">{name}</p>
                      <p className="text-xs text-muted">
                        {new Date(inv.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                        {inv.status === 'declined' && ' · declined'}
                      </p>
                    </div>
                    {/* ⚠️ A providers.id, NOT a user id — SafetyMenu resolves
                        it to providers.user_id itself, once, which is why
                        ReportSubject is a union rather than a bare string. */}
                    <SafetyMenu subject={{ providerId: inv.providerId }} name={name} />
                  </div>

                  {/* ⚠️ HER WORDS, QUOTED, AND VISIBLY NOT OURS. The message
                      is stored on the invite rather than folded into the
                      notification body for exactly this: a stranger's
                      sentence and Cavy's sentence must not arrive looking
                      like one voice. */}
                  {inv.message && (
                    <blockquote className="mt-3 border-l-2 border-soft-pink pl-3 text-sm whitespace-pre-wrap break-words text-warm-dark">
                      {inv.message}
                    </blockquote>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/stylist/${inv.providerId}`}
                      className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark"
                    >
                      See their shop
                    </Link>
                    {/* ⚠️ NO "ACCEPT". Applying IS the acceptance, and it is
                        the flow she already knows — the button above lands on
                        the shop with Apply on it. A parallel accept would be
                        a second way to say yes and a second thing to keep in
                        step with the first (0113). */}
                    {inv.status === 'sent' && <DeclineButton inviteId={inv.id} />}
                  </div>
                </section>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
