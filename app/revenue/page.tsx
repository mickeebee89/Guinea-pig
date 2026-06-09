'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface VerifTx {
  id: string
  amount: number
  currency_code: string
  selfie_status: string
  created_at: string
  retry_count: number
  user: { first_name: string; last_initial: string | null; email: string }
}

interface SubTx {
  id: string
  amount_pence: number
  currency_code: string
  status: string
  plan: string
  created_at: string
  current_period_end: string | null
  user: { first_name: string; last_initial: string | null; email: string }
}

interface Totals { today: number; week: number; month: number; allTime: number }

function fmt(pence: number) { return `£${(pence / 100).toFixed(2)}` }

function TotalsRow({ label, totals }: { label: string; totals: Totals }) {
  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5">
      <div className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">{label}</div>
      <div className="grid grid-cols-4 gap-4">
        {[['Today', totals.today], ['This Week', totals.week], ['This Month', totals.month], ['All Time', totals.allTime]].map(([l, v]) => (
          <div key={l as string}>
            <div className="text-xs text-[#3D2E2E]/50 mb-0.5">{l}</div>
            <div className="text-xl font-bold text-[#3D2E2E]">{fmt(v as number)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RevenuePage() {
  const [verif, setVerif]   = useState<VerifTx[]>([])
  const [subs, setSubs]     = useState<SubTx[]>([])
  const [loading, setLoading] = useState(true)

  const [verifTotals, setVerifTotals] = useState<Totals>({ today: 0, week: 0, month: 0, allTime: 0 })
  const [subTotals, setSubTotals]     = useState<Totals>({ today: 0, week: 0, month: 0, allTime: 0 })

  const [verifStats, setVerifStats] = useState({ total: 0, passed: 0, failed: 0, locked: 0 })

  useEffect(() => {
    async function load() {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const [{ data: vAll }, { data: sAll }] = await Promise.all([
        supabase.from('verification_payments')
          .select('id, amount, currency_code, selfie_status, created_at, retry_count, user:users!user_id(first_name, last_initial, email)')
          .order('created_at', { ascending: false }),
        supabase.from('subscriptions')
          .select('id, amount_pence, currency_code, status, plan, created_at, current_period_end, user:users!user_id(first_name, last_initial, email)')
          .order('created_at', { ascending: false }),
      ])

      const vRows = (vAll ?? []) as unknown as VerifTx[]
      const sRows = (sAll ?? []) as unknown as SubTx[]

      setVerif(vRows)
      setSubs(sRows)

      const sum = (rows: VerifTx[], since?: string) =>
        rows.filter(r => r.selfie_status === 'passed' && (!since || r.created_at >= since))
            .reduce((a, r) => a + r.amount, 0)
      const sumS = (rows: SubTx[], since?: string) =>
        rows.filter(r => !since || r.created_at >= since).reduce((a, r) => a + r.amount_pence, 0)

      setVerifTotals({
        today:   sum(vRows, todayStart),
        week:    sum(vRows, weekStart),
        month:   sum(vRows, monthStart),
        allTime: sum(vRows),
      })
      setSubTotals({
        today:   sumS(sRows, todayStart),
        week:    sumS(sRows, weekStart),
        month:   sumS(sRows, monthStart),
        allTime: sumS(sRows),
      })
      setVerifStats({
        total: vRows.length,
        passed: vRows.filter(v => v.selfie_status === 'passed').length,
        failed: vRows.filter(v => v.selfie_status === 'failed').length,
        locked: vRows.filter(v => v.selfie_status === 'locked').length,
      })
      setLoading(false)
    }
    load()
  }, [])

  function exportCSV() {
    const rows = [
      ['Type', 'User', 'Email', 'Amount', 'Status', 'Date'],
      ...verif.map(v => ['verification', `${v.user.first_name} ${v.user.last_initial ?? ''}.`, v.user.email, fmt(v.amount), v.selfie_status, new Date(v.created_at).toLocaleDateString('en-GB')]),
      ...subs.map(s => ['subscription', `${s.user.first_name} ${s.user.last_initial ?? ''}.`, s.user.email, fmt(s.amount_pence), s.status, new Date(s.created_at).toLocaleDateString('en-GB')]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `guinea-pig-revenue-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const statusColor = (s: string) =>
    s === 'passed' || s === 'active' ? 'bg-green-100 text-green-700' :
    s === 'failed' || s === 'locked' ? 'bg-red-100 text-red-700' :
    'bg-gray-100 text-gray-500'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Revenue</h1>
        <button onClick={exportCSV}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-80 transition-opacity"
          style={{ backgroundColor: '#8C4A58' }}>
          Export CSV
        </button>
      </div>

      {loading ? <div className="text-[#3D2E2E]/40 text-sm">Loading…</div> : (
        <div className="space-y-6">
          <TotalsRow label="Provider Verifications" totals={verifTotals} />
          <TotalsRow label="Model Subscriptions"   totals={subTotals} />

          {/* Verification funnel */}
          <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">Verification Funnel</div>
            <div className="grid grid-cols-4 gap-4">
              {[
                ['Total Attempts', verifStats.total, 'text-[#3D2E2E]'],
                ['Passed', verifStats.passed, 'text-green-600'],
                ['Failed', verifStats.failed, 'text-red-600'],
                ['Locked', verifStats.locked, 'text-orange-600'],
              ].map(([l, v, c]) => (
                <div key={l as string}>
                  <div className="text-xs text-[#3D2E2E]/50 mb-0.5">{l}</div>
                  <div className={`text-2xl font-bold ${c}`}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent transactions */}
          <div className="bg-white rounded-xl border border-black/5 shadow-sm overflow-auto">
            <div className="px-5 py-3 border-b border-black/5 text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40">
              Recent Transactions
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...verif.map(v => ({ type: 'verification', user: `${v.user.first_name} ${v.user.last_initial ?? ''}.`, amount: v.amount, status: v.selfie_status, date: v.created_at })),
                  ...subs.map(s =>  ({ type: 'subscription',  user: `${s.user.first_name} ${s.user.last_initial ?? ''}.`, amount: s.amount_pence, status: s.status, date: s.created_at })),
                ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 capitalize text-[#3D2E2E]/60">{r.type}</td>
                    <td className="px-4 py-3 font-medium">{r.user}</td>
                    <td className="px-4 py-3 font-medium">{fmt(r.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-[#3D2E2E]/50">{new Date(r.date).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
