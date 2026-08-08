'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Stats {
  openReports: number
  totalUsers: number
  totalProviders: number
  totalModels: number
  verifiedUsers: number
  failedVerifications: number
  failedLast7Days: number
  fraudFlagged: number
  revenueToday: number
  revenueWeek: number
  revenueMonth: number
  /** Most recent NON-dry run of run_retention_purge, successful or not. */
  retentionLastRun: { ran_at: string; ok: boolean } | null
  retentionUnavailable: boolean
}

function StatCard({ label, value, sub, href, accent, alert }: {
  label: string
  value: string | number
  sub?: string
  href?: string
  accent?: boolean
  /** Something is wrong and needs acting on — louder than `accent`. */
  alert?: boolean
}) {
  const card = (
    <div className={`rounded-xl p-5 shadow-sm border ${
      alert  ? 'bg-red-50 border-red-300'
      : accent ? 'bg-white border-[#C8788A]/40'
      :          'bg-white border-black/5'}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-[#3D2E2E]/50 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${
        alert ? 'text-red-700' : accent ? 'text-[#8C4A58]' : 'text-[#3D2E2E]'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${alert ? 'text-red-700/70' : 'text-[#3D2E2E]/40'}`}>{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block hover:opacity-90 transition-opacity">{card}</Link> : card
}

/**
 * How the retention purge is doing.
 *
 * The job (migration 0005) enforces the retention periods promised on
 * cavybeauty.com/delete-account. If it silently stops, those promises quietly
 * become false and nothing else on this console would say so — the absence of
 * recent rows in retention_runs IS the alarm, and an alarm nobody queries is
 * not an alarm. Hence a tile.
 *
 * It runs monthly, so 40 days is "one run has been missed".
 */
function retentionState(lastRun: { ran_at: string; ok: boolean } | null, unavailable: boolean) {
  if (unavailable) return { value: '—',      sub: 'could not read retention_runs', alert: true }
  if (!lastRun)    return { value: 'Never',  sub: 'no completed run on record',    alert: true }

  const days = Math.floor((Date.now() - new Date(lastRun.ran_at).getTime()) / 86_400_000)
  if (!lastRun.ok) return { value: 'Failed', sub: `last attempt ${days}d ago`,     alert: true }
  return {
    value: `${days}d ago`,
    sub: 'runs monthly · 1st, 03:20 UTC',
    alert: days > 40,
  }
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [
        { count: openReports },
        { count: totalUsers },
        { count: totalProviders },
        { count: totalModels },
        { count: verifiedUsers },
        { count: fraudFlagged },
        { data: failedAll },
        { data: failedRecent },
        // Dry runs excluded on purpose: asking "what would this delete" is not
        // evidence that anything was deleted, and counting it would let a tile
        // stay green while the scheduled job was dead.
        { data: retentionRuns, error: retentionErr },
      ] = await Promise.all([
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('providers').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['model', 'both']),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_verified', true),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('fraud_flagged', true),
        supabase.from('verification_payments').select('amount').in('selfie_status', ['failed', 'locked']),
        supabase.from('verification_payments').select('amount').in('selfie_status', ['failed', 'locked']).gte('created_at', last7),
        supabase.from('retention_runs').select('ran_at, ok').eq('dry_run', false)
          .order('ran_at', { ascending: false }).limit(1),
      ])

      // Revenue from Stripe (source of truth) so the dashboard matches Stripe + the Revenue page.
      const { data: summary } = await supabase.functions.invoke('stripe-payment', {
        body: { action: 'revenue_summary' },
      })
      const v = (summary?.verifications ?? { today: 0, week: 0, month: 0 }) as { today: number; week: number; month: number }

      setStats({
        openReports:         openReports ?? 0,
        totalUsers:          totalUsers ?? 0,
        totalProviders:      totalProviders ?? 0,
        totalModels:         totalModels ?? 0,
        verifiedUsers:       verifiedUsers ?? 0,
        failedVerifications: (failedAll ?? []).length,
        failedLast7Days:     (failedRecent ?? []).length,
        fraudFlagged:        fraudFlagged ?? 0,
        revenueToday:        v.today,
        revenueWeek:         v.week,
        revenueMonth:        v.month,
        // A read error is NOT "never ran" — it usually means 0005 has not been
        // applied. Those need different words or the tile teaches you to
        // ignore it.
        retentionLastRun:      (retentionRuns ?? [])[0] ?? null,
        retentionUnavailable:  !!retentionErr,
      })
    }
    load()
  }, [])

  const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Dashboard</h1>

      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">Platform</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Users"  value={stats?.totalUsers     ?? '—'} />
          <StatCard label="Providers"    value={stats?.totalProviders ?? '—'} />
          <StatCard label="Models"       value={stats?.totalModels    ?? '—'} />
          <StatCard label="Verified"     value={stats?.verifiedUsers  ?? '—'} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">Alerts</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Open Reports"    value={stats?.openReports         ?? '—'} accent href="/reports" />
          <StatCard label="Fraud Flagged"   value={stats?.fraudFlagged        ?? '—'} accent href="/users" />
          <StatCard label="Failed Verif."   value={stats?.failedVerifications ?? '—'} sub="all time" />
          <StatCard label="Failed Verif."   value={stats?.failedLast7Days     ?? '—'} sub="last 7 days" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {(() => {
            if (!stats) return <StatCard label="Retention Purge" value="—" />
            const r = retentionState(stats.retentionLastRun, stats.retentionUnavailable)
            return <StatCard label="Retention Purge" value={r.value} sub={r.sub} alert={r.alert} />
          })()}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">Revenue (provider verifications)</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Today"       value={stats ? fmt(stats.revenueToday)  : '—'} />
          <StatCard label="This Week"   value={stats ? fmt(stats.revenueWeek)   : '—'} />
          <StatCard label="This Month"  value={stats ? fmt(stats.revenueMonth)  : '—'} />
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">Quick Links</h2>
        <div className="flex gap-3 flex-wrap">
          {[
            { href: '/reports',    label: 'Open Report Queue' },
            { href: '/moderation', label: 'Moderation Queue' },
            { href: '/users',      label: 'All Users' },
            { href: '/revenue',    label: 'Revenue Breakdown' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-80 transition-opacity"
              style={{ backgroundColor: '#8C4A58' }}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
