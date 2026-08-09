/**
 * A read-only month grid.
 *
 * Server-rendered, no client hooks — it takes a set of ISO dates to mark and
 * renders one month. Both roles use it for different things: a model sees the
 * days they have a treatment booked, a stylist sees the days they have slots
 * open with bookings marked on top.
 *
 * Deliberately not a date PICKER. Editing availability is app-only for now, and
 * a grid that looks clickable but does nothing is worse than one that clearly
 * doesn't.
 */

export interface CalendarMark {
  /** ISO yyyy-mm-dd */
  date: string
  kind: 'booked' | 'open'
  label?: string
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function MonthCalendar({
  marks, month = new Date(), caption,
}: { marks: CalendarMark[]; month?: Date; caption?: string }) {
  const year = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(year, m, 1)
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  // getDay() is Sunday-based; the UK week starts Monday.
  const leading = (first.getDay() + 6) % 7

  const byDate = new Map(marks.map(x => [x.date, x]))
  const todayIso = new Date().toISOString().slice(0, 10)

  const cells: (string | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ]

  return (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <p className="mb-3 font-bold text-warm-dark">
        {first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-1 text-xs font-bold text-muted" aria-hidden="true">{d}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`pad-${i}`} />
          const mark = byDate.get(iso)
          const day = Number(iso.slice(-2))
          const isToday = iso === todayIso
          return (
            <div
              key={iso}
              className={`aspect-square rounded-md p-1 text-sm ${
                mark?.kind === 'booked' ? 'bg-rose font-bold text-white'
                : mark?.kind === 'open' ? 'bg-soft-pink font-bold text-rose'
                : 'text-muted'
              } ${isToday && !mark ? 'ring-1 ring-rose/40' : ''}`}
              title={mark?.label}
            >
              <span className="sr-only">
                {new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                {mark ? `, ${mark.label ?? mark.kind}` : ''}
              </span>
              <span aria-hidden="true">{day}</span>
            </div>
          )
        })}
      </div>
      {caption && <p className="mt-3 text-xs text-muted">{caption}</p>}
    </div>
  )
}
