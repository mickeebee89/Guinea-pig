'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { adminErrorText, shopsNote } from '@/lib/adminActions'
import type { ActionResult } from '@/lib/adminActions'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string | null
  last_initial: string | null
  role: string
  region: string
  is_verified: boolean
  fraud_flagged: boolean
  subscription_status: string
  is_founding_provider: boolean
  provider_fee_waived: boolean
  subscription_waived: boolean
  date_of_birth: string | null
  created_at: string
  session_count?: number
  report_count?: number
  fee_paid?: boolean
  // Current suspension state, derived from the suspensions table. null = active.
  suspension?: { banned: boolean; until: string | null } | null
}

const ROLES = ['all', 'model', 'provider', 'both']


// Mirrors is_suspended() in supabase/suspension-enforcement.sql: banned outright,
// or suspended with an end date still in the future. Expired rows are inert.
function activeSuspension(rows: { banned: boolean | null; suspended_until: string | null }[]) {
  const now = Date.now()
  const banned = rows.find(r => r.banned)
  if (banned) return { banned: true, until: null }
  const timed = rows
    .filter(r => r.suspended_until && new Date(r.suspended_until).getTime() > now)
    .sort((a, b) => new Date(b.suspended_until!).getTime() - new Date(a.suspended_until!).getTime())[0]
  return timed ? { banned: false, until: timed.suspended_until } : null
}

function statusBadge(s: User['suspension']) {
  if (s?.banned) {
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-600 text-white">Banned</span>
  }
  if (s) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700"
        title={`Suspended until ${new Date(s.until!).toLocaleString('en-GB')}`}
      >
        Suspended · {new Date(s.until!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </span>
    )
  }
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Active</span>
}

