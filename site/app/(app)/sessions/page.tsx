import { createSupabaseServerClient, getUser } from '@/lib/supabase-server'
import { getSessions, type SessionRow } from '@/lib/queries/sessions'
import { StatusPill, EmptyState, LoadError, Avatar } from '@/components/ui'

export const metadata = { title: 'Bookings' }

/**
 * Read-only bookings, both roles. Accept and decline are slice 4.
 *
 * Grouped by what the user needs to do about them rather than by status name:
 * waiting on someone, happening, already happened.
 */
function Group({ title, rows }: { title: string; rows: SessionRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">{title}</h2>
      <ul className="space-y-3">
        {rows.map(s => (
          <li key={s.id} className="rounded-lg border border-hairline bg-white p-4 shadow-soft">
            <div className="flex items-start gap-3">
              <Avatar src={s.otherPartyPic} name={s.otherPartyName} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-warm-dark">{s.otherPartyName}</span>
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
                {s.note && <p className="mt-2 text-sm text-warm-dark/80">{s.note}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function SessionsPage() {
  const user = await getUser()
  const supabase = await createSupabaseServerClient()

  let rows: SessionRow[] | null = null
  try {
    rows = await getSessions(supabase, user!.id)
  } catch (e) {
    console.error('[sessions] load failed', e)
  }

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Bookings</h1>

      {rows === null ? (
        <LoadError what="bookings" />
      ) : rows.length === 0 ? (
        <EmptyState title="No bookings yet">
          When you apply for a session, or someone applies to you, it’ll appear here.
        </EmptyState>
      ) : (
        <>
          <Group title="Awaiting acceptance" rows={rows.filter(r => r.status === 'pending')} />
          <Group title="Confirmed"           rows={rows.filter(r => r.status === 'accepted')} />
          <Group title="Past"                rows={rows.filter(r => r.status === 'completed')} />
        </>
      )}
    </>
  )
}
