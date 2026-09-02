import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getConversations, type ConversationSummary } from '@/lib/queries/conversations'
import { StatusPill, EmptyState, LoadError, Avatar } from '@/components/ui'

export const metadata = { title: 'Messages' }

function when(iso: string) {
  const d = new Date(iso)
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default async function MessagesPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  let convs: ConversationSummary[] | null = null
  try {
    convs = await getConversations(supabase, user.id)
  } catch (e) {
    console.error('[messages] load failed', e)
  }

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Messages</h1>

      {convs === null ? (
        <LoadError what="messages" />
      ) : convs.length === 0 ? (
        <EmptyState title="No conversations yet">
          A conversation opens once a booking is confirmed.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {convs.map(c => {
            // Only accepted and completed sessions have a readable thread —
            // the same rule the thread page enforces. Linking to a locked one
            // would land on a page with nothing on it.
            const openable = c.status === 'accepted' || c.status === 'completed'
            // The stylist's counterparty is a model (an auth user id), the
            // model's is a stylist (a providers.id). Both now have a page.
            const profileHref = c.otherPartyId
              ? (c.isModel ? `/stylist/${c.otherPartyId}` : `/model/${c.otherPartyId}`)
              : null

            const inner = (
              <div className="min-w-0 flex-1">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold text-warm-dark">{c.otherPartyName}</span>
                    {c.unreadCount > 0 && (
                      <>
                        <span
                          className="inline-flex min-w-5 items-center justify-center rounded-[999px] bg-rose px-1.5 text-xs font-bold text-white"
                          aria-hidden="true"
                        >
                          {c.unreadCount}
                        </span>
                        <span className="sr-only">{c.unreadCount} unread</span>
                      </>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-muted">{when(c.lastTime)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {c.lastContent ?? (openable ? 'No messages yet' : 'Not open yet')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusPill status={c.status} />
                    {c.treatmentName && <span className="text-xs text-muted">{c.treatmentName}</span>}
                  </div>
                </div>
              </div>
            )

            // ── WHY THE AVATAR IS A SEPARATE LINK ──────────────────────────
            // The card links to the thread and an anchor cannot contain another
            // anchor, which is why this list never linked to a profile at all
            // (commit 2e39ca1 says so in as many words). The answer is not to
            // drop the profile route — it is to stop nesting: the avatar is its
            // own link, a sibling of the card link, inside a shared flex row.
            //
            // It matters because the conversation list is where someone goes
            // when a person is bothering them, and until now the only route to
            // report or block them ran through opening the thread — i.e.
            // through the conversation they are trying to get away from.
            const row = (
              <div className="flex items-start gap-3 rounded-lg border border-hairline bg-white p-4 shadow-soft transition-colors focus-within:border-rose/40 hover:border-rose/40">
                {profileHref ? (
                  <Link
                    href={profileHref}
                    aria-label={`${c.otherPartyName}'s profile`}
                    className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                  >
                    <Avatar src={c.otherPartyPic} name={c.otherPartyName} size={44} />
                  </Link>
                ) : (
                  <Avatar src={c.otherPartyPic} name={c.otherPartyName} size={44} />
                )}
                {openable ? (
                  <Link
                    href={`/messages/${c.sessionId}`}
                    className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{inner}</div>
                )}
              </div>
            )

            return <li key={c.sessionId}>{row}</li>
          })}
        </ul>
      )}
    </>
  )
}
