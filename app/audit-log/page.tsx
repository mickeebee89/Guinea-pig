'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface AuditEntry {
  id: string
  action: string
  admin_note: string | null
  details: Record<string, unknown> | null
  created_at: string
  target_user: { first_name: string; last_initial: string | null; email: string } | null
  target_provider: { shop_handle: string } | null
}

const ACTION_COLORS: Record<string, string> = {
  warn:                  'bg-amber-100 text-amber-700',
  suspend:               'bg-orange-100 text-orange-700',
  ban:                   'bg-red-100 text-red-700',
  reinstate:             'bg-green-100 text-green-700',
  verify:                'bg-blue-100 text-blue-700',
  flag:                  'bg-gray-100 text-gray-600',
  report_warn:           'bg-amber-100 text-amber-700',
  report_suspend:        'bg-orange-100 text-orange-700',
  report_ban:            'bg-red-100 text-red-700',
  report_dismiss:        'bg-gray-100 text-gray-500',
  report_resolve:        'bg-green-100 text-green-700',
  image_approved:        'bg-green-100 text-green-700',
  image_rejected:        'bg-red-100 text-red-700',
  toggle_image_review:   'bg-purple-100 text-purple-700',
  admin_message_sent:    'bg-blue-100 text-blue-700',
  provider_suspend:      'bg-orange-100 text-orange-700',
  provider_ban:          'bg-red-100 text-red-700',
  provider_verify:       'bg-blue-100 text-blue-700',
  provider_remove_portfolio: 'bg-gray-100 text-gray-600',
  settings_update:       'bg-purple-100 text-purple-700',
  category_create:       'bg-teal-100 text-teal-700',
  category_update:       'bg-teal-100 text-teal-700',
  category_toggle:       'bg-teal-100 text-teal-700',
}

const ALL_ACTIONS = Object.keys(ACTION_COLORS)

export default function AuditLogPage() {
  const [entries, setEntries]     = useState<AuditEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [actionFilter, setAction] = useState('all')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [page, setPage]           = useState(0)
  const PAGE_SIZE = 50

  async function load() {
    setLoading(true)
    let q = supabase
      .from('admin_audit_log')
      .select(`id, action, admin_note, details, created_at,
        target_user:users!target_user_id(first_name, last_initial, email),
        target_provider:providers!target_provider_id(shop_handle)`)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (actionFilter !== 'all') q = q.eq('action', actionFilter)
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')

    const { data } = await q
    setEntries((data as unknown as AuditEntry[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [page, actionFilter, dateFrom, dateTo])

  const color = (action: string) =>
    ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-600'

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Audit Log</h1>
      <p className="text-sm text-[#3D2E2E]/50 mb-6">Read-only. Every admin action is recorded here permanently.</p>

      <div className="flex gap-3 mb-5 flex-wrap">
        <select value={actionFilter} onChange={e => { setAction(e.target.value); setPage(0) }}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="all">All actions</option>
          {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#3D2E2E]/50">From</label>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#3D2E2E]/50">To</label>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white" />
        </div>
        {(actionFilter !== 'all' || dateFrom || dateTo) && (
          <button onClick={() => { setAction('all'); setDateFrom(''); setDateTo(''); setPage(0) }}
            className="text-xs text-[#8C4A58] underline">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-black/5 shadow-sm overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Timestamp</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Target User</th>
                  <th className="text-left px-4 py-3">Target Shop</th>
                  <th className="text-left px-4 py-3">Note / Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.01]">
                    <td className="px-4 py-3 text-[#3D2E2E]/50 whitespace-nowrap text-xs">
                      {new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color(e.action)}`}>{e.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      {e.target_user ? (
                        <div>
                          <div className="font-medium">{e.target_user.first_name} {e.target_user.last_initial}.</div>
                          <div className="text-xs text-[#3D2E2E]/40">{e.target_user.email}</div>
                        </div>
                      ) : <span className="text-[#3D2E2E]/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#3D2E2E]/60">
                      {e.target_provider ? `@${e.target_provider.shop_handle}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#3D2E2E]/60 max-w-xs">
                      {e.admin_note && <div className="text-xs mb-1">{e.admin_note}</div>}
                      {e.details && (
                        <pre className="text-xs text-[#3D2E2E]/40 whitespace-pre-wrap break-all">
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && (
              <div className="text-center py-10 text-[#3D2E2E]/30 text-sm">No entries</div>
            )}
          </div>

          <div className="flex gap-3 items-center justify-between mt-4">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-4 py-2 text-sm rounded-lg bg-white border border-black/10 text-[#3D2E2E] disabled:opacity-40">
              ← Previous
            </button>
            <span className="text-xs text-[#3D2E2E]/40">Page {page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={entries.length < PAGE_SIZE}
              className="px-4 py-2 text-sm rounded-lg bg-white border border-black/10 text-[#3D2E2E] disabled:opacity-40">
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
