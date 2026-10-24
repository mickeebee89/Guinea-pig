'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import {
  KEY_LABEL, isTestAccount, TEST_ACCOUNT_IDS, SLOT_BACKFILL_INSTANT,
  type ActivityKey,
} from '@/lib/activity'

/**
 * What has been happening, in one list.
 *
 * ── ⚠️ FIVE TYPES, READ DIRECTLY, NO RPC ────────────────────────────────
 * The sidebar's dots come from `admin_activity_counts`, which answers "how
 * many since you last looked". This page answers a different question — "what
 * were they" — and reads the tables the way every other admin page does. One
 * RPC that returned both would be a second place that decides what counts as
 * activity, and it would drift from the first.
 *
 * ── ⚠️ 7 DAYS AND 200 ROWS, BOTH ENFORCED IN THE QUERY ──────────────────
 * Not "fetch everything and slice". `favourites` is 2 rows today and
 * `messages` is 46, but `availability` is already 57 and sessions 40; a page
 * that fetched all history and trimmed in the browser would be fine for months
 * and then quietly become the slowest screen in the console.
 *
 * ⚠️ THE 200 CAP IS PER TYPE, THEN THE MERGED LIST IS CAPPED AGAIN. Five
 * queries each capped at 200 can produce 1000 rows before merging, and taking
 * the newest 200 of those is the only way the cap means what it says.
 */

interface Row {
  id: string
  at: string
  type: ActivityKey
  who: string
  what: string
  /** Made by one of Micky's QA accounts. Hidden unless "Show test accounts". */
  isTest: boolean
}

const SINCE_DAYS = 7
const CAP = 200

type Named = { first_name?: string | null; last_initial?: string | null }

