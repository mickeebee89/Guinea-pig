import type { ModelDemand } from '@/lib/queries/demand'
import { postcodeAreaName } from '@/lib/postcodeAreas'

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
 * ⚠️ IT IS NOT A DIRECTORY AND SHOULD NOT BECOME ONE. Counts answer "is
 * anyone here?"; names and photos are more exposure than that question needs.
 *
 * ⚠⚠ THIS SAID "a stylist cannot contact a model — there is no
 * provider-initiated path in the product", AND THAT WAS FALSE: invites have
 * been live since 20 June 2026. Corrected 23 Nov 2026; the full retraction is
 * in migration 0113's header, which names 0112 as where it started.
 *
 * ── ⚠️ THE ORDER OF THIS CARD IS LOAD-BEARING. CHANGED 23 Nov 2026. ────────
 * It used to lead with "85 models have signed up" and then say, four lines
 * later, that 70 of them were not shown. That is a headline retracted by its
 * own small print: the biggest number on the card was the one the card went on
 * to undercut, and the reader is left trusting neither.
 *
 * So the lead is now the NAMED AREAS — the smaller, local, fully-supported
 * claim — and the suppression sentence qualifies that instead. The total sits
 * underneath as context, where it is additive rather than contradicted:
 * named + thinly-spread + unplaced add up to it on screen, in that order.
 *
 * ⚠️ DO NOT PROMOTE THE TOTAL BACK TO THE HEADING. It is the most impressive
 * number here and the least useful one to a stylist in Sheffield, which is
 * exactly the combination that makes a card feel like marketing.
 */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ModelDemandPanel({ demand }: { demand: ModelDemand | null }) {
  // Null is "the query failed", and the one thing this panel must never do is
  // fail into "nobody is here". No panel at all is the honest rendering.
  if (!demand) return null

  // Genuinely nobody signed up. The stylist's impression would be CORRECT, so
  // there is no false impression to correct and nothing worth a panel.
  if (demand.total === 0) return null

  // Everyone not inside a named area, split by WHY they are not in one. The
  // two reasons are different facts and the card states them separately:
  // "we know where she is and her area is too small" is not the same as
  // "we do not know where she is".
  const thinlySpread = demand.placed - demand.inNamedAreas
  const unplaced = demand.total - demand.placed
  const hasAreas = demand.areas.length > 0

  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">
      {hasAreas ? (
        <>
          {/* ⚠️ THE HEADING COUNTS THE NAMED AREAS, NOT THE PLATFORM. Every
              number in it is one the list below it accounts for in full, so
              there is nothing here for the small print to take back. */}
          <h2 className="font-display text-xl text-warm-dark">
            {plural(demand.inNamedAreas, 'model')} in{' '}
            {plural(demand.areas.length, 'area')}
            {demand.viewerPlaced ? ' near you' : ''}
          </h2>

          <ul className="mt-3 space-y-1.5">
            {demand.areas.map(a => (
              <li
                key={a.area}
                className="flex items-center justify-between gap-3 rounded-[999px] bg-input-bg px-3 py-1.5"
              >
                {/* ⚠️ THE NAME IS RENDERED, THE CODE IS THE KEY. "SE" above a
                    distance reads as a typo; "South East London" reads as a
                    place. postcodeAreaName falls back to the code rather than
                    guessing, so an area Royal Mail adds tomorrow degrades to
                    slightly cryptic instead of confidently wrong. */}
                <span className="min-w-0 font-bold text-warm-dark">{postcodeAreaName(a.area)}</span>
                {/* ⚠️ nowrap ON THE COUNT, wrap ON THE NAME. At 375px "South
                    East London" and "7 models · 4.2 miles" do not both fit, and
                    with neither pinned the browser broke the DISTANCE — "4.2"
                    on one line and "miles" on the next, which reads as two
                    numbers. A place name wrapping is ordinary; a measurement
                    split in half is not. */}
                <span className="shrink-0 whitespace-nowrap text-sm text-muted">
                  {plural(a.count, 'model')}
                  {/* Null only ever means "we cannot place the viewer", and the
                      note at the foot of the card says so. Printing nothing
                      here beats printing a blank where a number belongs. */}
                  {a.distanceMiles != null && (
                    <> · {a.distanceMiles < 1 ? 'under a mile' : `${a.distanceMiles.toFixed(a.distanceMiles < 10 ? 1 : 0)} miles`}</>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* ⚠️ SAY THE SUPPRESSION OUT LOUD. Three areas covering 15 of 85
              looks identical to three areas being the whole picture, and only
              one of those is true. lib/distance.ts carries the same rule for
              `unplaceableHidden`: a list shortened in silence and a short list
              cannot be told apart by the person reading it.

              It sits directly under the list it qualifies, and its numbers are
              the remainder of the list's own claim — not of the total. */}
          {(thinlySpread > 0 || unplaced > 0) && (
            <p className="mt-3 text-xs text-muted">
              {'Areas with fewer than three models aren’t named'}
              {thinlySpread > 0 && `, so ${plural(thinlySpread, 'model')} in smaller areas ${thinlySpread === 1 ? 'isn’t' : 'aren’t'} shown`}
              {thinlySpread > 0 && unplaced > 0 && ', and '}
              {thinlySpread === 0 && unplaced > 0 && '. '}
              {unplaced > 0 && `${plural(unplaced, 'model')} ${unplaced === 1 ? 'hasn’t' : 'haven’t'} told us where they are`}
              {'.'}
            </p>
          )}
        </>
      ) : (
        /* No bucket cleared the threshold, so there is no local claim to lead
           with and the total is all there is. The suppression sentence still
           has to explain the absence of a list, or the card looks broken
           rather than honest. */
        <>
          <h2 className="font-display text-xl text-warm-dark">
            {plural(demand.total, 'model')} {demand.total === 1 ? 'has' : 'have'} signed up
          </h2>
          <p className="mt-2 text-sm text-muted">
            They’re spread too thinly to name an area yet — nowhere has three or more of them.
          </p>
        </>
      )}

      {/* ⚠️ "LOOKING FOR TREATMENTS", NOT "LOOKING FOR YOU". The second clause
          is doing the real work: it heads off the reading the first invites.

          Context, not headline — see the order note at the top of this file.
          It is suppressed in the no-areas branch above, where the total is
          already the heading and would otherwise be stated twice. */}
      {hasAreas && (
        <p className="mt-4 border-t border-hairline pt-3 text-sm text-muted">
          <span className="font-bold text-warm-dark">
            {plural(demand.total, 'model')} {demand.total === 1 ? 'has' : 'have'} signed up
          </span>{' '}
          to Cavy in all, wanting treatments at a lower price. It’s who is on the platform — not a
          list of anyone waiting on you.
        </p>
      )}

      {!demand.viewerPlaced && (
        <p className="mt-2 text-xs text-muted">
          We don’t know where you are, so these aren’t sorted by distance — the biggest areas are
          first. Add your postcode in{' '}
          <span className="font-bold text-warm-dark">Settings</span> and they will be.
        </p>
      )}
    </section>
  )
}
