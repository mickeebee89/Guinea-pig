import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getNotifications, type AppNotification } from '@/lib/queries/notifications'
import { EmptyState, LoadError } from '@/components/ui'
import { MarkAllReadButton } from './MarkAllReadButton'
import { MarkOneReadButton } from './MarkOneReadButton'

export const metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  let items: AppNotification[] | null = null
  try {
    items = await getNotifications(supabase, user.id)
  } catch (e) {
    console.error('[notifications] load failed', e)
  }

  return (
    <>
      {/* The bell in the nav shows a dot while anything here is unread, and
          this is the only thing that clears it. Without it the dot would be
          permanent — markAllNotificationsRead had been exported and called from
          nowhere since the page was written. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl text-warm-dark">Notifications</h1>
        <MarkAllReadButton unread={(items ?? []).filter(n => !n.read_at).length} />
      </div>

      {items === null ? (
        <LoadError what="notifications" />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing yet">
          Updates about your bookings and messages will show up here.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map(n => {
            const body = (
              <>
                <div className="flex items-start gap-2">
                  {!n.read_at && (
                    <>
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[999px] bg-rose" aria-hidden="true" />
                      <span className="sr-only">Unread. </span>
                    </>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${n.read_at ? 'font-bold text-warm-dark/70' : 'font-bold text-warm-dark'}`}>
                      {n.title}
                    </p>
                    {/* whitespace-pre-line, because the bodies are written with
                        blank lines between paragraphs and HTML collapses them.
                        Without it the cancellation and revocation messages —
                        four paragraphs each — render as one run-on block. The
                        text was not truncated here; it was unreadable for a
                        different reason, which is why both clients needed
                        checking rather than just the one that reported it. */}
                    {n.body && (
                      <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.body}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">
                      {new Date(n.created_at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </>
            )
            return (
              <li
                key={n.id}
                className="overflow-hidden rounded-lg border border-hairline bg-white shadow-soft"
              >
                {n.session_id ? (
                  <Link
                    href={`/messages/${n.session_id}`}
                    className="block p-4 transition-colors hover:bg-input-bg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-rose"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="p-4">{body}</div>
                )}

                {/* The read control is a sibling of the link, not inside it: an
                    anchor cannot contain a button, and a button inside one
                    steals the click. It is on every row rather than only the
                    linked ones \u2014 a notification with nowhere to go (a warning,
                    a verification result, a rejected update) is exactly the
                    kind you want to be able to clear. */}
                {!n.read_at && (
                  <div className="border-t border-hairline px-4">
                    <MarkOneReadButton id={n.id} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
