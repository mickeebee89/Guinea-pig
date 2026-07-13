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
}

function StatCard({ label, value, sub, href, accent }: {
  label: string
  value: string | number
  sub?: string
  href?: string
  accent?: boolean
}) {
  const card = (
    <div className={`rounded-xl p-5 shadow-sm bg-white border ${accent ? 'border-[#C8788A]/40' : 'border-black/5'}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-[#3D2E2E]/50 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${accent ? 'text-[#8C4A58]' : 'text-[#3D2E2E]'}`}>{value}</div>
      {sub && <div className="text-xs text-[#3D2E2E]/40 mt-1">{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block hover:opacity-90 transition-opacity">{card}</Link> : card
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const last7      = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [
        { count: openReports },
        { count: totalUsers },
        { count: totalProviders },
        { count: totalModels },
        { count: verifiedUsers },
        { count: fraudFlagged },
        { data: failedAll },
        { data: failedRecent },
        { data: revToday },
        { data: revWeek },
        { data: revMonth },
      ] = await Promise.all([
        supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('providers').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['model', 'both']),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_verified', true),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('fraud_flagged', true),
        supabase.from('verification_payments').select('amount').in('selfie_status', ['failed', 'locked']),
        supabase.from('verification_payments').select('amount').in('selfie_status', ['failed', 'locked']).gte('created_at', last7),
        supabase.from('verification_payments').select('amount').gte('created_at', todayStart),
        supabase.from('verification_payments').select('amount').gte('created_at', weekStart),
        supabase.from('verification_payments').select('amount').gte('created_at', monthStart),
      ])

      const sumPence = (rows: { amount: number }[] | null) =>
        (rows ?? []).reduce((a, r) => a + r.amount, 0)

      setStats({
        openReports:         openReports ?? 0,
        totalUsers:          totalUsers ?? 0,
        totalProviders:      totalProviders ?? 0,
        totalModels:         totalModels ?? 0,
        verifiedUsers:       verifiedUsers ?? 0,
        failedVerifications: (failedAll ?? []).length,
        failedLast7Days:     (failedRecent ?? []).length,
        fraudFlagged:        fraudFlagged ?? 0,
        revenueToday:        sumPence(revToday),
        revenueWeek:         sumPence(revWeek),
        revenueMonth:        sumPence(revMonth),
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
