'use client'

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { isTestAccount, TEST_ACCOUNT_IDS } from '@/lib/testAccounts'
import { UK_PATH, VIEW_BOX, project } from '@/lib/ukOutline'

/**
 * Where the members are.
 *
 * ── ⚠️ WHAT THIS PAGE READS, AND WHAT IT DELIBERATELY DOES NOT ────────────
 * Eight columns, named one by one rather than `select('*')`, and the list is
 * the privacy decision rather than a tidiness one: no email, no postcode, no
 * date of birth, no subscription state. A map is a screenshot waiting to
 * happen — it is the one screen in this console whose whole content fits in
 * one image — and everything omitted here is a column away on the Users page
 * for anyone who actually needs it.
 *
 * `latitude`/`longitude` are the postcode's centroid from the ONS lookup
 * (0099), never an address. They are already rounded to a postcode unit, which
 * covers about fifteen houses.
 */
interface Row {
  id: string
  first_name: string | null
  last_initial: string | null
  role: string
  latitude: number | null
  longitude: number | null
  /** Local authority. Present on every plottable row — measured, 25 of 25. */
  admin_district: string | null
  /** Built-up area. ONS holds none for many postcodes, so it falls through. */
  bua: string | null
}

/**
 * ── ⚠️ TWO COLOURS, AND `both` IS A STYLIST ───────────────────────────────
 * The roles are model, provider and both. Having a shop is the stronger
 * signal — it is the side of the marketplace that is scarce — so `both` is
 * drawn pink and the legend says so. The hover still reports the real role,
 * because the dot's colour is a simplification and the tooltip should not
 * repeat it back as if it were the record.
 *
 * Rose #DB4B86 is the brand's, straight from the palette. The yellow is
 * Tailwind's `yellow-500`, which is the ramp the console already uses for the
 * Founding-provider badge — so it is the yellow that is already in this app
 * rather than a new one. `yellow-400` was tried first and is too pale to see
 * on a light map.
 */
const STYLIST = '#DB4B86'
const MODEL = '#EAB308'
/** A pin holding both kinds of member. Neither colour would be true. */
/**
 * ⚠️ THERE IS NO THIRD COLOUR ANY MORE. `MIXED` was the fill for a numbered
 * pin holding both kinds of member, and nothing holds more than one member
 * since 6 Nov 2026. A mark is one person, so it is that person's colour, and a
 * mark whose colour is a compromise cannot occur.
 */

const isStylist = (role: string) => role === 'provider' || role === 'both'
const roleWord = (role: string) =>
  role === 'provider' ? 'Stylist' : role === 'both' ? 'Model and stylist' : 'Model'

/** Built-up area, else the local authority, else nothing claimed. */
const townOf = (r: Row) => r.bua?.trim() || r.admin_district?.trim() || 'town unknown'

const nameOf = (r: Row) =>
  `${r.first_name ?? 'Someone'}${r.last_initial ? ` ${r.last_initial}.` : ''}`

/**
 * ── ⚠️⚠️ ONE DOT, ONE PERSON. NOTHING IS MERGED AND NOTHING IS COUNTED ──
 * The map renders 379 px wide for 598 units of viewBox, so one unit is 0.63 px
 * and a `DOT_R` of 3 is a dot under 4 px across.
 *
 * MEASURED, NOT ESTIMATED. Rendered from this exact path, these exact
 * constants and the real plotted coordinates, at 70vh in a 1000 px-tall
 * window, then magnified with nearest-neighbour so the pixels the eye actually
 * receives could be looked at rather than imagined.
 *
 * ── ⚠️⚠️ WHAT WAS HERE BEFORE, AND WHY IT WENT. 6 Nov 2026. ─────────
 * Dots within `2 × DOT_R` of each other were merged into one larger pin
 * carrying a COUNT, on the principle that three people at one postcode must
 * not look like one before anybody hovers. The merge distance was derived
 * rather than tuned — two circles of radius r overlap when their centres are
 * closer than 2r, so merging at exactly 2r merged exactly the dots that could
 * not have been told apart anyway. That derivation was the best thing about
 * the design and it is the reason this note is long: it was right, and it
 * still did not work.
 *
 * ⚠️ IT DID NOT WORK BECAUSE THE PIN RADIUS WAS NOT DERIVED FROM ANYTHING.
 * `GROUP_R` was a fixed 9 while the merge distance moved with `DOT_R`, so
 * shrinking the dot pulled the merge distance below the pin radius and the
 * pins began overlapping EACH OTHER. Rendered and looked at in inner London:
 * two badges legible, one cut in half behind its neighbour, two more almost
 * entirely hidden. A count that cannot be read is worse than no count, because
 * it still occupies the space where the people were.
 *
 * ⚠️ AND THE COUNT WAS ALWAYS A SECOND CLAIM ON TOP OF THE DATA. A badge of
 * five said "five members under one mark at this scale" — a rendering fact
 * dressed as a geographic one, which had to be disclaimed in this comment
 * every time it was described. A plain dot per member makes no claim that
 * needs disclaiming: the mark is where somebody is, and a pile looks like a
 * pile because it is one.
 *
 * ⚠️ SO THE PILE IN LONDON IS STILL A PILE. This is not a fix for density and
 * must not be read as one — it removes a broken answer rather than supplying a
 * working one. What the reader gets instead is the panel beside the map, which
 * counts the overlap honestly, and the hover, which names everyone under the
 * cursor. The real fix is a zoom or a separate London view, and neither exists.
 *
 * ⚠️ NOTHING IS MOVED, STILL. Jitter was refused when the badges were built
 * and is refused again: nudging a dot off its postcode to stop it touching its
 * neighbour makes the map say something false about where somebody lives, and
 * there is no way to tell a jittered dot from a real one. An unreadable pile
 * is honest. A readable lie is not.
 */
