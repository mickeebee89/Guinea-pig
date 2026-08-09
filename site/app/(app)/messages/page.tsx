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
            const inner = (
              <div className="flex items-start gap-3">
                <Avatar src={c.otherPartyPic} name={c.otherPartyName} size={44} />
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

            return (
              <li key={c.sessionId}>
                {openable ? (
                  <Link
                    href={`/messages/${c.sessionId}`}
                    className="block rounded-lg border border-hairline bg-white p-4 shadow-soft transition-colors hover:border-rose/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="rounded-lg border border-hairline bg-white/60 p-4">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