/** A name from a users row, or something honest when RLS hid it. */
function nameOf(u: Named | null): string {
  if (!u) return 'Someone not visible'
  const n = `${u.first_name ?? ''} ${u.last_initial ? u.last_initial + '.' : ''}`.trim()
  return n || 'No name set'
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

const TYPE_STYLE: Record<ActivityKey, string> = {
  signup: 'bg-purple-100 text-purple-700',
  slot: 'bg-blue-100 text-blue-700',
  booking: 'bg-green-100 text-green-700',
  photo: 'bg-pink-100 text-pink-700',
  favourite: 'bg-yellow-100 text-yellow-700',
  users: '', providers: '', verification: '', moderation: '', reports: '', messages: '',
}

export default function ActivityPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)

  const { loading } = useLoader(`activity|${showTest}`, async stale => {
    const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString()

    // ⚠️ NO EMBEDDED JOINS. PostgREST embeds are named after the FOREIGN KEY,
    // and sessions.model_user_id / availability.provider_id point at ids whose
    // constraint names are not something to guess — a wrong one fails the
    // WHOLE query and this page would look like a quiet week. Names are
    // resolved below from one users read and one providers read, which is the
    // pattern moderation/page.tsx already uses.
    const [signups, slots, bookings, photos, favs] = await Promise.all([
      supabase.from('users')
        .select('id, created_at, first_name, last_initial, role')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(CAP),
      // ⚠️ availability.created_at exists only from 0104, and the 57 rows that
      // predate it carry the migration's own clock rather than when they were
      // posted. Inside a 7-day window that stops mattering a week after
      // applying; before then those rows show a time nothing happened at.
      // ⚠️ `gt` THE BACKFILL INSTANT, not just `gte` the window. All 57 rows
      // that predate 0104 carry the migration's own clock, so they would
      // otherwise arrive as 57 simultaneous events that never happened. See
      // SLOT_BACKFILL_INSTANT.
      supabase.from('availability')
        .select('id, created_at, provider_id, date, start_time')
        .gte('created_at', since)
        .gt('created_at', SLOT_BACKFILL_INSTANT)
        .order('created_at', { ascending: false }).limit(CAP),
      supabase.from('sessions')
        .select('id, created_at, model_user_id, provider_id, date, status')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(CAP),
      supabase.from('model_photos')
        .select('id, created_at, user_id')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(CAP),
      supabase.from('favourites')
        .select('id, created_at, user_id, provider_id')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(CAP),
    ])

    if (stale()) return

    // ⚠️ A FAILED READ IS NAMED, NOT SWALLOWED. Five queries, and one of them
    // failing silently would make this page look like a quiet week.
    const failed = ([
      ['sign-ups', signups.error], ['slots', slots.error], ['bookings', bookings.error],
      ['photos', photos.error], ['favourites', favs.error],
    ] as const).filter(([, e]) => e).map(([n]) => n)
    setProblem(failed.length ? `Could not load: ${failed.join(', ')}. The rest is below.` : null)

    type SignupRow = { id: string; created_at: string; first_name: string | null; last_initial: string | null; role: string }
    type SlotRow = { id: string; created_at: string; provider_id: string; date: string; start_time: string }
    type BookingRow = { id: string; created_at: string; model_user_id: string; provider_id: string; date: string; status: string }
    type PhotoRow = { id: string; created_at: string; user_id: string }
    type FavRow = { id: string; created_at: string; user_id: string; provider_id: string }

    const signupRows = (signups.data ?? []) as unknown as SignupRow[]
    const slotRows = (slots.data ?? []) as unknown as SlotRow[]
    const bookingRows = (bookings.data ?? []) as unknown as BookingRow[]
    const photoRows = (photos.data ?? []) as unknown as PhotoRow[]
    const favRows = (favs.data ?? []) as unknown as FavRow[]

    // One read each for the names, scoped to the ids actually on this page.
    const userIds = [...new Set([
      ...bookingRows.map(r => r.model_user_id),
      ...photoRows.map(r => r.user_id),
      ...favRows.map(r => r.user_id),
    ].filter(Boolean))]
    const provIds = [...new Set([
      ...slotRows.map(r => r.provider_id),
      ...bookingRows.map(r => r.provider_id),
      ...favRows.map(r => r.provider_id),
    ].filter(Boolean))]

    const [userRes, provRes] = await Promise.all([
      userIds.length
        ? supabase.from('users').select('id, first_name, last_initial').in('id', userIds)
        : Promise.resolve({ data: [] }),
      provIds.length
        ? supabase.from('providers').select('id, name, user_id').in('id', provIds)
        : Promise.resolve({ data: [] }),
    ])
    if (stale()) return

    const userById: Record<string, Named> = {}
    for (const u of (userRes.data ?? []) as unknown as (Named & { id: string })[]) userById[u.id] = u
    const provName: Record<string, string> = {}
    const provOwner: Record<string, string> = {}
    for (const p of (provRes.data ?? []) as unknown as
         { id: string; name: string | null; user_id: string }[]) {
      if (p.name?.trim()) provName[p.id] = p.name.trim()
      provOwner[p.id] = p.user_id
    }

    const out: Row[] = []
    for (const r of signupRows) {
      out.push({ id: `signup-${r.id}`, at: r.created_at, type: 'signup', who: nameOf(r),
        what: `joined as a ${r.role === 'provider' ? 'stylist' : r.role}`,
        isTest: isTestAccount(r.id) })
    }
    for (const r of slotRows) {
      out.push({ id: `slot-${r.id}`, at: r.created_at, type: 'slot',
        who: provName[r.provider_id] ?? 'A stylist',
        what: `posted a slot on ${r.date} at ${r.start_time?.substring(0, 5)}`,
        isTest: isTestAccount(provOwner[r.provider_id]) })
    }
    for (const r of bookingRows) {
      out.push({ id: `booking-${r.id}`, at: r.created_at, type: 'booking',
        who: nameOf(userById[r.model_user_id] ?? null),
        what: `applied to ${provName[r.provider_id] ?? 'a stylist'} for ${r.date} — now ${r.status}`,
        // Either side being a test account makes the booking one.
        isTest: isTestAccount(r.model_user_id) || isTestAccount(provOwner[r.provider_id]) })
    }
    for (const r of photoRows) {
      out.push({ id: `photo-${r.id}`, at: r.created_at, type: 'photo',
        who: nameOf(userById[r.user_id] ?? null), what: 'added a photo to their gallery',
        isTest: isTestAccount(r.user_id) })
    }
    for (const r of favRows) {
      out.push({ id: `fav-${r.id}`, at: r.created_at, type: 'favourite',
        who: nameOf(userById[r.user_id] ?? null),
        what: `favourited ${provName[r.provider_id] ?? 'a stylist'}`,
        isTest: isTestAccount(r.user_id) || isTestAccount(provOwner[r.provider_id]) })
    }

    /**
     * ⚠️ FILTERED AFTER MERGING, NOT IN THE QUERIES, AND THAT IS DELIBERATE.
     * Doing it in SQL would mean five `.not('user_id','in',...)` clauses that
     * have to agree with each other, and the slot rows cannot be filtered that
     * way at all — their account is the provider's OWNER, which this page only
     * learns after the providers read. One place, one rule, visibly applied.
     */
    const kept = out.filter(r => showTest || !r.isTest)
    setHiddenCount(out.length - kept.length)

    // ⚠️ CAPPED AGAIN AFTER MERGING. Five queries each capped at 200 can
    // produce 1000 rows, and taking the newest 200 of those is the only way the
    // cap means what the footnote says it means.
    kept.sort((a, b) => b.at.localeCompare(a.at))
    if (stale()) return
    setRows(kept.slice(0, CAP))
  })

  const card = 'bg-white rounded-xl border border-black/5 shadow-sm'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Activity</h1>
        <p className="mt-1 text-sm text-[#3D2E2E]/60">
          Sign-ups, slots, bookings, photos and favourites from the last {SINCE_DAYS} days,
          newest first. Opening this page clears its dot.
        </p>
      </div>

      {/* ⚠️ NEITHER FILTER IS SILENT. A feed that quietly drops rows is a feed
          you cannot trust to tell you a quiet week from a broken query, which
          is the one thing this page is for. Both say what they removed and the
          first can be switched off. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-[#3D2E2E]/70">
          <input type="checkbox" checked={showTest}
            onChange={e => setShowTest(e.target.checked)} />
          Show test accounts
        </label>
        {!showTest && hiddenCount > 0 && (
          <span className="text-[#3D2E2E]/50">
            {hiddenCount} row{hiddenCount === 1 ? '' : 's'} hidden from{' '}
            {Object.keys(TEST_ACCOUNT_IDS).length} test accounts.
          </span>
        )}
      </div>

      {/* ⚠️ THE SLOTS THAT ARE NOT EVENTS. Stated here rather than only in a
          comment, because the gap it explains is visible: availability had no
          created_at until 0104, so every slot posted before 24 Oct carries the
          migration's clock and none of them appears below. */}
      <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs text-[#3D2E2E]/60">
        Slots posted before 24 Oct aren’t shown. The column that records when a slot
        was created was only added that day, so every older row carries the migration’s
        timestamp rather than when the stylist actually posted it — showing them would
        mean showing 57 things that all happened at once and none of which did.
      </p>

      {problem && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{problem}</p>
      )}

      <div className={`${card} overflow-x-auto`}>
        {loading ? (
          <p className="px-4 py-6 text-sm text-[#3D2E2E]/60">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#3D2E2E]/60">
            Nothing in the last {SINCE_DAYS} days.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[#3D2E2E]/50">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">What</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-black/5">
                  <td className="whitespace-nowrap px-4 py-2 text-[#3D2E2E]/60">{fmt(r.at)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[r.type]}`}>
                      {KEY_LABEL[r.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium text-[#3D2E2E]">{r.who}</td>
                  <td className="px-4 py-2 text-[#3D2E2E]/70">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length === CAP && (
        <p className="text-xs text-[#3D2E2E]/50">
          Showing the newest {CAP}. There may be more in the last {SINCE_DAYS} days.
        </p>
      )}
    </div>
  )
}
