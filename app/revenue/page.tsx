'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Revenue is computed from Stripe (source of truth), returned by the
// stripe-payment `revenue_summary` action — see supabase/functions/stripe-payment.
interface RecentTx {
  type: string
  amountPence: number
  created: number   // unix seconds
  email: string | null
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
  const [recent, setRecent] = useState<RecentTx[]>([])
  const [loading, setLoading] = useState(true)

  const [verifTotals, setVerifTotals] = useState<Totals>({ today: 0, week: 0, month: 0, allTime: 0 })
  const [subTotals, setSubTotals]     = useState<Totals>({ today: 0, week: 0, month: 0, allTime: 0 })

  const [verifStats, setVerifStats] = useState({ total: 0, passed: 0, failed: 0, locked: 0 })

  useEffect(() => {
    async function load() {
      // Totals come straight from Stripe (the source of truth) so they match the
      // Stripe dashboard exactly — incl. renewals, resubscribes and refunds.
      const { data: summary, error } = await supabase.functions.invoke('stripe-payment', {
        body: { action: 'revenue_summary' },
      })
      if (!error && summary) {
        setVerifTotals(summary.verifications)
        setSubTotals(summary.subscriptions)
        setRecent((summary.recent ?? []) as RecentTx[])
      }

      // Verification funnel (attempt outcomes) is independent of revenue — from our DB.
      const { data: vp } = await supabase.from('verification_payments').select('selfie_status')
      const rows = (vp ?? []) as { selfie_status: string }[]
      setVerifStats({
        total:  (summary?.verifications?.count ?? rows.length),
        passed: rows.filter(r => r.selfie_status === 'passed').length,
        failed: rows.filter(r => r.selfie_status === 'failed').length,
        locked: rows.filter(r => r.selfie_status === 'locked').length,
      })
      setLoading(false)
    }
    load()
  }, [])

  function exportCSV() {
    const rows = [
      ['Type', 'Email', 'Amount', 'Date'],
      ...recent.map(r => [r.type, r.email ?? '', fmt(r.amountPence), new Date(r.created * 1000).toLocaleDateString('en-GB')]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `guinea-pig-revenue-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

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
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3 capitalize text-[#3D2E2E]/60">{r.type}</td>
                    <td className="px-4 py-3 text-[#3D2E2E]/60">{r.email ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{fmt(r.amountPence)}</td>
                    <td className="px-4 py-3 text-[#3D2E2E]/50">{new Date(r.created * 1000).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-[#3D2E2E]/30 text-sm">No transactions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
