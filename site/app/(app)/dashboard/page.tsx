import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import {
  getDashboardUser, getModelDashboard, getProviderDashboard,
  type BookingCard,
} from '@/lib/queries/dashboard'
import { getConversations } from '@/lib/queries/conversations'
import { getNotifications } from '@/lib/queries/notifications'
import { MonthCalendar, type CalendarMark } from '@/components/MonthCalendar'
import { Avatar, StatusPill, LoadError } from '@/components/ui'

export const metadata = { title: 'Dashboard' }

/* ── shared pieces ─────────────────────────────────────────────────────── */

function Panel({
  title, href, linkLabel, empty, isEmpty = false, children,
}: {
  title: string; href?: string; linkLabel?: string
  empty?: string
  /** Passed explicitly, never inferred from children: a panel that also renders
   *  an "in the app" note always HAS children, so inferring would silently
   *  suppress the empty message — the one thing these panels exist to say. */
  isEmpty?: boolean
  children?: React.ReactNode
})  {
  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg text-warm-dark">{title}</h2>
        {href && (
          <Link href={href} className="text-sm font-bold text-rose hover:underline">
            {linkLabel ?? 'See all'}
          </Link>
        )}
      </div>
      {/* Empty states say WHY they're empty, in terms of what hasn't happened
          yet — not "no data". A new account is mostly empty by definition and
          that shouldn't read as broken. */}
      {isEmpty ? <p className="text-sm text-muted">{empty}</p> : children}
    </section>
  )
}

