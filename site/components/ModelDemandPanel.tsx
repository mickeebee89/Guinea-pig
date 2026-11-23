import type { ModelDemand } from '@/lib/queries/demand'

/**
 * "Is anyone actually here?" — answered with a number, for a stylist looking
 * at a dashboard that is otherwise empty.
 *
 * ⚠️ THE THREE SENTENCES THIS PANEL MUST NOT SAY, and why each is tempting:
 *
 *   "85 models are waiting for you"   They are not waiting for anybody. They
 *                                     signed up. The difference is the whole
 *                                     honesty of the panel.
 *   "4 models near you want Hair"     Nobody has expressed a preference about
 *                                     this stylist, or about anything.
 *   "You've had N applications"       Zero real applications have ever been
 *                                     made — every session row in the database
 *                                     belongs to one test account.
 *
 * What is true and worth saying: this many people have signed up looking for
 * treatments, and here is roughly where the nearest groups of them are.
 *
 * ⚠️ IT IS NOT A DIRECTORY AND CANNOT BECOME ONE. A stylist cannot contact a
 * model — there is no provider-initiated path in the product (see
 * lib/queries/demand.ts). Names and photos here would be look-only exposure.
 */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ModelDemandPanel({ demand }: { demand: ModelDemand | null }) {
  // Null is "the query failed", and the one thing this panel must never do is
  // fail into "nobody is here". No panel at all is the honest rendering.
  if (!demand) return null

  // Genuinely nobody signed up. The stylist's impression would be CORRECT, so
  // there is no false impression to correct and nothing worth a panel.
  if (demand.total === 0) return null

  // Everyone not inside a named area: too few in their own area to name, plus
  // everyone we cannot place at all.
  const unnamed = demand.total - demand.inNamedAreas
  const thinlySpread = demand.placed - demand.inNamedAreas
  const unplaced = demand.total - demand.placed

  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">
      <h2 className="font-display text-xl text-warm-dark">
        {plural(demand.total, 'model')} {demand.total === 1 ? 'has' : 'have'} signed up
      </h2>

      {/* ⚠️ "LOOKING FOR TREATMENTS", NOT "LOOKING FOR YOU". The second clause
          is doing the real work: it heads off the reading the first invites. */}
      <p className="mt-1 text-sm text-muted">
        That’s how many people have joined Cavy wanting treatments at a lower price. It’s who is
        on the platform — not a list of anyone waiting on you.
      </p>

      {demand.areas.length > 0 ? (
        <>
          <p className="mt-4 text-xs font-bold tracking-wide text-muted">
            {demand.viewerPlaced ? 'CLOSEST GROUPS TO YOU' : 'THE BIGGEST GROUPS'}
          </p>
          <ul className="mt-2 space-y-1.5">
            {demand.areas.map(a => (
              <li
                key={a.area}
                className="flex items-center justify-between gap-3 rounded-[999px] bg-input-bg px-3 py-1.5"
              >
                <span className="font-bold text-warm-dark">{a.area}</span>
                <span className="text-sm text-muted">
                  {plural(a.count, 'model')}
                  {/* Null only ever means "we cannot place the viewer", and the
                      heading above has already said so. Printing nothing here
                      beats printing a blank where a number belongs. */}
                  {a.distanceMiles != null && (
                    <> · {a.distanceMiles < 1 ? 'under a mile' : `${a.distanceMiles.toFixed(a.distanceMiles < 10 ? 1 : 0)} miles`}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        /* No bucket cleared the threshold. Say that, rather than rendering an
           empty list under a heading that promises one. */
        <p className="mt-4 text-sm text-muted">
          They’re spread too thinly to name an area yet — nowhere has three or more of them.
        </p>
      )}

      {/* ⚠️ SAY THE SUPPRESSION OUT LOUD. Three areas covering 15 of 85 looks
          identical to three areas being the whole picture, and only one of
          those is true. lib/distance.ts carries the same rule for
          `unplaceableHidden`: a list shortened in silence and a short list
          cannot be told apart by the person reading it. */}
      {unnamed > 0 && (
        <p className="mt-3 text-xs text-muted">
          Areas with fewer than three models aren’t named, so {unnamed} of them{' '}
          {unnamed === 1 ? 'isn’t' : 'aren’t'} shown above
          {thinlySpread > 0 && unplaced > 0
            ? `: ${thinlySpread} in smaller areas, and ${unplaced} who haven’t told us where they are`
            : thinlySpread > 0
              ? ' — they’re in smaller areas'
              : ' — they haven’t told us where they are'}
          .
        </p>
      )}

      {!demand.viewerPlaced && (
        <p className="mt-2 text-xs text-muted">
          We don’t know where you are, so these aren’t sorted by distance. Add your postcode in{' '}
          <span className="font-bold text-warm-dark">Settings</span> and they will be.
        </p>
      )}
    </section>
  )
}