const DOT_R = 3

/**
 * Centre-to-centre distance at which two dots touch — the same 2r fact the
 * merge used, kept because it is still true and still derived. It no longer
 * merges anything: it decides only who the hover reports as being UNDER the
 * dot you are pointing at, so that a buried member is reachable rather than
 * silently absent. Drawing does not consult it.
 */
const TOUCH = DOT_R * 2

/**
 * One member, one mark. `members` is that member FIRST, then anyone whose dot
 * overlaps theirs — the hover list, not a group. Nothing in the drawing reads
 * past `members[0]`.
 */
interface Pin {
  key: string
  x: number
  y: number
  members: Row[]
  colour: string
}

export default function MapPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  /** Off by default, exactly as on Users and Activity. */
  const [showTest, setShowTest] = useState(false)
  const [hover, setHover] = useState<Pin | null>(null)

  const { loading } = useLoader('map', async stale => {
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_initial, role, latitude, longitude, admin_district, bua')
    if (stale()) return
    if (error) {
      // ⚠️ AN EMPTY MAP AND A FAILED READ LOOK IDENTICAL, so the page must say
      // which it is. A map of Britain with no dots is a perfectly plausible
      // picture of a product with no members.
      setProblem(`Could not read the members: ${error.message}`)
      setRows([])
      return
    }
    setProblem(null)
    setRows((data ?? []) as unknown as Row[])
  })

  const view = useMemo(() => {
    const visible = showTest ? rows : rows.filter(r => !isTestAccount(r.id))
    const plot = (r: Row) => r.latitude !== null && r.longitude !== null

    const plotted = visible.filter(plot)
    const unplotted = visible.filter(r => !plot(r))
    const hiddenTests = showTest ? [] : rows.filter(r => isTestAccount(r.id))

    /**
     * ⚠️ SORTED FIRST, SO THE RESULT IS THE SAME EVERY LOAD. PostgREST makes
     * no promise about row order without an ORDER BY, and the draw order
     * decides which of two touching dots is on top. North to south, then west
     * to east.
     */
    const ordered = [...plotted].sort(
      (a, b) => b.latitude! - a.latitude! || a.longitude! - b.longitude!,
    )

    /**
     * ⚠️ EVERY MEMBER GETS A MARK, AT THEIR OWN COORDINATE. No merging, no
     * anchoring one mark to one member and hiding the rest behind it, no
     * centroid — a centroid would have put the London mark in the Thames.
     * Where dots overlap they overlap, and `members[1..]` carries whoever is
     * underneath so the hover can name them.
     */
    const pins: Pin[] = ordered.map(r => {
      const [x, y] = project(r.latitude!, r.longitude!)
      return {
        key: r.id, x, y, members: [r],
        colour: isStylist(r.role) ? STYLIST : MODEL,
      }
    })

    // Who is underneath whom. O(n²) over a few dozen dots, which is nothing,
    // and it reads the same both ways so no member is unreachable.
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        if (Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y) <= TOUCH) {
          pins[i].members.push(pins[j].members[0])
          pins[j].members.push(pins[i].members[0])
        }
      }
    }

    /**
     * ⚠️ STYLISTS DRAW LAST, SO THEY DRAW ON TOP. Pink is the scarce half of
     * the marketplace and the reason anyone opens this page; yellow is the
     * plentiful half. When two dots overlap, the one worth seeing should be
     * the one you can see. This replaces "single dots first, so a count badge
     * is never buried" — there are no badges to bury now.
     */
    pins.sort((a, b) => Number(isStylist(a.members[0].role)) - Number(isStylist(b.members[0].role)))

    const stylistCount = plotted.filter(r => isStylist(r.role)).length

    return {
      pins,
      plotted,
      stylistCount,
      modelCount: plotted.length - stylistCount,
      unplottedStylists: unplotted.filter(r => isStylist(r.role)).length,
      unplottedModels: unplotted.filter(r => !isStylist(r.role)).length,
      unplotted: unplotted.length,
      hiddenTestsPlotted: hiddenTests.filter(plot).length,
      hiddenTests: hiddenTests.length,
      /**
       * ⚠️ MEMBERS WHOSE DOT TOUCHES ANOTHER — not groups, because there are
       * no groups. This is the honest size of the problem the badges used to
       * paper over, and the panel says it in words because the map no longer
       * can.
       */
      overlapping: pins.filter(p => p.members.length > 1).length,
    }
  }, [rows, showTest])

  const card = 'bg-white rounded-xl border border-black/5 shadow-sm'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Map</h1>
        <p className="mt-1 text-sm text-[#3D2E2E]/60">
          One dot per member, placed from the centroid of their postcode. Drawn from a
          stored outline — this page makes no request to anyone but our own database.
        </p>
      </div>

      {problem && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{problem}</p>
      )}

      {/* ──────────────────────────────────────────────────────────────────
          ⚠️⚠️ THE MEMBERS WHO ARE NOT ON THE MAP GO ABOVE THE MAP.

          Twenty-seven of the fifty-two real members have no postcode, so the
          picture below is slightly under half of them. A map is uniquely good
          at reading as "this is everyone" — it has edges, and everything
          inside the edges looks complete — and the only reliable fix is to
          say the number before the picture is seen rather than in a footnote
          under it.

          It is a full-width panel rather than a tile for the same reason.
          ────────────────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="rounded-xl border border-[#C23A71]/30 bg-[#FFF0F6] px-4 py-3">
          <p className="text-sm text-[#3D2E2E]">
            <strong className="font-semibold">
              {view.unplotted} member{view.unplotted === 1 ? '' : 's'}{' '}
              {view.unplotted === 1 ? 'has' : 'have'} no postcode and {view.unplotted === 1 ? 'is' : 'are'} not shown
            </strong>
            {' — '}
            {view.unplottedModels} model{view.unplottedModels === 1 ? '' : 's'}
            {' and '}
            {view.unplottedStylists} stylist{view.unplottedStylists === 1 ? '' : 's'}.
            {' '}The map shows {view.plotted.length} of {view.plotted.length + view.unplotted}.
          </p>
          <p className="mt-1 text-xs text-[#3D2E2E]/60">
            A postcode has been required at signup since 26 Oct 2026, so this number should
            only fall. Everyone in it joined before that and has not set one in Settings.
          </p>
        </div>
      )}

      {/* Both figures, never a filtered number alone — the same contract as the
          dashboard tiles and the Users page, which hide the same seven. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-[#3D2E2E]/70">
          <strong className="font-semibold text-[#3D2E2E]">{view.plotted.length}</strong>
          {' '}dot{view.plotted.length === 1 ? '' : 's'}
          {!showTest && view.hiddenTests > 0 && (
            <span className="text-[#3D2E2E]/50">
              {' '}· {view.hiddenTestsPlotted} test account
              {view.hiddenTestsPlotted === 1 ? '' : 's'} hidden from the map,
              {' '}{view.hiddenTests} of {Object.keys(TEST_ACCOUNT_IDS).length} in all
            </span>
          )}
        </span>
        <label className="flex items-center gap-2 text-[#3D2E2E]/70">
          <input type="checkbox" checked={showTest}
            onChange={e => setShowTest(e.target.checked)} />
          Show test accounts
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className={`${card} p-4`}>
          {loading ? (
            <div className="py-20 text-center text-sm text-[#3D2E2E]/40">Loading…</div>
          ) : (
            <svg
              viewBox={VIEW_BOX}
              preserveAspectRatio="xMidYMid meet"
              className="mx-auto block h-[70vh] w-full"
              role="img"
              aria-label={`Map of the United Kingdom with ${view.plotted.length} members plotted`}
            >
              {/* ⚠️ THE LAND IS NEUTRAL GREY ON PURPOSE. Every other surface in
                  this product is pink-tinted, and a pink land fill would swallow
                  the pink dots that are the scarcer and more interesting half of
                  the data. */}
              <path d={UK_PATH} fill="#EFEAEC" stroke="#3D2E2E" strokeOpacity={0.25}
                    strokeWidth={1.2} strokeLinejoin="round" />

              {view.pins.map(p => {
                /* ⚠️ members[0] IS THE PERSON THIS MARK IS. The rest are whoever
                   is underneath, and they belong in the label and the panel —
                   never in the mark, which would be a count again. */
                const label = p.members
                  .map(m => `${nameOf(m)} — ${roleWord(m.role)} — ${townOf(m)}`)
                  .join('\n')
                return (
                  <g key={p.key}
                     onMouseEnter={() => setHover(p)}
                     onMouseLeave={() => setHover(h => (h?.key === p.key ? null : h))}
                     style={{ cursor: 'pointer' }}>
                    {/* ⚠️ THE WHITE RING IS NOT DECORATION — it is what keeps two
                        dots a mile apart from reading as one blob, which at
                        1 unit ≈ 1.11 km happens constantly in south-east
                        London. */}
                    {/* ⚠️ ONE RADIUS. There is no second size, because there is
                        no second kind of mark — every circle on this map is one
                        member at their own postcode.

                        ⚠️ A COUNT USED TO BE DRAWN INSIDE THIS CIRCLE, on the
                        rule that "three people at one postcode must not look
                        like one BEFORE anybody hovers — a tooltip-only answer
                        is an answer to a question the reader does not know to
                        ask". That rule was right and the badge still failed it:
                        rendered and looked at, the badges in inner London
                        overlapped each other until two of them could not be
                        read at all. An unreadable count answers nothing and
                        occupies the space where the people were.

                        ⚠️ SO THE QUESTION IS ANSWERED IN WORDS INSTEAD, in the
                        panel beside the map, which says how many members sit
                        under another member's dot. It is a worse answer than a
                        working badge would have been. It is a better one than a
                        badge nobody can read. */}
                    <circle cx={p.x} cy={p.y} r={DOT_R} fill={p.colour}
                            stroke="#FFFFFF" strokeWidth={1.6} />
                    {/* Native tooltip as well as the panel, so the information is
                        reachable without a mouse-driven React state. */}
                    <title>{label}</title>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40">
              On the map
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-[#3D2E2E]">
              <li className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: MODEL }} />
                <strong className="font-semibold">{view.modelCount}</strong> models
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: STYLIST }} />
                <strong className="font-semibold">{view.stylistCount}</strong> stylists
                <span className="text-xs text-[#3D2E2E]/50">(incl. both)</span>
              </li>
              {/* The third row was a dark swatch for "a numbered dot holding
                  both kinds". Nothing holds both kinds now — a mark is one
                  member, so it is one colour, and a legend entry for a mark
                  that cannot occur is worse than no entry. */}
            </ul>
            <p className="mt-3 border-t border-black/5 pt-3 text-xs text-[#3D2E2E]/60">
              {/* ⚠️ COMPUTED FROM THE DATA, NOT WRITTEN DOWN, so it stays true
                  on its own as members join. It changed on 6 Nov 2026 only
                  because what it describes changed: it used to say how many
                  members sat under a NUMBERED dot, and there are none. */}
              {view.overlapping === 0
                ? 'Every dot is one member, and none of them touch.'
                : `Every dot is one member. ${view.overlapping} of them overlap another, because those members are closer together than one dot is wide — so the pile in London is smaller than the number of people in it. Hover any dot and this panel names everyone underneath it, with their own towns.`}
            </p>
          </div>

          <div className={`${card} p-4`}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40">
              {hover
                ? (hover.members.length > 1 ? 'This member, and who is under them' : 'This member')
                : 'Hover a dot'}
            </h2>
            {hover ? (
              <ul className="mt-3 space-y-2">
                {hover.members.map(m => (
                  <li key={m.id} className="text-sm">
                    <span className="font-medium text-[#3D2E2E]">{nameOf(m)}</span>
                    <span className="block text-xs text-[#3D2E2E]/60">
                      {roleWord(m.role)} · {townOf(m)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              /* ⚠️ A FIXED PANEL RATHER THAN A FLOATING TOOLTIP. A tooltip that
                 follows the cursor needs to know the viewport to avoid running
                 off the edge, and gets it wrong on the dots nearest the frame —
                 which here are Cornwall, Norfolk and the whole north. This
                 cannot be clipped, cannot cover the dot being pointed at, and
                 holds a list of any length. */
              <p className="mt-3 text-xs text-[#3D2E2E]/50">
                Name, role and town appear here. Nothing else is on this page —
                no email, no postcode, no date of birth.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
