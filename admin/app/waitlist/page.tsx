'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface WaitlistRow {
  id: string
  created_at: string
  first_name: string
  email: string
  role: 'stylist' | 'model'
  city: string | null
  social_handle: string | null
  consent: boolean
}

const ROLE_FILTERS = ['all', 'stylist', 'model'] as const
type RoleFilter = typeof ROLE_FILTERS[number]

export default function WaitlistPage() {
  const [rows, setRows]       = useState<WaitlistRow[]>([])
  const [roleFilter, setRole] = useState<RoleFilter>('all')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    let q = supabase.from('waitlist').select('*').order('created_at', { ascending: false })
    if (roleFilter !== 'all') q = q.eq('role', roleFilter)
    const { data } = await q
    setRows((data as WaitlistRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [roleFilter])

  const stylistCount = rows.filter(r => r.role === 'stylist').length
  const modelCount   = rows.filter(r => r.role === 'model').length

  // Quote any field containing a comma, quote, or newline so it stays one column.
  function exportCSV() {
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const table = [
      ['Joined', 'Name', 'Email', 'Role', 'City', 'Social', 'Consent'],
      ...rows.map(r => [
        new Date(r.created_at).toLocaleDateString('en-GB'),
        r.first_name,
        r.email,
        r.role,
        r.city ?? '',
        r.social_handle ?? '',
        r.consent ? 'yes' : 'no',
      ]),
    ]
    const csv = table.map(row => row.map(esc).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `cavy-waitlist-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const badge = (v: boolean, t: string, f: string) =>
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{v ? t : f}</span>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#3D2E2E]">Waitlist</h1>
          <p className="text-sm text-[#3D2E2E]/50 mt-1">
            {rows.length} {roleFilter === 'all' ? 'total' : roleFilter} · {stylistCount} stylist · {modelCount} model
          </p>
        </div>
        <button onClick={exportCSV}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-80 transition-opacity"
          style={{ backgroundColor: '#8C4A58' }}>
          Export CSV
        </button>
      </div>

      <div className="flex gap-2 mb-5">
        {ROLE_FILTERS.map(r => (
          <button key={r} onClick={() => setRole(r)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize font-medium ${
              roleFilter === r ? 'text-white' : 'bg-white border border-black/10 text-[#3D2E2E]/60'}`}
            style={roleFilter === r ? { backgroundColor: '#8C4A58' } : {}}>
            {r}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-black/5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Joined</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">City</th>
                <th className="text-left px-4 py-3">Social</th>
                <th className="text-left px-4 py-3">Consent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.01]">
                  <td className="px-4 py-3 text-[#3D2E2E]/50">{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 font-medium">{r.first_name}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/60">{r.email}</td>
                  <td className="px-4 py-3 capitalize">{r.role}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/60">{r.city ?? '—'}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/60">{r.social_handle ?? '—'}</td>
                  <td className="px-4 py-3">{badge(r.consent, 'Yes', 'No')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="text-center py-10 text-[#3D2E2E]/30 text-sm">No signups yet</div>
          )}
        </div>
      )}
    </div>
  )
}
