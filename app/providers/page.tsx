'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface Provider {
  id: string
  shop_handle: string
  level: string
  region: string
  location_text: string | null
  user: { id: string; first_name: string; last_initial: string | null; email: string; is_verified: boolean; fraud_flagged: boolean }
  session_count: number
  avg_rating: number | null
  portfolio_count: number
}

export default function ProvidersPage() {
  const [providers, setProviders]   = useState<Provider[]>([])
  const [search, setSearch]         = useState('')
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState<{ provider: Provider; action: string } | null>(null)
  const [reason, setReason]         = useState('')
  const [duration, setDuration]     = useState('7')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('providers')
      .select(`id, shop_handle, level, region, location_text,
        user:users!user_id(id, first_name, last_initial, email, is_verified, fraud_flagged)`)
      .order('shop_handle')
    if (!data) { setLoading(false); return }

    const enriched = await Promise.all((data as unknown as Provider[]).map(async (p) => {
      const [{ count: sc }, { data: reviews }, { count: pc }] = await Promise.all([
        supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('provider_id', p.id),
        supabase.from('reviews').select('overall_rating').eq('reviewee_id', p.user.id),
        supabase.from('portfolio_items').select('*', { count: 'exact', head: true }).eq('provider_id', p.id),
      ])
      const ratings = (reviews ?? []).map((r: { overall_rating: number }) => r.overall_rating)
      const avg = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null
      return { ...p, session_count: sc ?? 0, avg_rating: avg, portfolio_count: pc ?? 0 }
    }))
    setProviders(enriched)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = providers.filter(p =>
    !search ||
    p.shop_handle.toLowerCase().includes(search.toLowerCase()) ||
    (p.location_text ?? '').toLowerCase().includes(search.toLowerCase()) ||
    p.user.email.toLowerCase().includes(search.toLowerCase())
  )

  async function doAction() {
    if (!modal) return
    const { provider, action } = modal
    const now = new Date()

    if (action === 'suspend') {
      const until = new Date(now.getTime() + parseInt(duration) * 24 * 60 * 60 * 1000)
      await supabase.from('suspensions').insert({ user_id: provider.user.id, suspended_until: until.toISOString(), banned: false, reason })
    }
    if (action === 'ban') {
      await supabase.from('suspensions').insert({ user_id: provider.user.id, banned: true, reason })
    }
    if (action === 'verify') {
      await supabase.from('users').update({ is_verified: true }).eq('id', provider.user.id)
    }
    if (action === 'remove_portfolio') {
      await supabase.from('portfolio_items').delete().eq('provider_id', provider.id)
    }
    await logAction(`provider_${action}`, { targetUserId: provider.user.id, targetProviderId: provider.id, adminNote: reason })
    setModal(null)
    setReason('')
    load()
  }

  const stars = (n: number | null) => n === null ? '—' : '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n))

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Providers</h1>

      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search shop name, location or email…"
        className="border border-black/10 rounded-lg px-3 py-2 text-sm w-80 bg-white mb-5"
      />

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-black/5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Shop</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Level</th>
                <th className="text-left px-4 py-3">Region</th>
                <th className="text-left px-4 py-3">Verified</th>
                <th className="text-left px-4 py-3">Sessions</th>
                <th className="text-left px-4 py-3">Rating</th>
                <th className="text-left px-4 py-3">Portfolio</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.01] ${p.user.fraud_flagged ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-medium">@{p.shop_handle}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/60">{p.user.first_name} {p.user.last_initial}.</td>
                  <td className="px-4 py-3 capitalize">{p.level}</td>
                  <td className="px-4 py-3">{p.region}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.user.is_verified ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.user.is_verified ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{p.session_count}</td>
                  <td className="px-4 py-3 text-yellow-500 text-xs">{stars(p.avg_rating)}</td>
                  <td className="px-4 py-3">{p.portfolio_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {[
                        { a: 'suspend',          label: 'Suspend',        color: 'bg-orange-100 text-orange-700' },
                        { a: 'ban',              label: 'Ban',            color: 'bg-red-100 text-red-700' },
                        { a: 'verify',           label: 'Verify',         color: 'bg-blue-100 text-blue-700' },
                        { a: 'remove_portfolio', label: 'Remove Images',  color: 'bg-gray-100 text-gray-600' },
                      ].map(({ a, label, color }) => (
                        <button key={a} onClick={() => { setModal({ provider: p, action: a }); setReason('') }}
                          className={`text-xs px-2 py-1 rounded-md font-medium ${color}`}>{label}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-10 text-[#3D2E2E]/30 text-sm">No providers found</div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-[#3D2E2E] mb-1 capitalize">{modal.action.replace('_', ' ')}</h2>
            <p className="text-sm text-[#3D2E2E]/60 mb-4">@{modal.provider.shop_handle}</p>
            {modal.action === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Duration (days)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
              </div>
            )}
            {['suspend','ban','remove_portfolio'].includes(modal.action) && (
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
