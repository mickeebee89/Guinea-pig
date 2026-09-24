'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { adminErrorText, shopsNote } from '@/lib/adminActions'
import type { ActionResult } from '@/lib/adminActions'

interface Provider {
  id: string
  shop_handle: string
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
  // Distinguish "couldn't load" from "no providers" — an RLS-blocked read used to
  // render as an empty list, which reads as "you have no providers".
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [modal, setModal]           = useState<{ provider: Provider; action: string } | null>(null)
  const [reason, setReason]         = useState('')
  const [duration, setDuration]     = useState('7')

  const { loading, reload } = useLoader('', async stale => {
    setLoadError(null)
    // try/catch so a throw anywhere below can never leave the page stuck
    // showing "Loading…" with no way out — useLoader clears `loading` when this
    // function returns, however it returns.
    try {
      const { data, error } = await supabase
        .from('providers')
        .select(`id, shop_handle, region, location_text,
          user:users!user_id(id, first_name, last_initial, email, is_verified, fraud_flagged)`)
        .order('shop_handle')
      if (error) { if (!stale()) setLoadError(error.message); return }

      const enriched = await Promise.all((data as unknown as Provider[] ?? []).map(async (p) => {
        // A joined row hidden by RLS comes back as NULL, not an error — dereferencing
        // it here used to reject inside Promise.all and hang the page permanently.
        const revieweeId = p.user?.id
        const [{ count: sc }, { data: reviews }, { count: pc }] = await Promise.all([
          supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('provider_id', p.id),
          revieweeId
            ? supabase.from('reviews').select('overall_rating').eq('reviewee_id', revieweeId)
            : Promise.resolve({ data: [] as { overall_rating: number }[] }),
          supabase.from('portfolio_items').select('*', { count: 'exact', head: true }).eq('provider_id', p.id),
        ])
        const ratings = (reviews ?? []).map((r: { overall_rating: number }) => r.overall_rating)
        const avg = ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null
        return { ...p, session_count: sc ?? 0, avg_rating: avg, portfolio_count: pc ?? 0 }
      }))
      if (stale()) return
      setProviders(enriched)
    } catch (e) {
      if (stale()) return
      setLoadError(e instanceof Error ? e.message : 'Something went wrong loading providers.')
    }
  })

  const filtered = providers.filter(p =>
    !search ||
    p.shop_handle.toLowerCase().includes(search.toLowerCase()) ||
    (p.location_text ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.user?.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  /**
   * ── ONE CALL, AND IT TAKES THE PROVIDER RATHER THAN THE OWNER ─────────
   *
   * admin_act_on_provider (0039) resolves the owner from the provider row, so
   * this page no longer passes provider.user?.id — and no longer refuses when
   * that embed is null. The old pre-check treated an RLS-hidden owner as an
   * absent one; providers.user_id is NOT NULL, and the function reads it as
   * definer, so there is always an owner to act on.
   *
   *   * ⚠️ SUSPENSIONS REPLACE RATHER THAN STACK, the third and last copy of
   *     the defect item 29 named. This page inserted into suspensions without
   *     deleting first, exactly as reports did.
   *
   *   * VERIFY NOW REPORTS THE SHOPS, through the same _admin_apply_user_action
   *     and the same shopsNote as the users page. Verifying an owner whose shop
   *     cannot publish used to look identical to one whose shop went live.
   *
   *   * ⚠️ REMOVE IMAGES SAYS WHAT IT LEAVES BEHIND. It deletes portfolio_items
   *     ROWS; the files stay in the portfolio-photos bucket, because storage is
   *     deliberately outside the transaction (settled 8 Sep — a database
   *     function cannot delete from a bucket, and pretending it can inside a
   *     transaction is worse than saying so). The function returns every URL it
   *     orphaned and writes them into the audit row, which becomes the only
   *     record that those files exist. The alert states the count and where the
   *     list lives rather than pasting URLs into a dialog.
   *
   *   * logAction is gone; the function writes the row with the same
   *     provider_<action> labels the audit-log page already reads.
   */
  async function doAction() {
    if (!modal) return
    const { provider, action } = modal

    const { data, error } = await supabase.rpc('admin_act_on_provider', {
      p_provider_id:   provider.id,
      p_action:        action,
      p_reason:        reason.trim() || null,
      p_duration_days: action === 'suspend' ? Number(duration) : null,
    })

    if (error) {
      alert(`Could not ${action.replace('_', ' ')} this provider.\n\n${adminErrorText(error)}\n\nNothing has changed.`)
      return
    }

    const result = (data ?? {}) as ActionResult

    if (action === 'verify') {
      const note = shopsNote(result.shops ?? [])
      if (note) {
        alert(
          `The owner of @${provider.shop_handle} is verified, but that did not make their shop live.\n\n` +
          `${note}\n\nNothing needs re-doing — this is what the shop looks like now.`,
        )
      }
    }

    if (action === 'remove_portfolio') {
      const n = result.removed_count ?? 0
      alert(
        n === 0
          ? `@${provider.shop_handle} had no portfolio images to remove.`
          : `Removed ${n} portfolio image${n === 1 ? '' : 's'} from @${provider.shop_handle}.\n\n` +
            `The image FILES are still in the portfolio-photos bucket. This removes the rows that point ` +
            `at them, and nothing sweeps the bucket afterwards.\n\n` +
            `The ${n === 1 ? 'URL is' : `${n} URLs are`} recorded in the audit log under ` +
            `details.orphaned_media_urls — now the only record that those files are there.`,
      )
    }

    setModal(null)
    setReason('')
    reload()
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
      ) : loadError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-medium mb-1">Couldn’t load providers</p>
          <p className="mb-3 text-red-600">{loadError}</p>
          <button onClick={reload} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium">
            Retry
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-black/5 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Shop</th>
                <th className="text-left px-4 py-3">Owner</th>
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
                <tr key={p.id} className={`border-b border-black/5 last:border-0 hover:bg-black/[0.01] ${p.user?.fraud_flagged ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-medium">@{p.shop_handle}</td>
                  {/* p.user is null when RLS hides the owner's row — show that
                     plainly rather than crashing the table. */}
                  <td className="px-4 py-3 text-[#3D2E2E]/60">
                    {p.user ? `${p.user.first_name} ${p.user.last_initial ?? ''}.` : <span className="italic text-[#3D2E2E]/30">Not visible</span>}
                  </td>
                  <td className="px-4 py-3">{p.region}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.user?.is_verified ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.user ? (p.user.is_verified ? 'Yes' : 'No') : '—'}
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
            {['suspend','ban'].includes(modal.action) && (
              // What 0044 made these do to a stylist. Said before Confirm,
              // because it reaches other people: every model they're booked with.
              <p className="mb-4 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
                If this user is a stylist, their shop is hidden and their upcoming bookings are
                cancelled. Each model is told the stylist can’t take bookings at the moment, not
                why. Lifting the {modal.action === 'ban' ? 'ban' : 'suspension'} does not republish
                the shop — the stylist does that themselves.
              </p>
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