export default function UsersPage() {
  const [users, setUsers]     = useState<User[]>([])
  const [search, setSearch]   = useState('')
  const [role, setRole]       = useState('all')
  const [verified, setVerified] = useState('all')
  const [status, setStatus]   = useState('all')

  const [modal, setModal] = useState<{ user: User; action: string } | null>(null)
  const [reason, setReason]   = useState('')
  /**
   * How many upcoming bookings a revoke would cancel. Null while it is being
   * read, so the modal says "checking" rather than a confident 0.
   *
   * ⚠️ READ WHEN THE MODAL OPENS, not from a row this page loaded earlier.
   * The number is the whole reason that panel is worth having, and a stale one
   * would understate what is about to happen to real people — the same stale-row
   * failure the flag/waive/comp actions already guard against downstream.
   */
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null)
  /**
   * The message the STYLIST reads. Separate from `reason`, which she never
   * sees. Audit item 117.
   *
   * ⚠️ TWO BOXES ON PURPOSE. `reason` is moderation evidence and may name the
   * person who reported her; publishing it would be the disclosure this
   * product refuses everywhere else. This box is written for her.
   */
  const [message, setMessage] = useState('')
  const [duration, setDuration] = useState('7')

  const { loading, reload } = useLoader(`${role}|${verified}`, async stale => {
    let q = supabase.from('users').select('*').order('created_at', { ascending: false })
    if (role !== 'all') q = q.eq('role', role)
    if (verified === 'verified')   q = q.eq('is_verified', true)
    if (verified === 'unverified') q = q.eq('is_verified', false)
    const { data } = await q
    if (!data) return

    // One batched read for the whole page rather than a per-row check — this page
    // already fires three queries per user and doesn't need a fourth.
    const { data: suspRows } = await supabase
      .from('suspensions')
      .select('user_id, banned, suspended_until')
      .in('user_id', data.map(u => u.id))
    // Shape copied from the select() three lines above, not assumed.
    type SuspRow = { user_id: string; banned: boolean | null; suspended_until: string | null }
    const suspByUser: Record<string, { banned: boolean | null; suspended_until: string | null }[]> = {}
    for (const r of (suspRows ?? []) as unknown as SuspRow[]) {
      ;(suspByUser[r.user_id] ??= []).push(r)
    }

    const enriched = await Promise.all(data.map(async (u) => {
      const [{ count: sc }, { count: rc }, { count: pc }] = await Promise.all([
        supabase.from('sessions').select('*', { count: 'exact', head: true }).or(`model_id.eq.${u.id}`),
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('reported_id', u.id),
        supabase.from('verification_payments').select('*', { count: 'exact', head: true }).eq('user_id', u.id),
      ])
      return {
        ...u,
        session_count: sc ?? 0,
        report_count: rc ?? 0,
        fee_paid: (pc ?? 0) > 0,
        suspension: activeSuspension(suspByUser[u.id] ?? []),
      }
    }))
    if (stale()) return
    setUsers(enriched)
  })

  const filtered = users.filter(u => {
    const matchesSearch = !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
      `${u.first_name} ${u.last_name ?? ''} ${u.last_initial ?? ''}`.toLowerCase().includes(search.toLowerCase())
    if (!matchesSearch) return false
    // Filtered client-side: the suspension state is derived (banned vs a date in
    // the future), so it isn't a column the query could filter on.
    if (status === 'active')    return !u.suspension
    if (status === 'suspended') return !!u.suspension && !u.suspension.banned
    if (status === 'banned')    return !!u.suspension?.banned
    if (status === 'restricted')return !!u.suspension
    return true
  })

  /**
   * ── ONE CALL. THE ACTION AND ITS RECORD COMMIT TOGETHER, OR NEITHER DOES ──
   *
   * This page used to perform the write, check it, then insert the audit row
   * separately. Checking first fixed audit item 27's FALSE entry — a row
   * claiming an action RLS had refused — but left item 29's GAP: the action
   * could land and the record fail, leaving a suspension in force with nothing
   * saying who did it or why, in a table kept six years as the evidence for a
   * ban.
   *
   * admin_act_on_user (0039) does both in one transaction. What that removes
   * from this file is the point of it:
   *
   *   * THE EIGHT-BRANCH SWITCH. The database now holds the one copy of what
   *     each action means. Three copies is why the reports and providers pages
   *     still stack suspensions that this page learned not to stack in 0035.
   *
   *   * logAction. The function writes the row; a second insert here would
   *     double-record.
   *
   *   * THE "applied but could NOT be recorded" ALERT, deleted rather than
   *     reworded. It described a state this function makes impossible, and a
   *     message describing an impossible state is worse than none — the next
   *     person reads it as evidence the state can happen.
   *
   *   * THE warn BRANCH. The notification IS the action there, so it belongs
   *     inside the transaction (0035's header, the one decision 0039 revisits).
   *     An audit row saying "warned" can no longer outlive a warning that was
   *     never delivered.
   *
   *   * THE default: BRANCH, which refused an action with no write so that a
   *     new action string could not silently produce an audit row for something
   *     that never ran. That guard is NOT gone — it is _admin_apply_user_action's
   *     else clause, raising `unknown action %`. Noted here because it moved from
   *     a file the next console author reads into one they may not.
   *
   *   * !user.fraud_flagged AND ITS TWO SIBLINGS. The toggles were computed
   *     from a row this page read at some earlier point. The function reads and
   *     flips inside the same transaction and returns what the value BECAME, so
   *     a stale page can no longer silently do the opposite of what was clicked.
   */
  /**
   * Open the modal, and for a revoke go and count what it would cancel.
   *
   * The same definition `_withdraw_stylist` uses (0044:320-323): pending or
   * accepted, dated today or later, where this user is the STYLIST. Written
   * out here rather than shared, because the function is in SQL and this is a
   * read-only preview of it — if the two ever disagree the function wins, and
   * the alert afterwards reports what it actually did.
   */
  function openModal(user: User, action: string) {
    setModal({ user, action })
    setReason('')
    setMessage('')
    setUpcomingCount(null)
    if (action !== 'revoke_verification') return
    void (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10)
        const { data: prov } = await supabase
          .from('providers').select('id').eq('user_id', user.id).maybeSingle()
        const providerId = (prov as { id?: string } | null)?.id
        if (!providerId) { setUpcomingCount(0); return }
        const { count } = await supabase
          .from('sessions').select('id', { count: 'exact', head: true })
          .eq('provider_id', providerId)
          .in('status', ['pending', 'accepted'])
          .gte('date', today)
        setUpcomingCount(count ?? 0)
      } catch {
        // Leave it null. "Checking…" that never resolves is honest; a 0 that
        // is really a failed read would tell her nobody is affected.
        setUpcomingCount(null)
      }
    })()
  }

  async function doAction() {
    if (!modal) return
    const { user, action } = modal

    // ══ REVOKE IS ITS OWN FUNCTION, NOT AN admin_act_on_user ACTION ══════
    //
    // `revoke_verification(uuid, text)` has existed since 0027 and **nothing
    // has ever called it** (audit item 14), so undoing a mistaken approval
    // meant hand-written SQL on a live database.
    //
    // It is not folded into admin_act_on_user because it is not a user action
    // in that sense: it reverses a DECISION, requires its own mandatory reason
    // (≥10 characters, enforced in the database), and returns how many
    // bookings it cancelled — which is the number this page has to show back.
    if (action === 'revoke_verification') {
      const { data, error } = await supabase.rpc('revoke_verification', {
        p_user_id: user.id,
        p_reason:  reason.trim(),
        // Optional. Null rather than '' so the function's own nullif sees it
        // the way it expects, and she gets the no-message wording.
        p_message: message.trim() || undefined,
      })
      if (error) {
        alert(`Could not revoke verification.\n\n${adminErrorText(error)}\n\nNothing has changed.`)
        return
      }
      const r = (data ?? {}) as { cancelled_bookings?: number; message_sent?: boolean }
      const n = r.cancelled_bookings ?? 0
      alert(
        `${user.first_name}'s verification is revoked and their shop is hidden.\n\n` +
        (n === 0
          ? 'No upcoming bookings needed cancelling.'
          : `${n} upcoming booking${n === 1 ? '' : 's'} cancelled. Each model has been told ` +
            `the stylist can't take bookings at the moment — not why, and not that this was ` +
            `a decision about them.`) +
        `\n\nThey can submit a new ID check whenever they like; the old request row is gone, ` +
        `so /verify offers them the submit path again.\n\n` +
        (r.message_sent
          ? 'They have been told, by notification and email, and your message to them was included.'
          : 'They have been told, by notification and email \u2014 with no message from you, so they ' +
            'have the facts and the support address and nothing about why.'),
      )
      setModal(null)
      setReason('')
      setMessage('')
      reload()
      return
    }

    const { data, error } = await supabase.rpc('admin_act_on_user', {
      p_user_id:       user.id,
      p_action:        action,
      p_reason:        reason.trim() || null,
      p_duration_days: action === 'suspend' ? Number(duration) : null,
      // 0058. Separate from p_reason, which the member never sees.
      p_message:       message.trim() || undefined,
    })

    if (error) {
      // There is no partial state to describe. It committed or it did not.
      alert(`Could not ${action} this user.\n\n${adminErrorText(error)}\n\nNothing has changed.`)
      return
    }

    const result = (data ?? {}) as ActionResult

    // What the button PROMISED, from the row this page last read, against what
    // the transaction actually did. Silence here would mean an admin who
    // clicked "Flag fraud" on a stale row has just unflagged someone instead.
    const promised: Partial<Record<string, boolean>> = {
      flag:  !user.fraud_flagged,
      waive: !user.provider_fee_waived,
      comp:  !user.subscription_waived,
    }
    if (typeof result.new_value === 'boolean'
        && promised[action] !== undefined
        && result.new_value !== promised[action]) {
      alert(
        'This page was showing stale information.\n\n' +
        `You clicked to turn this ${promised[action] ? 'ON' : 'OFF'}, and it is now ` +
        `${result.new_value ? 'ON' : 'OFF'} — it had already been changed since this page loaded. ` +
        'What the database now holds is what stands.',
      )
    }

    if (action === 'verify') {
      const note = shopsNote(result.shops ?? [])
      if (note) {
        alert(
          `${user.first_name} is verified, but that did not make their shop live.\n\n${note}\n\n` +
          'Nothing needs re-doing — this is what the shop looks like now.',
        )
      }
    }

    setModal(null)
    setReason('')
    setMessage('')
    reload()
  }

  // Age from the signup date of birth (18+ is enforced at signup). Null for
  // accounts created before the DOB field existed — shown as "—".
  const ageFrom = (dob: string | null) => {
    if (!dob) return null
    const d = new Date(dob)
    if (isNaN(d.getTime())) return null
    const today = new Date()
    let age = today.getFullYear() - d.getFullYear()
    const m = today.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
    return age
  }

  const badge = (v: boolean, t: string, f: string) =>
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{v ? t : f}</span>

  // Provider £14.99 fee state → what unlocks "make shop live" on mobile.
  const feeStatus = (u: User) => {
    const [label, cls] =
      u.provider_fee_waived      ? ['Waived',   'bg-purple-100 text-purple-700'] :
      u.is_founding_provider     ? ['Founding', 'bg-yellow-100 text-yellow-700'] :
      u.fee_paid                 ? ['Paid',     'bg-green-100 text-green-700']   :
                                   ['Unpaid',   'bg-red-100 text-red-700']
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Users</h1>

      <div className="flex gap-3 mb-5 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="border border-black/10 rounded-lg px-3 py-2 text-sm w-64 bg-white"
        />
        <select value={role} onChange={e => setRole(e.target.value)}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white">
          {ROLES.map(r => <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>)}
        </select>
        <select value={verified} onChange={e => setVerified(e.target.value)}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="all">All</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="all">Any status</option>
          <option value="active">Active only</option>
          <option value="restricted">Suspended or banned</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-black/5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-left px-4 py-2">Age</th>
                <th className="text-left px-4 py-2">Verified</th>
                <th className="text-left px-4 py-2">Fee</th>
                <th className="text-left px-4 py-2">Subscription</th>
                <th className="text-left px-4 py-2">Sessions</th>
                <th className="text-left px-4 py-2">Reports</th>
                <th className="text-left px-4 py-2">Joined</th>
                <th className="text-left px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Banned rows are tinted so they're obvious when scanning; a fraud
                 flag keeps its existing red tint but a ban outranks it. */}
              {filtered.map(u => (
                <tr key={u.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.01] ${
                  u.suspension?.banned ? 'bg-red-100'
                  : u.suspension ? 'bg-orange-50'
                  : u.fraud_flagged ? 'bg-red-50' : ''
                }`}>
                  <td className="px-4 py-2 font-medium">
                    {u.first_name} {u.last_name ?? (u.last_initial ? `${u.last_initial}.` : '')}
                    {u.fraud_flagged && <span className="ml-1 text-red-500 text-xs">⚑</span>}
                    {u.is_founding_provider && <span className="ml-1 text-yellow-600 text-xs">★</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{statusBadge(u.suspension)}</td>
                  <td className="px-4 py-2 text-[#3D2E2E]/60">{u.email}</td>
                  <td className="px-4 py-2 capitalize">{u.role}</td>
                  <td className="px-4 py-2 text-[#3D2E2E]/60" title={u.date_of_birth ? new Date(u.date_of_birth).toLocaleDateString('en-GB') : 'No date of birth on record'}>
                    {ageFrom(u.date_of_birth) ?? <span className="text-[#3D2E2E]/30">—</span>}
                  </td>
                  <td className="px-4 py-2">{badge(u.is_verified, 'Verified', 'No')}</td>
                  <td className="px-4 py-2">{(u.role === 'provider' || u.role === 'both') ? feeStatus(u) : <span className="text-[#3D2E2E]/30">—</span>}</td>
                  <td className="px-4 py-2 capitalize text-[#3D2E2E]/60">
                    {u.subscription_waived
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Comp</span>
                      : u.subscription_status}
                  </td>
                  <td className="px-4 py-2">{u.session_count}</td>
                  <td className="px-4 py-2">{u.report_count && u.report_count > 0
                    ? <span className="text-red-600 font-medium">{u.report_count}</span>
                    : u.report_count}
                  </td>
                  <td className="px-4 py-2 text-[#3D2E2E]/50">{new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <div className="flex gap-1 flex-nowrap items-center">
                      {/* Primary: the actions used constantly for review/comp setup. */}
                      <button onClick={() => { openModal(u, 'verify') }}
                        title="Mark this user identity-verified"
                        className="text-[11px] px-2 py-1 rounded-md font-medium bg-blue-100 text-blue-700">
                        Verify
                      </button>
                      {/* ── WHAT THESE TWO FLAGS UNLOCK, DOWNSTREAM IN MOBILE ──────
                         These comments lived on the waive/comp branches of the
                         switch this page used to hold. 0039 sets the columns and
                         has no idea what they unlock — that is not a gap in the
                         function, it is knowledge that belongs where the person
                         granting it is standing.

                         provider_fee_waived  the mobile publish gate treats a
                           waived provider as fee-settled, so they can make their
                           shop live without paying the £14.99.
                         subscription_waived  the mobile apply-gate
                           (hasActiveSubscription) treats a waived member as
                           subscribed — for App Review demo accounts, comps and
                           promos.

                         Both are read-and-flipped inside the transaction ⟨D3⟩, so
                         these buttons say what they WILL do based on a row this
                         page last read; doAction reports it if that turned out
                         to be stale. */}
                      {(u.role === 'provider' || u.role === 'both') && (
                        <button onClick={() => { setModal({ user: u, action: 'waive' }); setReason('') }}
                          title={u.provider_fee_waived ? 'Revoke free access' : 'Waive the £14.99 verification fee'}
                          className="text-[11px] px-2 py-1 rounded-md font-medium bg-purple-100 text-purple-700">
                          {u.provider_fee_waived ? 'Revoke fee' : 'Free fee'}
                        </button>
                      )}
                      {(u.role === 'model' || u.role === 'both') && (
                        <button onClick={() => { setModal({ user: u, action: 'comp' }); setReason('') }}
                          title={u.subscription_waived ? 'Revoke complimentary membership' : 'Grant a complimentary membership (no Stripe charge)'}
                          className="text-[11px] px-2 py-1 rounded-md font-medium bg-purple-100 text-purple-700">
                          {u.subscription_waived ? 'Revoke sub' : 'Free sub'}
                        </button>
                      )}

                      {/* Moderation: condensed to glyph buttons (tooltips keep them clear). */}
                      {[
                        { a: 'warn',      glyph: '⚠',                          title: 'Warn',      color: 'bg-amber-100 text-amber-700' },
                        { a: 'suspend',   glyph: '⏸',                          title: 'Suspend',   color: 'bg-orange-100 text-orange-700' },
                        { a: 'ban',       glyph: '⛔',                          title: 'Ban',       color: 'bg-red-100 text-red-700' },
                        { a: 'reinstate', glyph: '↩',                          title: 'Reinstate', color: 'bg-green-100 text-green-700' },
                        // ⚠️ ONLY FOR SOMEONE WHO IS VERIFIED. Offering "revoke"
                        // on an unverified account is a button that can only
                        // fail, and the inverse of Verify belongs beside it.
                        ...(u.is_verified
                          ? [{ a: 'revoke_verification', glyph: '✖', title: 'Revoke verification', color: 'bg-red-100 text-red-700' }]
                          : []),
                        { a: 'flag',      glyph: u.fraud_flagged ? '⚐' : '⚑',  title: u.fraud_flagged ? 'Unflag fraud' : 'Flag fraud', color: 'bg-gray-100 text-gray-600' },
                      ].map(({ a, glyph, title, color }) => (
                        <button key={a} onClick={() => { openModal(u, a) }}
                          title={title}
                          className={`w-6 h-6 flex items-center justify-center rounded-md text-xs leading-none ${color}`}>
                          {glyph}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-10 text-[#3D2E2E]/30 text-sm">No users found</div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-[#3D2E2E] mb-1 capitalize">
              {modal.action === 'revoke_verification' ? 'Revoke verification' : `${modal.action} user`}
            </h2>
            <p className="text-sm text-[#3D2E2E]/60 mb-4">{modal.user.first_name} {modal.user.last_name ?? (modal.user.last_initial ? `${modal.user.last_initial}.` : '')} — {modal.user.email}</p>

            {modal.action === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Duration (days)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
              </div>
            )}
            {['suspend','ban'].includes(modal.action) && (
              // What 0044 made these do to a stylist. Said before Confirm,
              // because it reaches other people: every model they're booked with.
              <p className="mb-4 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
                If this user is a stylist, their shop is hidden and their upcoming bookings are
                cancelled. Each model is told the stylist can’t take bookings at the moment, not
                why. Lifting the {modal.action === 'ban' ? 'ban' : 'suspension'} does not republish
                the shop — the stylist does that themselves.
              </p>
            )}
            {modal.action === 'revoke_verification' && (
              /* ══ THE COST, WITH THE NUMBER, BEFORE THE BUTTON. ═══════════
                 This removes someone's ability to trade. The friction that
                 belongs here is not a type-to-confirm box — that is effort
                 without information. It is knowing how many real appointments
                 are about to be cancelled on real people, which is the part
                 that cannot be undone.

                 The reason field below is the second deliberate act, and the
                 database refuses anything under 10 characters regardless. */
              <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 space-y-2">
                <p className="font-semibold">
                  {upcomingCount === null
                    ? 'Checking how many bookings this affects…'
                    : upcomingCount === 0
                      ? 'No upcoming bookings will be cancelled.'
                      : `${upcomingCount} upcoming booking${upcomingCount === 1 ? '' : 's'} will be cancelled.`}
                </p>
                <p>
                  Their shop is hidden and their verification is cleared. Each model is told the
                  stylist can’t take bookings at the moment — <strong>not why</strong>, and not
                  that it was a decision about them. Lifting this later does not republish the
                  shop; the stylist does that.
                </p>
                <p>
                  They can submit a new ID check straight away — the old request row is deleted so
                  /verify offers them the submit path again.
                </p>
                <p>
                  She is told, by notification and email — what changed, that her shop is hidden,
                  how many bookings were cancelled, and how to do the ID check again (item 117).
                </p>
              </div>
            )}

            {modal.action === 'revoke_verification' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">
                  Reason — required, at least 10 characters
                </label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                  placeholder="What happened, in enough detail to be read back in a year."
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
                <p className="mt-1 text-[11px] text-[#3D2E2E]/50">
                  {/* Recorded in moderation_actions, append-only, kept six years. Shown
                      to nobody but an admin — the model's notice never carries it. */}
                  Recorded against this account and kept for six years. The stylist and the
                  models never see it. {reason.trim().length}/10
                </p>
              </div>
            )}

            {/* ══ THE EVIDENCE BOX. Admins only, six years, never shown. ══════
                Until 0058 this box WAS the member's explanation for warn,
                suspend and ban — one field doing two jobs, and a reason may
                name whoever reported them. Audit item 118. */}
            {['warn','suspend','ban'].includes(modal.action) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">
                  {modal.action === 'warn'
                    ? 'Reason — required, evidence for the record, never shown to them'
                    : 'Reason — evidence for the record, never shown to them'}
                </label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                  placeholder="e.g. third report this month; messaged two models after being asked to stop"
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
                <p className="mt-1 text-[11px] text-[#3D2E2E]/50">
                  Goes to the audit log. Safe to name names here — it is the one place that is.
                </p>
              </div>
            )}

            {/* ══ THE MESSAGE BOX. The only part the member reads. ════════════ */}
            {['revoke_verification','warn','suspend','ban'].includes(modal.action) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">
                  {modal.action === 'warn'
                    ? `Message to them — required. This IS the warning. ${message.trim().length}/10`
                    : modal.action === 'revoke_verification'
                      ? 'Message to the stylist — optional, and the only part she reads'
                      : 'Message to them — optional, and the only part they read'}
                </label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
                  placeholder={
                    modal.action === 'revoke_verification'
                      ? 'e.g. The photo you sent didn’t match your profile picture.'
                      : 'e.g. Please keep messages to arranging the appointment.'
                  }
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
                <p className="mt-1 text-[11px] text-[#3D2E2E]/50">
                  {/* The whole reason there are two boxes. */}
                  ⚠️ <strong>Never name anyone here.</strong>{' '}
                  {modal.action === 'warn'
                    ? 'A warning is nothing but this message. It is sent by notification and email, and without it they only learn they are in trouble.'
                    : modal.action === 'revoke_verification'
                      ? 'This goes to her by notification and email. Leave it blank and she gets the facts and the support address, but nothing she can act on — and she can reapply immediately, so she may just send the same thing again.'
                      : 'They see the notice and the date either way. This is the only part that says why.'}
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              <button
                onClick={doAction}
                // The database enforces this too (0044:391). Disabling here
                // means she is not told "at least 10 characters" AFTER writing
                // a reason and pressing a destructive button.
                disabled={(modal.action === 'revoke_verification' && reason.trim().length < 10)
                       || (modal.action === 'warn' && message.trim().length < 10)
                       // 0059, item 121. A warning needs BOTH: the message
                       // because it IS the warning, the reason because an
                       // action with no evidence is not a record.
                       || (modal.action === 'warn' && reason.trim().length === 0)}
                className="px-4 py-2 text-sm rounded-lg text-white font-medium disabled:bg-gray-300 disabled:text-gray-500"
                style={(modal.action === 'revoke_verification' && reason.trim().length < 10)
                    || (modal.action === 'warn' && (message.trim().length < 10 || !reason.trim()))
                  ? undefined
                  : { backgroundColor: '#8C4A58' }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
