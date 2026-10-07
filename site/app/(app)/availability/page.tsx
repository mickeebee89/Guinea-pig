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
  /* This is an async Server Component, not a render body. It runs once per
     request and never re-renders, so there is no unstable result for the rule
     to protect against — it cannot currently tell the two apart. */
  // eslint-disable-next-line react-hooks/purity
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)

  const [slots, monthRes, treatRes] = await Promise.all([
    loadDay(supabase, provider.id, date),
    supabase.from('availability')
      // active_treatments so the page can say which slots will never be
      // offered. Item 196 part 3.
      .select('date, is_taken, active_treatments').eq('provider_id', provider.id)
      .gte('date', today).lte('date', in60),
    supabase.from('provider_treatments')
      .select('id, name, category').eq('provider_id', provider.id),
  ])

  const monthRows = (monthRes.data ?? []) as {
    date: string; is_taken: boolean | null; active_treatments: string[] | null
  }[]

  /**
   * ⚠⚠ SLOTS THAT WILL NEVER BE OFFERED, AND WHY SHE IS TOLD HERE. Item 196.
   *
   * Part 1 made the model-facing loader skip a slot with no treatment — its
   * three columns are time, treatment and price, and a row with one blank is
   * the dead end a model used to meet at the wizard's treatment step.
   *
   * **That silence is item 183's shape**: she sees a diary she believes is live.
   * So the page she CREATED the slot on is where it has to say otherwise.
   *
   * ⚠️ THE LINE BELOW IS A POINTER, NOT A SECOND SURFACE. The editor says it
   * per slot, and that is authoritative. This exists only because the editor
   * shows ONE DAY, and she would never navigate to a day she has no reason to
   * suspect. Same page, same query, one sentence, linking to the first one.
   */
  const unoffered = monthRows.filter(r => (r.active_treatments?.length ?? 0) === 0)
  const unofferedDates = [...new Set(unoffered.map(r => r.date))].sort()
  const marks: CalendarMark[] = [...new Set(monthRows.map(r => r.date))].map(d => ({
    date: d,
    kind: monthRows.some(r => r.date === d && r.is_taken) ? 'booked' : 'open',
    label: monthRows.some(r => r.date === d && r.is_taken) ? 'Has a booking' : 'Slots open',
  }))

  const treatments = ((treatRes.data ?? []) as { id: string; name: string | null; category: string | null }[])
    .map(t => ({ id: t.id, label: t.name ?? t.category ?? 'Treatment' }))

  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Availability</h1>

      {unoffered.length > 0 && (
        <div className="mb-6 rounded-md bg-input-bg px-4 py-3">
          <p className="text-sm text-warm-dark">
            <span className="font-bold">
              {unoffered.length === 1
                ? 'One of your slots isn’t being offered to models.'
                : `${unoffered.length} of your slots aren’t being offered to models.`}
            </span>{' '}
            {unoffered.length === 1 ? 'It has' : 'They have'} no treatment selected, so there’s
            nothing for a model to book.
          </p>
          {/* The first one, by date. Deliberately not a list: the editor is
              where it gets fixed, and a list here would be a second place to
              read the same thing from. */}
          {unofferedDates[0] !== date && (
            <a
              href={`/availability?date=${unofferedDates[0]}`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-rose hover:underline"
            >
              Fix {new Date(`${unofferedDates[0]}T00:00:00`).toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })} →
            </a>
          )}
        </div>
      )}

      {/* grid-cols-[minmax(0,1fr)] on phones: without it the single column is 'auto'
          and grows to its widest unbreakable content, e.g. a truncated message
          preview's FULL text, pushing the page wider than the screen (audit item 73). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <MonthCalendar
            marks={marks}
            hrefFor={d => `/availability?date=${d}`}
            selected={date}
            minDate={today}
            caption="Click a day to edit it. Pale pink has slots; pink means something is booked."
          />
        </div>

        <DayEditor key={date} date={date} initial={slots} treatments={treatments} />
      </div>
    </>
  )
}
