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
const MIXED = '#3D2E2E'

const isStylist = (role: string) => role === 'provider' || role === 'both'
const roleWord = (role: string) =>
  role === 'provider' ? 'Stylist' : role === 'both' ? 'Model and stylist' : 'Model'

/** Built-up area, else the local authority, else nothing claimed. */
const townOf = (r: Row) => r.bua?.trim() || r.admin_district?.trim() || 'town unknown'

const nameOf = (r: Row) =>
  `${r.first_name ?? 'Someone'}${r.last_initial ? ` ${r.last_initial}.` : ''}`

/**
 * ── ⚠️⚠️ THE DOT SIZES, AND WHY MERGING IS DERIVED FROM THEM ──────────────
 * The map renders about 380 px wide for 598 units of viewBox, so one unit is
 * roughly 0.63 px and `DOT_R` of 5.5 is a dot about 7 px across. MEASURED by
 * rendering this exact path and these exact coordinates at that exact scale
 * before any of it was written: at 7 px, the nine members inside the M25 are
 * a pile in which about four are countable.
 *
 * So `MERGE` is not a tuned number. Two circles of radius r overlap when
 * their centres are closer than 2r, so merging at exactly 2r merges exactly
 * the dots that could not have been told apart anyway and nothing else. Change
 * `DOT_R` and the merge distance follows it, because it is the same fact.
 *
 * ⚠️ IT IS A RENDERING CLAIM, NOT A GEOGRAPHIC ONE. A badge of 5 means "five
 * members within about 12 km of each other, which is under one dot at this
 * scale" — it does not mean they share a postcode, and the hover gives each
 * one's own town so the difference is always one movement away.
 */
const DOT_R = 5.5
const GROUP_R = 9
const MERGE = DOT_R * 2

/** Members close enough together to be drawn as one mark. */
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
     * ⚠️ SORTED BEFORE CLUSTERING, SO THE RESULT IS THE SAME EVERY LOAD.
     * A greedy pass depends on the order it sees, and PostgREST makes no
     * promise about row order without an ORDER BY. North to south, then west
     * to east, so the first member of each pin — whose coordinate the pin
     * uses — is a stable choice rather than whichever row came back first.
     */
    const ordered = [...plotted].sort(
      (a, b) => b.latitude! - a.latitude! || a.longitude! - b.longitude!,
    )

    /**
     * ⚠️ THE PIN SITS ON A REAL MEMBER, NOT ON THE MIDDLE OF THE GROUP.
     * A centroid would put the mark somewhere nobody lives — in the Thames,
     * for the London group — and recomputing it as members join would make
     * the pin wander. Anchoring to the first member means the mark is always
     * a place where there is at least one of them, and the hover names the
     * rest with their own towns.
     *
     * ⚠️ AND NOTHING IS MOVED. Jitter was the alternative and was refused:
     * nudging a dot off its postcode to stop it touching its neighbour makes
     * the map say something false about where somebody lives, and at 25
     * members there would be no way to tell a jittered dot from a real one.
     * A number inside the mark adds information; a nudge replaces it.
     */
    const pins: Pin[] = []
    for (const r of ordered) {
      const [x, y] = project(r.latitude!, r.longitude!)
      const near = pins.find(p => Math.hypot(x - p.x, y - p.y) <= MERGE)
      if (near) near.members.push(r)
      else pins.push({ key: r.id, x, y, members: [r], colour: MODEL })
    }
    for (const p of pins) {
      const stylists = p.members.filter(m => isStylist(m.role)).length
      p.colour = stylists === p.members.length ? STYLIST : stylists === 0 ? MODEL : MIXED
    }
    // Single dots first, so a count badge is never buried under a plain one.
    pins.sort((a, b) => a.members.length - b.members.length)

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
      /** Pins holding more than one person — the ones carrying a number. */
      shared: pins.filter(p => p.members.length > 1).length,
      /** How many members are inside those pins, which is the honest figure. */
      sharedMembers: pins.filter(p => p.members.length > 1)
                         .reduce((n, p) => n + p.members.length, 0),
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
                const many = p.members.length > 1
                const r = many ? GROUP_R : DOT_R
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
                    <circle cx={p.x} cy={p.y} r={r} fill={p.colour}
                            stroke="#FFFFFF" strokeWidth={1.6} />
                    {many && (
                      /* ⚠️ THE NUMBER IS INSIDE THE DOT, NOT BESIDE IT. Three
                         people at one postcode must not look like one BEFORE
                         anybody hovers — a tooltip-only answer is an answer to
                         a question the reader does not know to ask. */
                      <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                            fontSize={9} fontWeight={700} fill="#FFFFFF"
                            style={{ pointerEvents: 'none' }}>
                        {p.members.length}
                      </text>
                    )}
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
              <li className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: MIXED }} />
                <span className="text-xs text-[#3D2E2E]/60">
                  a numbered dot holding both kinds
                </span>
              </li>
            </ul>
            <p className="mt-3 border-t border-black/5 pt-3 text-xs text-[#3D2E2E]/60">
              {view.shared === 0
                ? 'Every dot is one member — none are close enough to overlap.'
                : `${view.sharedMembers} members sit under ${view.shared} numbered dot${view.shared === 1 ? '' : 's'}, because they are closer together than one dot is wide. The count is drawn inside, so a group never looks like a single member, and hovering lists them with their own towns.`}
            </p>
          </div>

          <div className={`${card} p-4`}>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40">
              {hover ? (hover.members.length > 1 ? 'These members' : 'This member') : 'Hover a dot'}
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
