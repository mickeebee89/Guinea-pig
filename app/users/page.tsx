'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

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
  created_at: string
  session_count?: number
  report_count?: number
  fee_paid?: boolean
}

const ROLES = ['all', 'model', 'provider', 'both']

export default function UsersPage() {
  const [users, setUsers]     = useState<User[]>([])
  const [search, setSearch]   = useState('')
  const [role, setRole]       = useState('all')
  const [verified, setVerified] = useState('all')
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState<{ user: User; action: string } | null>(null)
  const [reason, setReason]   = useState('')
  const [duration, setDuration] = useState('7')

  async function load() {
    setLoading(true)
    let q = supabase.from('users').select('*').order('created_at', { ascending: false })
    if (role !== 'all') q = q.eq('role', role)
    if (verified === 'verified')   q = q.eq('is_verified', true)
    if (verified === 'unverified') q = q.eq('is_verified', false)
    const { data } = await q
    if (!data) { setLoading(false); return }

    const enriched = await Promise.all(data.map(async (u) => {
      const [{ count: sc }, { count: rc }, { count: pc }] = await Promise.all([
        supabase.from('sessions').select('*', { count: 'exact', head: true }).or(`model_id.eq.${u.id}`),
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('reported_id', u.id),
        supabase.from('verification_payments').select('*', { count: 'exact', head: true }).eq('user_id', u.id),
      ])
      return { ...u, session_count: sc ?? 0, report_count: rc ?? 0, fee_paid: (pc ?? 0) > 0 }
    }))
    setUsers(enriched)
    setLoading(false)
  }

  useEffect(() => { load() }, [role, verified])

  const filtered = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
    `${u.first_name} ${u.last_name ?? ''} ${u.last_initial ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  async function doAction() {
    if (!modal) return
    const { user, action } = modal
    const now = new Date()

    if (action === 'warn') {
      await supabase.from('notifications').insert({
        user_id: user.id, type: 'admin_warning',
        title: 'Warning from Guinea Pig',
        body: reason || 'You have received an official warning.',
      })
    }
    if (action === 'suspend') {
      const until = new Date(now.getTime() + parseInt(duration) * 24 * 60 * 60 * 1000)
      await supabase.from('suspensions').insert({ user_id: user.id, suspended_until: until.toISOString(), banned: false, reason })
    }
    if (action === 'ban') {
      await supabase.from('suspensions').insert({ user_id: user.id, banned: true, reason })
    }
    if (action === 'reinstate') {
      await supabase.from('suspensions').delete().eq('user_id', user.id)
    }
    if (action === 'verify') {
      await supabase.from('users').update({ is_verified: true }).eq('id', user.id)
    }
    if (action === 'flag') {
      await supabase.from('users').update({ fraud_flagged: !user.fraud_flagged }).eq('id', user.id)
    }
    if (action === 'waive') {
      // Free access: waive the £14.99 provider fee (or revoke it). The mobile publish
      // gate treats a waived provider as fee-settled, so they can make their shop live.
      await supabase.from('users').update({ provider_fee_waived: !user.provider_fee_waived }).eq('id', user.id)
    }
    if (action === 'comp') {
      // Free membership: grant/revoke a comped model subscription (no Stripe charge). The
      // mobile apply-gate (hasActiveSubscription) treats a waived member as subscribed —
      // for App-Review demo accounts, comps and promos.
      await supabase.from('users').update({ subscription_waived: !user.subscription_waived }).eq('id', user.id)
    }
    await logAction(action, { targetUserId: user.id, adminNote: reason })
    setModal(null)
    setReason('')
    load()
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
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-black/5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Role</th>
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
              {filtered.map(u => (
                <tr key={u.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.01] ${u.fraud_flagged ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-2 font-medium">
                    {u.first_name} {u.last_name ?? (u.last_initial ? `${u.last_initial}.` : '')}
                    {u.fraud_flagged && <span className="ml-1 text-red-500 text-xs">⚑</span>}
                    {u.is_founding_provider && <span className="ml-1 text-yellow-600 text-xs">★</span>}
                  </td>
                  <td className="px-4 py-2 text-[#3D2E2E]/60">{u.email}</td>
                  <td className="px-4 py-2 capitalize">{u.role}</td>
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
