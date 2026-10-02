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
  /** Selfies still held, with the clock that decides when each is overdue. */
  selfiesHeld: { created_at: string; reviewed_at: string | null }[]
  /** Most recent purge-selfies run that actually DELETED something. */
  lastSelfiePurge: { created_at: string; details: unknown } | null
  selfieUnavailable: boolean
  /** Most recent run of expire_past_applications(). */
  expiryLastRun: { ran_at: string; ok: boolean; expired: number } | null
  expiryUnavailable: boolean
  /** Most recent run of run_email_reconcile, successful or not. */
  reconcileLastRun: { ran_at: string; emailable: number; no_attempt: number } | null
  reconcileUnavailable: boolean
  /** Deleted accounts whose Stripe billing could not be settled. */
  billingOrphans: BillingOrphan[]
  billingOrphansUnavailable: boolean
}

/**
 * A deletion that could not stop the money.
 *
 * `details` holds the Stripe ids because the account is gone — there is no
 * user row left to join to, and the customer id is the only handle anyone has
 * to go and cancel it by hand in the Stripe dashboard.
 */
interface BillingOrphan {
  created_at: string
  details: {
    user_id?: string
    stripe_customer_id?: string | null
    stripe_subscription_id?: string | null
    cancelled?: string[]
    warnings?: string[]
  } | null
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

/**
 * How the email reconciler is doing.
 *
 * ⚠️ THIS TILE EXISTS BECAUSE THE JOB FAILED NIGHTLY FOR NINE DAYS AND NOTHING
 * SAID SO (item 136). run_email_reconcile raised 42P01 on every run from 22 Sep
 * to 1 Oct — eight consecutive failures recorded in cron.job_run_details, a
 * table nothing reads — while email_reconcile_runs sat empty. That emptiness
 * was the designed alarm, exactly as it is for retention_runs above, and the
 * difference was simply that retention_runs had a tile and this did not.
 *
 * An alarm nobody can see is not an alarm. That sentence was already written,
 * eleven lines up, about the other table.
 *
 * ── IT ALSO REPORTS WHAT THE JOB FINDS, NOT JUST THAT IT RAN ──
 * no_attempt > 0 means a notification that should have been emailed never
 * reached the send function — the failure that leaves no trace in email_sends
 * and is the entire reason this job exists. A tile that only said "it ran"
 * would repeat the original mistake one level in: the monitor working, and
 * nobody reading its finding.
 *
 * It runs daily, so 2 days is "a run has been missed".
 */
function reconcileState(
  lastRun: { ran_at: string; emailable: number; no_attempt: number } | null,
  unavailable: boolean,
) {
  if (unavailable) return { value: '—',     sub: 'could not read email_reconcile_runs', alert: true }
  if (!lastRun)    return { value: 'Never', sub: 'no run on record',                    alert: true }

  const days = Math.floor((Date.now() - new Date(lastRun.ran_at).getTime()) / 86_400_000)
  if (lastRun.no_attempt > 0) {
    return {
      value: `${lastRun.no_attempt} unsent`,
      sub: `never reached the mailer · ${days}d ago`,
      alert: true,
    }
  }
  return {
    value: `${days}d ago`,
    sub: `runs daily · 04:10 UTC · ${lastRun.emailable} checked`,
    alert: days > 2,
  }
}

/** The published retention period for identity selfies. legal.ts says 90 days. */
const SELFIE_RETAIN_DAYS = 90

/**
 * Whether the selfie retention promise is being kept.
 *
 * ⚠️ THE ALARM IS "SOMETHING IS OVERDUE AND NOTHING DELETED IT", NOT "NO
 * RECENT RUNS". purge-selfies writes an admin_audit_log row ONLY when it
 * actually purges something; a run with nothing to delete writes nothing at
 * all. So an empty log is the NORMAL state, and a tile that went red on it
 * would cry wolf every night and be ignored by the time it mattered.
 *
 * What matters is the gap between the policy and the data: a selfie older than
 * 90 days that is still held. That is the thing cavybeauty.com/privacy promises
 * will not exist, and it is special-category data.
 *
 * ── WHY THIS TILE EXISTS ──
 * The purge has run nightly since 22 Sep and has never had anything to delete:
 * the oldest selfie dates from 8 July, so the first crosses 90 days on
 * 6 October 2026. The first real deletion this system will ever perform happens
 * then, and until now no screen would have shown whether it worked. The
 * evidence was being written to admin_audit_log and read by nobody.
 */
function selfieState(
  held: { created_at: string; reviewed_at: string | null }[],
  lastPurge: { created_at: string; details: unknown } | null,
  unavailable: boolean,
) {
  if (unavailable) return { value: '\u2014', sub: 'could not read verification_requests', alert: true }

  // The clock runs from the decision, or from arrival if it was never decided.
  const dueAt = (r: { created_at: string; reviewed_at: string | null }) =>
    new Date(r.reviewed_at ?? r.created_at).getTime() + SELFIE_RETAIN_DAYS * 86_400_000
  const overdue = held.filter(r => dueAt(r) < Date.now())

  const purged = (lastPurge?.details as { purged?: number } | null)?.purged
  const purgedAgo = lastPurge
    ? Math.floor((Date.now() - new Date(lastPurge.created_at).getTime()) / 86_400_000)
    : null

  if (overdue.length > 0) {
    return {
      value: `${overdue.length} overdue`,
      sub: lastPurge
        ? `past 90 days and still held · last purge ${purgedAgo}d ago`
        : 'past 90 days and still held · nothing has ever been purged',
      alert: true,
    }
  }
  if (lastPurge) {
    return {
      value: `${purged ?? '?'} purged`,
      sub: `${purgedAgo}d ago · ${held.length} held, none overdue`,
      alert: false,
    }
  }
  const next = held.length > 0 ? Math.min(...held.map(dueAt)) : null
  return {
    value: 'Nothing due',
    sub: next
      ? `${held.length} held · oldest due ${new Date(next).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      : 'no selfies held',
    alert: false,
  }
}

/**
 * Whether applications nobody answered are still being expired.
 *
 * Same contract as the retention and reconcile tiles: the absence of recent
 * rows is the alarm. Added alongside the selfie tile because session_expiry_runs
 * was built with that contract three days earlier and given no screen — the
 * same omission, by the same hand, that left the email reconciler failing unseen
 * for nine days.
 *
 * Runs daily, so 2 days is a missed run. `expired: 0` is a perfectly good night:
 * it means nothing lapsed, not that nothing happened.
 */
function expiryState(
  lastRun: { ran_at: string; ok: boolean; expired: number } | null,
  unavailable: boolean,
) {
  if (unavailable) return { value: '\u2014', sub: 'could not read session_expiry_runs', alert: true }
  if (!lastRun)    return { value: 'Never',   sub: 'no run on record',                   alert: true }

  const days = Math.floor((Date.now() - new Date(lastRun.ran_at).getTime()) / 86_400_000)
  if (!lastRun.ok) return { value: 'Failed',  sub: `last attempt ${days}d ago`,           alert: true }
  return {
    value: `${days}d ago`,
    sub: `runs daily · 03:40 UTC · ${lastRun.expired} expired`,
    alert: days > 2,
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
        { data: selfiesHeldRows, error: selfieErr },
        { data: selfiePurges },
        { data: expiryRuns, error: expiryErr },
        { data: reconcileRuns, error: reconcileErr },
        { data: billingOrphans, error: billingOrphansErr },
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
        // Every run counts here, unlike retention_runs above: this job has no
        // dry-run mode, and a run that found something is the interesting one.
        // Every selfie still held. A tiny set by design — one at the time this
        // tile was written — so the 90-day arithmetic happens in selfieState
        // rather than in a filter PostgREST cannot express (coalesce of two
        // columns against now()).
        supabase.from('verification_requests').select('created_at, reviewed_at')
          .not('selfie_url', 'is', null),
        // Only a run that DELETED something writes this row, so its absence is
        // the normal state and is never treated as a failure. See selfieState.
        supabase.from('admin_audit_log').select('created_at, details')
          .eq('action', 'selfie_retention_purge')
          .order('created_at', { ascending: false }).limit(1),
        supabase.from('session_expiry_runs').select('ran_at, ok, expired')
          .order('ran_at', { ascending: false }).limit(1),
        supabase.from('email_reconcile_runs').select('ran_at, emailable, no_attempt')
          .order('ran_at', { ascending: false }).limit(1),
        // ⚠️ BILLING ORPHANS. When someone deletes their account and Stripe
        // could not be settled — a failed cancel, or Stripe unreachable — the
        // edge function records a row here and CARRIES ON, because a payment
        // provider being down is not a lawful reason to refuse an erasure.
        //
        // That row is the only trace. The account is gone, so there is no user
        // to notice, no email to reply to, and nobody being charged who can
        // tell us. Until this tile existed the record was write-only, which is
        // the same as not keeping it.
        supabase.from('admin_audit_log')
          .select('created_at, details')
          .eq('action', 'billing_orphan_on_delete')
          .order('created_at', { ascending: false })
          .limit(20),
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
        selfiesHeld:           (selfiesHeldRows ?? []) as Stats['selfiesHeld'],
        lastSelfiePurge:       (selfiePurges ?? [])[0] ?? null,
        selfieUnavailable:     !!selfieErr,
        expiryLastRun:         (expiryRuns ?? [])[0] ?? null,
        expiryUnavailable:     !!expiryErr,
        reconcileLastRun:      (reconcileRuns ?? [])[0] ?? null,
        reconcileUnavailable:  !!reconcileErr,
        billingOrphans:        (billingOrphans ?? []) as BillingOrphan[],
        billingOrphansUnavailable: !!billingOrphansErr,
      })
    }
    load()
  }, [])

  const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Dashboard</h1>

      {/* ── BILLING ORPHANS ──────────────────────────────────────────────
          Someone deleted their account and Stripe was not settled. Nobody else
          will ever report this: the account is gone, so the person being
          charged has no way to tell us and we have no way to tell them. It is
          shown whenever there is one, and hidden entirely when there are none,
          because a permanent "0" trains the eye to skip it. */}
      {stats && (stats.billingOrphansUnavailable || stats.billingOrphans.length > 0) && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#3D2E2E]/40 mb-3">
            Billing to cancel by hand
          </h2>
          {stats.billingOrphansUnavailable ? (
            <p className="rounded-lg border border-[#C23A71]/30 bg-white p-4 text-sm text-[#3D2E2E]">
              Could not read admin_audit_log, so it is unknown whether any deleted account is
              still being charged.
            </p>
          ) : (
            <div className="rounded-lg border border-[#C23A71]/30 bg-white p-4">
              <p className="text-sm text-[#3D2E2E]">
                <strong>{stats.billingOrphans.length}</strong> deleted account
                {stats.billingOrphans.length === 1 ? '' : 's'} whose Stripe subscription could not
                be cancelled. Cancel each in the Stripe dashboard — the person has no account left
                and cannot do it themselves.
              </p>
              <ul className="mt-3 space-y-2 text-xs font-mono text-[#3D2E2E]/80">
                {stats.billingOrphans.map((o, i) => (
                  <li key={`${o.created_at}-${i}`} className="border-t border-[#3D2E2E]/10 pt-2">
                    <span className="text-[#3D2E2E]/50">
                      {new Date(o.created_at).toLocaleString('en-GB')}
                    </span>{' '}
                    customer {o.details?.stripe_customer_id ?? '—'}
                    {o.details?.stripe_subscription_id
                      ? ` · subscription ${o.details.stripe_subscription_id}`
                      : ' · no subscription id on file'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

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
          {(() => {
            if (!stats) return <StatCard label="Email Reconcile" value="—" />
            const r = reconcileState(stats.reconcileLastRun, stats.reconcileUnavailable)
            return <StatCard label="Email Reconcile" value={r.value} sub={r.sub} alert={r.alert} />
          })()}
          {(() => {
            if (!stats) return <StatCard label="Selfie Purge" value="—" />
            const r = selfieState(stats.selfiesHeld, stats.lastSelfiePurge, stats.selfieUnavailable)
            return <StatCard label="Selfie Purge" value={r.value} sub={r.sub} alert={r.alert} />
          })()}
          {(() => {
            if (!stats) return <StatCard label="Application Expiry" value="—" />
            const r = expiryState(stats.expiryLastRun, stats.expiryUnavailable)
            return <StatCard label="Application Expiry" value={r.value} sub={r.sub} alert={r.alert} />
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
