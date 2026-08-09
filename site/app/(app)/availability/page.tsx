import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { loadDay } from '@/lib/availability'
import { MonthCalendar, type CalendarMark } from '@/components/MonthCalendar'
import { EmptyState } from '@/components/ui'
import { DayEditor } from './DayEditor'

export const metadata = { title: 'Availability' }

/**
 * Stylist availability. Pick a day, edit its slots.
 *
 * The date lives in the URL rather than component state, so a day is
 * linkable, the back button works, and the server renders the right slots on
 * first paint instead of flashing an empty editor.
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date: dateParam } = await searchParams
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: prov } = await supabase
    .from('providers').select('id').eq('user_id', user.id).maybeSingle()
  const provider = prov as { id: string } | null

  if (!provider) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Availability</h1>
        <EmptyState title="This is for stylist accounts">
          Availability is where stylists offer slots for models to apply to. Your account is
          set up as a model.
        </EmptyState>
      </>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '') ? dateParam! : today
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

  const [slots, monthRes, treatRes] = await Promise.all([
    loadDay(supabase, provider.id, date),
    supabase.from('availability')
      .select('date, is_taken').eq('provider_id', provider.id)
      .gte('date', today).lte('date', in60),
    supabase.from('provider_treatments')
      .select('id, name, category').eq('provider_id', provider.id),
  ])

  const monthRows = (monthRes.data ?? []) as { date: string; is_taken: boolean | null }[]
  const marks: CalendarMark[] = [...new Set(monthRows.map(r => r.date))].map(d => ({
    date: d,
    kind: monthRows.some(r => r.date === d && r.is_taken) ? 'booked' : 'open',
    label: monthRows.some(r => r.date === d && r.is_taken) ? 'Has a booking' : 'Slots open',
  }))

  const treatments = ((treatRes.data ?? []) as { id: string; name: string | null; category: string | null }[])
    .map(t => ({ id: t.id, label: t.name ?? t.category ?? 'Treatment' }))

  // A fortnight of quick links. A full date picker is the obvious next step;
  // this covers the case that actually happens — setting up the coming days.
  const upcoming = Array.from({ length: 14 }, (_, i) =>
    new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10))

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Availability</h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <MonthCalendar marks={marks} caption="Pale pink is a day with slots. Pink means something is booked." />
          <nav aria-label="Pick a day">
            <ul className="flex flex-wrap gap-1.5">
              {upcoming.map(d => (
                <li key={d}>
                  <Link
                    href={`/availability?date=${d}`}
                    aria-current={d === date ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-[999px] px-3 text-sm font-bold ${
                      d === date ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:bg-soft-pink'
                    }`}
                  >
                    {new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <DayEditor key={date} date={date} initial={slots} treatments={treatments} />
      </div>
    </>
  )
}