function BookingRow({ b }: { b: BookingCard }) {
  const inner = (
    <>
      <Avatar src={b.otherPic} name={b.otherName} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-warm-dark">{b.otherName}</p>
        <p className="text-xs text-muted">
          {new Date(b.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          {b.startTime && ` · ${b.startTime.slice(0, 5)}`}
          {b.treatment && ` · ${b.treatment}`}
        </p>
      </div>
      <StatusPill status={b.status} />
    </>
  )
  return (
    <li>
      {b.providerId ? (
        <Link href={`/stylist/${b.providerId}`} className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-input-bg">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3 p-2">{inner}</div>
      )}
    </li>
  )
}

/** Something the app can do and web can't yet. Says so once, plainly. */
function InApp({ what }: { what: string }) {
  return (
    <p className="mt-3 rounded-md bg-input-bg px-3 py-2 text-xs text-muted">
      {what} is in the Cavy app for now — it’s coming to the web soon.
    </p>
  )
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default async function DashboardPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  let me, convs, notes
  try {
    ;[me, convs, notes] = await Promise.all([
      getDashboardUser(supabase, user.id),
      getConversations(supabase, user.id).catch(() => []),
      getNotifications(supabase, user.id).catch(() => []),
    ])
  } catch (e) {
    console.error('[dashboard] load failed', e)
    return <LoadError what="dashboard" />
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const unread = convs.reduce((n, c) => n + c.unreadCount, 0)
  const recentNotes = notes.slice(0, 4)

  const isProvider = me.role === 'provider'
  const data = isProvider
    ? await getProviderDashboard(supabase, user.id)
    : await getModelDashboard(supabase, user.id)

  const activity = (
    <div className="space-y-6">
      <Panel
        title="Messages" href="/messages" isEmpty={convs.length === 0}
        empty="No conversations yet. One opens when a booking is confirmed."
      >
        {convs.length > 0 && (
          <ul className="space-y-1">
            {convs.slice(0, 4).map(c => (
              <li key={c.sessionId}>
                <Link href={`/messages/${c.sessionId}`} className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-input-bg">
                  <Avatar src={c.otherPartyPic} name={c.otherPartyName} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-warm-dark">{c.otherPartyName}</p>
                    <p className="truncate text-xs text-muted">{c.lastContent ?? 'No messages yet'}</p>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="rounded-[999px] bg-rose px-2 text-xs font-bold text-white">{c.unreadCount}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {unread > 0 && <p className="mt-2 text-xs font-bold text-rose">{unread} unread</p>}
      </Panel>

      <Panel
        title="Notifications" href="/notifications" isEmpty={recentNotes.length === 0}
        empty="Nothing yet. Updates about your bookings show up here."
      >
        {recentNotes.length > 0 && (
          <ul className="space-y-2">
            {recentNotes.map(n => (
              <li key={n.id} className="flex items-start gap-2">
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[999px] bg-rose" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-warm-dark">{n.title}</p>
                  <p className="text-xs text-muted">
                    {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Avatar src={me.avatarUrl} name={me.firstName ?? 'You'} size={48} />
        <div>
          <h1 className="font-display text-2xl text-warm-dark">
            {greeting}{me.firstName ? `, ${me.firstName}` : ''}
          </h1>
          <p className="text-sm text-muted">
            {isProvider ? 'Stylist account' : 'Model account'}
            {me.isVerified && ' · Verified'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {data.kind === 'model' ? (
            <>
              <Panel
                title="Upcoming treatments" href="/sessions" isEmpty={data.upcoming.length === 0}
                empty="Nothing booked in yet. Once a stylist accepts an application it’ll appear here."
              >
                {data.upcoming.length > 0 && <ul>{data.upcoming.map(b => <BookingRow key={b.id} b={b} />)}</ul>}
              </Panel>

              <Panel
                title="Your month" isEmpty={data.upcoming.length === 0}
                empty="No treatments booked, so there’s nothing on the calendar yet."
              >
                {data.upcoming.length > 0 && (
                  <MonthCalendar
                    marks={data.upcoming.map((b): CalendarMark => ({
                      date: b.date, kind: 'booked', label: `${b.otherName}${b.treatment ? ` · ${b.treatment}` : ''}`,
                    }))}
                    caption="Days you have a treatment booked."
                  />
                )}
              </Panel>

              <Panel
                title="Waiting on a reply" isEmpty={data.pending.length === 0}
                empty="You haven’t applied for any sessions yet."
              >
                {data.pending.length > 0 && <ul>{data.pending.map(b => <BookingRow key={b.id} b={b} />)}</ul>}
                <InApp what="Applying for a session" />
              </Panel>

              <Panel
                title="Updates from your stylists" isEmpty={data.updates.length === 0}
                empty="No updates. Stylists you’ve booked with can post a short update, and it shows here while it’s live."
              >
                {data.updates.length > 0 && (
                  <ul className="space-y-2">
                    {data.updates.map(u => (
                      <li key={u.providerId}>
                        <Link href={`/stylist/${u.providerId}`} className="flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-input-bg">
                          <Avatar src={u.picUrl} name={u.name} size={36} />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-warm-dark">{u.name}</p>
                            <p className="text-sm text-muted">{u.text}</p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel
                title="Leave a review" isEmpty={data.awaitingReview.length === 0}
                empty="No treatments to review yet."
              >
                {data.awaitingReview.length > 0 && (
                  <>
                    <ul>{data.awaitingReview.map(b => <BookingRow key={b.id} b={b} />)}</ul>
                    <InApp what="Leaving a review" />
                  </>
                )}
              </Panel>

              <Panel
                title="Favourites" isEmpty={data.favourites.length === 0}
                empty="No favourites yet. Save a stylist and they’ll be here."
              >
                {data.favourites.length > 0 && (
                  <ul className="flex flex-wrap gap-3">
                    {data.favourites.map(f => (
                      <li key={f.providerId}>
                        <Link href={`/stylist/${f.providerId}`} className="flex items-center gap-2 rounded-[999px] bg-input-bg px-3 py-1.5 text-sm font-bold text-warm-dark hover:bg-soft-pink">
                          <Avatar src={f.picUrl} name={f.name} size={24} />
                          {f.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          ) : (
            <>
              <Panel
                title="Applications" href="/sessions" isEmpty={data.applications.length === 0}
                empty="No one has applied to you yet."
              >
                {data.applications.length > 0 && (
                  <>
                    <ul>{data.applications.map(b => <BookingRow key={b.id} b={b} />)}</ul>
                    <p className="mt-3">
                      <Link href="/sessions" className="text-sm font-bold text-rose hover:underline">
                        Accept or decline on the bookings page →
                      </Link>
                    </p>
                  </>
                )}
              </Panel>

              <Panel
                title="Upcoming bookings" href="/sessions" isEmpty={data.upcoming.length === 0}
                empty="Nothing booked in yet."
              >
                {data.upcoming.length > 0 && <ul>{data.upcoming.map(b => <BookingRow key={b.id} b={b} />)}</ul>}
              </Panel>

              <Panel
                title="Your availability" isEmpty={data.openDates.length === 0 && data.upcoming.length === 0}
                empty="No open slots in the next 30 days."
              >
                {(data.openDates.length > 0 || data.upcoming.length > 0) && (
                  <MonthCalendar
                    marks={[
                      ...data.openDates.map((d): CalendarMark => ({ date: d, kind: 'open', label: 'Slots open' })),
                      ...data.upcoming.map((b): CalendarMark => ({ date: b.date, kind: 'booked', label: `Booked · ${b.otherName}` })),
                    ]}
                    caption="Pink is a booking. Pale pink is a day with slots open."
                  />
                )}
                <p className="mt-3">
                  <Link href="/availability" className="text-sm font-bold text-rose hover:underline">
                    Edit your availability →
                  </Link>
                </p>
              </Panel>

              <Panel title="Your shop" empty="">
                <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">Status</dt>
                    <dd className="font-bold text-warm-dark">{data.isPublished ? 'Published' : 'Not published'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Rating</dt>
                    <dd className="font-bold text-warm-dark">
                      {data.reviewCount > 0 && data.rating != null ? data.rating.toFixed(1) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Reviews</dt>
                    <dd className="font-bold text-warm-dark">{data.reviewCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Portfolio</dt>
                    <dd className="font-bold text-warm-dark">{data.portfolioCount}</dd>
                  </div>
                </dl>
                {data.isFoundingProvider && (
                  <p className="mt-3 inline-flex rounded-[999px] bg-soft-pink px-3 py-1 text-xs font-bold text-rose">
                    Founding Provider
                  </p>
                )}
                {data.providerId && (
                  <p className="mt-3">
                    <Link href={`/stylist/${data.providerId}`} className="text-sm font-bold text-rose hover:underline">
                      View your public profile →
                    </Link>
                  </p>
                )}
                <InApp what="Editing your shop, treatments and portfolio" />
              </Panel>
            </>
          )}
        </div>

        {activity}
      </div>
    </>
  )
}
