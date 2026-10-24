'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { KEY_LABEL, type ActivityKey } from '@/lib/activity'

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

  const { loading } = useLoader('activity', async stale => {
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
      supabase.from('availability')
        .select('id, created_at, provider_id, date, start_time')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(CAP),
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
        ? supabase.from('providers').select('id, name').in('id', provIds)
        : Promise.resolve({ data: [] }),
    ])
    if (stale()) return

    const userById: Record<string, Named> = {}
    for (const u of (userRes.data ?? []) as unknown as (Named & { id: string })[]) userById[u.id] = u
    const provName: Record<string, string> = {}
    for (const p of (provRes.data ?? []) as unknown as { id: string; name: string | null }[]) {
      if (p.name?.trim()) provName[p.id] = p.name.trim()
    }

    const out: Row[] = []
    for (const r of signupRows) {
      out.push({ id: `signup-${r.id}`, at: r.created_at, type: 'signup', who: nameOf(r),
        what: `joined as a ${r.role === 'provider' ? 'stylist' : r.role}` })
    }
    for (const r of slotRows) {
      out.push({ id: `slot-${r.id}`, at: r.created_at, type: 'slot',
        who: provName[r.provider_id] ?? 'A stylist',
        what: `posted a slot on ${r.date} at ${r.start_time?.substring(0, 5)}` })
    }
    for (const r of bookingRows) {
      out.push({ id: `booking-${r.id}`, at: r.created_at, type: 'booking',
        who: nameOf(userById[r.model_user_id] ?? null),
        what: `applied to ${provName[r.provider_id] ?? 'a stylist'} for ${r.date} — now ${r.status}` })
    }
    for (const r of photoRows) {
      out.push({ id: `photo-${r.id}`, at: r.created_at, type: 'photo',
        who: nameOf(userById[r.user_id] ?? null), what: 'added a photo to their gallery' })
    }
    for (const r of favRows) {
      out.push({ id: `fav-${r.id}`, at: r.created_at, type: 'favourite',
        who: nameOf(userById[r.user_id] ?? null),
        what: `favourited ${provName[r.provider_id] ?? 'a stylist'}` })
    }

    // ⚠️ CAPPED AGAIN AFTER MERGING. Five queries each capped at 200 can
    // produce 1000 rows, and taking the newest 200 of those is the only way the
    // cap means what the footnote says it means.
    out.sort((a, b) => b.at.localeCompare(a.at))
    if (stale()) return
    setRows(out.slice(0, CAP))
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
