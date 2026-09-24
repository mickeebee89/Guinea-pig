import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getSessions, type SessionRow } from '@/lib/queries/sessions'
import Link from 'next/link'
import { StatusPill, EmptyState, LoadError, Avatar } from '@/components/ui'
import { SessionActions } from './SessionActions'
import { MonthCalendar, type CalendarMark } from '@/components/MonthCalendar'
import { BOOKINGS_PATH } from '@/lib/routes'

export const metadata = { title: 'Bookings' }

/**
 * Read-only bookings, both roles. Accept and decline are slice 4.
 *
 * Grouped by what the user needs to do about them rather than by status name:
 * waiting on someone, happening, already happened.
 */
/**
 * `collapsible` uses <details>, not React state — it works with no JavaScript,
 * needs no client boundary, and the browser remembers nothing to get out of
 * sync. Past bookings are the only group that grows without limit, so they are
 * the only one that starts closed.
 */
function Group({
  title, rows, collapsible = false,
}: { title: string; rows: SessionRow[]; collapsible?: boolean }) {
  if (rows.length === 0) return null

  const list = (
    <ul className="space-y-3">
        {rows.map(s => (
          <li key={s.id} className="rounded-lg border border-hairline bg-white p-4 shadow-soft">
            <div className="flex items-start gap-3">
              <Avatar src={s.otherPartyPic} name={s.otherPartyName} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {s.otherPartyId ? (
                    <Link
                      // A stylist's counterparty is a model (an auth user id);
                      // a model's is a stylist (a providers.id). Not
                      // interchangeable, which is why the kind decides.
                      href={s.otherPartyKind === 'model'
                        ? `/model/${s.otherPartyId}`
                        : `/stylist/${s.otherPartyId}`}
                      className="font-bold text-warm-dark underline decoration-hairline underline-offset-2 hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
                    >
                      {s.otherPartyName}
                    </Link>
                  ) : (
                    <span className="font-bold text-warm-dark">{s.otherPartyName}</span>
                  )}
                  <StatusPill status={s.status} />
                  <span className="text-xs text-muted">
                    {s.role === 'model' ? 'you’re the model' : 'you’re the stylist'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', {
                    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                  })}
                  {s.startTime && ` · ${s.startTime.slice(0, 5)}`}
                  {s.treatmentName && ` · ${s.treatmentName}`}
                </p>
                {/* ══ WHAT HAPPENED TO IT. Audit item 87. ══════════════════
                    Before this, a cancelled booking vanished from the list
                    entirely and the only trace was a notification — deletable
                    (0008) — so a member could be left with no record that a
                    booking had ever existed.

                    ⚠️ THE THREE CASES ARE NOT THREE WORDINGS. `cancelledBy` is
                    'platform' for a withdrawn stylist AND for a block cascade,
                    because both record `cancelled_by` as NULL deliberately. If
                    that ever became "cancelled by them", a block cascade would
                    tell one member that the other had blocked them — which is
                    the disclosure 0029:280 exists to prevent. Neutral is not
                    vagueness here; it is the requirement. */}
                {s.status === 'cancelled' && (
                  <div className="mt-2 rounded-md bg-input-bg px-3 py-2 text-sm">
                    <p className="font-bold text-warm-dark">
                      {s.cancelledBy === 'you' && 'You cancelled this booking.'}
                      {s.cancelledBy === 'them' && `${s.otherPartyName} cancelled this booking.`}
                      {/* No actor, no reason, no hint of either. The same
                          sentence whichever platform reason it was, and the
                          same sentence both parties see. */}
                      {s.cancelledBy === 'platform' && 'This booking was cancelled.'}
                    </p>
                    {s.cancellationReason && (
                      <p className="mt-1 text-warm-dark/80">
                        {/* Already sent to the other party in the cancellation
                            notice (0030), so this is not a new disclosure —
                            it is the same sentence somewhere it does not get
                            deleted. Quoted, because they are their words. */}
                        “{s.cancellationReason}”
                      </p>
                    )}
                    {s.cancelledAt && (
                      <p className="mt-1 text-xs text-muted">
                        {new Date(s.cancelledAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                )}

                {s.note && <p className="mt-2 text-sm text-warm-dark/80">{s.note}</p>}

                {/* What she attached to the application. Until 23 Sep the web
                    did not select these at all, so a stylist reading an
                    application here saw a booking with no photos while the same
                    one on the app showed them (item 96).

                    Plain <img>, not next/image: these are signed URLs from a
                    private bucket that expire, so they cannot be optimised or
                    cached by the image pipeline. */}
                {s.photoUrls.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {s.photoUrls.map((url, i) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Photo ${i + 1} from ${s.otherPartyName}’s application`}
                            className="size-20 rounded-md border border-hairline object-cover"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Accept/decline/complete are the stylist's alone — a model
                    seeing Accept on their own application would be nonsense and
                    RLS would refuse it. CANCEL is not: either party can cancel a
                    booking that has not happened, so this renders for both and
                    the component decides which controls to show. */}
                <SessionActions
                  sessionId={s.id}
                  status={s.status}
                  isPast={s.date < new Date().toISOString().slice(0, 10)}
                  role={s.role}
                  date={s.date}
                  otherName={s.otherPartyName}
                />
                {/* Both sides of a completed booking can review each other
                    (audit item 70). */}
                {s.status === 'completed' && (
                  s.reviewedByMe ? (
                    <p className="mt-2 text-xs text-muted">You’ve reviewed this booking.</p>
                  ) : (
                    <p className="mt-2">
                      <Link
                        href={`${BOOKINGS_PATH}/${s.id}/review`}
                        className="text-sm font-bold text-rose hover:underline"
                      >
                        Leave a review →
                      </Link>
                    </p>
                  )
                )}
              </div>
            </div>
          </li>
        ))}
    </ul>
  )

  if (!collapsible) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">{title}</h2>
        {list}
      </section>
    )
  }

  return (
    <details className="mb-8 group">
      <summary className="mb-3 cursor-pointer list-none text-xs font-bold uppercase tracking-widest text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          {title} ({rows.length})
        </span>
      </summary>
      {list}
    </details>
  )
}

export default async function SessionsPage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const today = new Date().toISOString().slice(0, 10)

  let rows: SessionRow[] | null = null
  try {
    rows = await getSessions(supabase, user.id)
  } catch (e) {
    console.error('[sessions] load failed', e)
  }

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Bookings</h1>

      {/* grid-cols-[minmax(0,1fr)] on phones: without it the single column is 'auto'
          and grows to its widest unbreakable content, e.g. a truncated message
          preview's FULL text, pushing the page wider than the screen (audit item 73). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,18rem)]">
        <div className="min-w-0">
          {rows === null ? (
            <LoadError what="bookings" />
          ) : rows.length === 0 ? (
            <EmptyState title="No bookings yet">
              When you apply for a session, or someone applies to you, it’ll appear here.
            </EmptyState>
          ) : (
            <>
              {/* ⚠️ NEWEST APPLICATION FIRST, NOT FURTHEST-FUTURE APPOINTMENT.
                  getSessions orders everything by `date` descending, which is
                  right for Upcoming and Past and wrong here: an application is
                  a thing that ARRIVED, and three for the same slot were being
                  shown in an order that said nothing about who asked first.
                  Mobile has always sorted this group by created_at
                  (sessions.tsx:180); the web had never selected the column. */}
              <Group
                title="Awaiting acceptance"
                rows={rows.filter(r => r.status === 'pending')
                  .slice()
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
              />
              <Group title="Upcoming" rows={rows.filter(r => r.status === 'accepted' && r.date >= today)} />
              {/* Past is by DATE, not just by status. An accepted booking whose
                  day has gone is over whether or not anyone remembered to mark
                  it complete — leaving it under Upcoming makes the list lie
                  about what is still to come. The stylist's "Mark complete"
                  button follows it down here, which is where they will be
                  looking for it. */}
              {/* ⚠️ CANCELLED GOES HERE WHATEVER ITS DATE (item 87). Decision:
                  Micky, 24 Sep. A booking cancelled for next Tuesday is not
                  upcoming — nothing is going to happen on Tuesday — so greying
                  it in the Upcoming list would keep it in a list whose whole
                  job is "what is still to come". It belongs with the things
                  that are over. */}
              <Group
                title="Past"
                collapsible
                rows={rows.filter(r =>
                  r.status === 'completed'
                  || r.status === 'cancelled'
                  || (r.status === 'accepted' && r.date < today))}
              />
            </>
          )}
        </div>

        {/* A visual read of the same list, not a second source of truth — built
            from `rows`, so it cannot drift from what is printed beside it.
            Sticky on wide screens so it stays put while the list scrolls. */}
        {rows && rows.length > 0 && (
          <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
            <MonthCalendar
              marks={rows
                .filter(r => (r.status === 'accepted' || r.status === 'pending') && r.date >= today)
                .map((r): CalendarMark => ({
                  date: r.date,
                  kind: r.status === 'accepted' ? 'booked' : 'open',
                  label: `${r.otherPartyName}${r.treatmentName ? ` · ${r.treatmentName}` : ''}`,
                }))}
              caption="Pink is confirmed. Pale pink is waiting on a reply."
            />
          </aside>
        )}
      </div>
    </>
  )
}
