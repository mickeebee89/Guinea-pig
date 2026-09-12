'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'

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

/**
 * What admin_act_on_user returns. Copied from 0039's _provider_shops_state and
 * _admin_apply_user_action rather than inferred from one observed response:
 *
 *   warn | suspend | ban | reinstate   {}
 *   verify                             { shops: [...] }
 *   flag | waive | comp                { new_value: boolean }
 *
 * The shop entries are FACTS and not a reason — published, could-be-published
 * (by the existing check, not a third copy of it), and ever-published, so
 * "not republished" can be told apart from "not ready".
 */
interface ShopState {
  provider_id: string
  published: boolean
  publishable: boolean
  ever_published: boolean
}
interface ActionResult {
  new_value?: boolean
  shops?: ShopState[]
}

/** 0039 prefixes its messages for a database log. An alert is not a log. */
const humanError = (m: string) => m.replace(/^admin_act_on_user:\s*/, '')

/**
 * ── AN APPROVAL THAT DOES NOT PUBLISH TELLS NOBODY ───────────────────────
 *
 * Verifying a stylist is supposed to make their shop live. When it does not,
 * nothing on this screen said so: the shop stayed hidden, the admin saw a
 * success, and the stylist was told they were verified. Jojo B sat in exactly
 * that state for four days (audit items 29 and 40).
 *
 * Returns null when there is nothing worth saying — a model with no shops, or
 * a shop that is live, which is what the admin already expected.
 */
function shopsNote(shops: ShopState[]): string | null {
  if (shops.length === 0) return null
  const hidden = shops.filter(sh => !sh.published)
  if (hidden.length === 0) return null

  const why = (sh: ShopState) =>
    !sh.publishable
      ? 'it is not ready — a shop needs a name and at least one treatment with a category'
      : sh.ever_published
        ? 'it is ready, and it has been live before, so it is hidden by choice rather than by the rules'
        : 'it is ready to publish but is not live'

  const lead = shops.length === 1
    ? 'Their shop is NOT live: '
    : `${hidden.length} of their ${shops.length} shops are NOT live: `
  return lead + hidden.map(why).join('; ') + '.'
}

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
  async function doAction() {
    if (!modal) return
    const { user, action } = modal

    const { data, error } = await supabase.rpc('admin_act_on_user', {
      p_user_id:       user.id,
      p_action:        action,
      p_reason:        reason.trim() || null,
      p_duration_days: action === 'suspend' ? Number(duration) : null,
    })

    if (error) {
      // There is no partial state to describe. It committed or it did not.
      alert(`Could not ${action} this user.\n\n${humanError(error.message)}\n\nNothing has changed.`)
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
                      <button onClick={() => { setModal({ user: u, action: 'verify' }); setReason('') }}
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
                        { a: 'flag',      glyph: u.fraud_flagged ? '⚐' : '⚑',  title: u.fraud_flagged ? 'Unflag fraud' : 'Flag fraud', color: 'bg-gray-100 text-gray-600' },
                      ].map(({ a, glyph, title, color }) => (
                        <button key={a} onClick={() => { setModal({ user: u, action: a }); setReason('') }}
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
            <h2 className="text-lg font-bold text-[#3D2E2E] mb-1 capitalize">{modal.action} user</h2>
            <p className="text-sm text-[#3D2E2E]/60 mb-4">{modal.user.first_name} {modal.user.last_name ?? (modal.user.last_initial ? `${modal.user.last_initial}.` : '')} — {modal.user.email}</p>

            {modal.action === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Duration (days)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
              </div>
            )}
            {['warn','suspend','ban'].includes(modal.action) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Reason / note</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={doAction} className="px-4 py-2 text-sm rounded-lg text-white font-medium" style={{ backgroundColor: '#8C4A58' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
