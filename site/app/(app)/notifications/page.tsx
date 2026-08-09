import Link from 'next/link'
import { createSupabaseServerClient, getUser } from '@/lib/supabase-server'
import { getNotifications, type AppNotification } from '@/lib/queries/notifications'
import { EmptyState, LoadError } from '@/components/ui'

export const metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const user = await getUser()
  const supabase = await createSupabaseServerClient()

  let items: AppNotification[] | null = null
  try {
    items = await getNotifications(supabase, user!.id)
  } catch (e) {
    console.error('[notifications] load failed', e)
  }

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Notifications</h1>

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
                    {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
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
              <li key={n.id}>
                {n.session_id ? (
                  <Link
                    href={`/messages/${n.session_id}`}
                    className="block rounded-lg border border-hairline bg-white p-4 shadow-soft transition-colors hover:border-rose/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-lg border border-hairline bg-white p-4 shadow-soft">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
