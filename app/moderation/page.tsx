'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'
import Image from 'next/image'

interface PortfolioItem {
  id: string
  media_url: string
  media_type: string
  moderation_status: string
  created_at: string
  provider: { id: string; shop_handle: string; user_id: string }
  category: { name: string }
}

interface FlaggedContent {
  id: string
  // Bios and shop text are PUBLIC profile copy — arguably more important to catch
  // than a private DM, since anyone browsing sees them.
  type: 'message' | 'review' | 'bio' | 'shop'
  body: string
  created_at: string
  matched_words: string[]
  user_id: string
  user_name: string
  user_email: string | null
}

export default function ModerationPage() {
  const [imageReview, setImageReview]   = useState(false)
  const [items, setItems]               = useState<PortfolioItem[]>([])
  const [flagged, setFlagged]           = useState<FlaggedContent[]>([])
  const [tab, setTab]                   = useState<'images' | 'text'>('images')
  const [loading, setLoading]           = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(true)
  // The text tab had neither a loading nor an error state, so "still scanning"
  // and "scan failed" both rendered as "No flagged content".
  const [flaggedLoading, setFlaggedLoading] = useState(true)
  const [flaggedError, setFlaggedError]     = useState<string | null>(null)

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('key, value').in('key', ['image_review_enabled', 'banned_words'])
    if (data) {
      const map = Object.fromEntries(data.map(r => [r.key, r.value]))
      setImageReview(map['image_review_enabled'] === 'true')
    }
    setSettingsLoading(false)
  }

  async function loadItems() {
    setLoading(true)
    const { data } = await supabase
      .from('portfolio_items')
      .select(`id, media_url, media_type, moderation_status, created_at,
        provider:providers!provider_id(id, shop_handle, user_id),
        category:treatment_categories!category_id(name)`)
      .eq('moderation_status', 'pending')
      .order('created_at')
    setItems((data as unknown as PortfolioItem[]) ?? [])
    setLoading(false)
  }

  async function loadFlagged() {
    setFlaggedLoading(true)
    setFlaggedError(null)
    try {
      // maybeSingle + a real error check. This used to be .single() with the error
      // discarded, so an unreadable settings row silently disabled the whole tab —
      // indistinguishable from "nothing matched".
      const { data: bannedRow, error: bannedErr } = await supabase
        .from('settings').select('value').eq('key', 'banned_words').maybeSingle()
      if (bannedErr) { setFlaggedError(`Couldn't read the banned-words list: ${bannedErr.message}`); return }

      let banned: string[] = []
      try { banned = JSON.parse(bannedRow?.value ?? '[]') } catch { banned = [] }
      banned = banned.map(w => w.trim()).filter(Boolean)
      if (!banned.length) { setFlagged([]); return }

      // Escape regex metacharacters — the list is user-entered, and one stray
      // "(" used to throw inside an un-awaited call and leave the tab empty forever.
      const pattern = banned.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      const re = () => new RegExp(`(${pattern})`, 'gi')  // fresh each use: /g regexes are stateful

      const [{ data: msgs }, { data: revs }, { data: bios }, { data: shops }] = await Promise.all([
        supabase.from('messages').select('id, body, created_at, sender_id, sender:users!sender_id(first_name, last_name, last_initial, email)').limit(500),
        supabase.from('reviews').select('id, comment, created_at, reviewer_id, reviewer:users!reviewer_id(first_name, last_name, last_initial, email)').limit(500),
        // Public profile copy — the gap this tab had: a banned word in a model's
        // bio was never flagged, even though everyone browsing can read it.
        supabase.from('model_attributes').select('user_id, bio').not('bio', 'is', null).limit(500),
        supabase.from('providers').select('id, user_id, name, bio, shop_handle').limit(500),
      ])

      // Bios/shops have no users embed (no FK alias to rely on), so resolve the
      // authors in one extra query, the same way the audit log does.
      const profileIds = [...new Set([
        ...((bios ?? []) as { user_id: string }[]).map(b => b.user_id),
        ...((shops ?? []) as { user_id: string }[]).map(s => s.user_id),
      ])].filter(Boolean)
      const userMap: Record<string, { first_name: string; last_name: string | null; last_initial: string | null; email: string | null }> = {}
      if (profileIds.length) {
        const { data: us } = await supabase
          .from('users').select('id, first_name, last_name, last_initial, email').in('id', profileIds)
        for (const u of (us ?? []) as any[]) userMap[u.id] = u
      }

      // Admin-only full identity: prefer the private full surname, fall back to the initial.
      // Tolerates null — an RLS-hidden author comes back as NULL, not an error.
      const fullName = (u: { first_name: string; last_name: string | null; last_initial: string | null } | null | undefined) =>
        u ? `${u.first_name} ${u.last_name ?? (u.last_initial ? `${u.last_initial}.` : '')}`.trim() : 'Not visible'

      const results: FlaggedContent[] = []
      const add = (
        id: string, type: FlaggedContent['type'], text: string | null,
        created_at: string, userId: string,
        u: { first_name: string; last_name: string | null; last_initial: string | null; email: string | null } | null | undefined,
      ) => {
        if (!text) return
        const matches = text.match(re())
        if (matches) results.push({
          id, type, body: text, created_at, matched_words: matches,
          user_id: userId, user_name: fullName(u), user_email: u?.email ?? null,
        })
      }

      for (const m of (msgs ?? []) as any[]) add(m.id, 'message', m.body, m.created_at, m.sender_id, m.sender)
      for (const r of (revs ?? []) as any[]) add(r.id, 'review', r.comment, r.created_at, r.reviewer_id, r.reviewer)
      for (const b of (bios ?? []) as any[]) {
        // model_attributes has no created_at we rely on — bios are current state.
        add(`bio-${b.user_id}`, 'bio', b.bio, new Date().toISOString(), b.user_id, userMap[b.user_id])
      }
      for (const s of (shops ?? []) as any[]) {
        add(`shop-name-${s.id}`, 'shop', s.name, new Date().toISOString(), s.user_id, userMap[s.user_id])
        add(`shop-bio-${s.id}`,  'shop', s.bio,  new Date().toISOString(), s.user_id, userMap[s.user_id])
      }

      setFlagged(results)
    } catch (e) {
      setFlaggedError(e instanceof Error ? e.message : 'Something went wrong scanning content.')
    } finally {
      setFlaggedLoading(false)
    }
  }

  useEffect(() => { loadSettings(); loadItems(); loadFlagged() }, [])

  async function toggleImageReview() {
    const next = !imageReview

    // Switching OFF publishes the whole pending queue in one statement. That is a
    // large, irreversible action hidden behind a toggle, so ask first and say how
    // many items it will publish. Count from the server, not items.length — the
    // grid only holds what the last load returned.
    let pendingCount = 0
    if (!next) {
      const { count, error: countErr } = await supabase
        .from('portfolio_items')
        .select('id', { count: 'exact', head: true })
        .eq('moderation_status', 'pending')
      if (countErr) {
        alert(`Couldn't check the pending queue: ${countErr.message}\n\nNothing has been changed.`)
        return
      }
      pendingCount = count ?? 0
      const ok = window.confirm(
        pendingCount > 0
          ? `Turn image review OFF?\n\nThis will immediately publish all ${pendingCount} image${pendingCount === 1 ? '' : 's'} waiting in the queue, without review. This cannot be undone.\n\nNew uploads will also go live automatically.`
          : `Turn image review OFF?\n\nThe queue is empty, so nothing will be published now. New uploads will go live automatically without review.`,
      )
      if (!ok) return
    }

    const { error: setErr } = await supabase
      .from('settings')
      .upsert({ key: 'image_review_enabled', value: String(next), updated_at: new Date().toISOString() })
    if (setErr) {
      alert(`Couldn't change the setting: ${setErr.message}`)
      return
    }
    await logAction('toggle_image_review', { details: { enabled: next } })
    setImageReview(next)

    if (!next && pendingCount > 0) {
      const { error: bulkErr } = await supabase
        .from('portfolio_items')
        .update({ moderation_status: 'approved' })
        .eq('moderation_status', 'pending')
      if (bulkErr) {
        alert(`Image review was turned off, but the queue could not be published: ${bulkErr.message}`)
      } else {
        // Audit the mass-approval in its own right — the toggle entry alone
        // doesn't record that N items were published.
        await logAction('image_bulk_approved', { details: { count: pendingCount, reason: 'image_review_disabled' } })
      }
      loadItems()
    }
  }

  async function decide(item: PortfolioItem, decision: 'approved' | 'rejected') {
    const { error } = await supabase
      .from('portfolio_items')
      .update({ moderation_status: decision })
      .eq('id', item.id)
    if (error) {
      // Previously the card was removed optimistically, so a rejected write left
      // the item pending in the DB while the admin believed the queue was cleared.
      alert(`Couldn't ${decision === 'approved' ? 'approve' : 'reject'} this item: ${error.message}`)
      return
    }
    await logAction(`image_${decision}`, { targetProviderId: item.provider?.id ?? null, details: { item_id: item.id } })
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Moderation Queue</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#3D2E2E]/60">Image review required</span>
          {settingsLoading ? (
            <div className="w-12 h-6 bg-gray-200 rounded-full animate-pulse" />
          ) : (
            <button onClick={toggleImageReview}
              className={`relative w-12 h-6 rounded-full transition-colors ${imageReview ? 'bg-[#8C4A58]' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${imageReview ? 'translate-x-6' : ''}`} />
            </button>
          )}
          <span className={`text-xs font-medium ${imageReview ? 'text-[#8C4A58]' : 'text-gray-400'}`}>
            {imageReview ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        {(['images', 'text'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              tab === t ? 'text-white' : 'bg-white border border-black/10 text-[#3D2E2E]/60'
            }`}
            style={tab === t ? { backgroundColor: '#8C4A58' } : {}}>
            {t === 'images' ? `Images (${items.length})` : `Flagged Text (${flagged.length})`}
          </button>
        ))}
      </div>

      {tab === 'images' && (
        <>
          {!imageReview && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-800">
              Image review is OFF — new uploads go live immediately without review.
            </div>
          )}
          {loading ? (
            <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-[#3D2E2E]/30 text-sm">Queue is empty</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {items.map(item => (
                <div key={item.id} className="bg-white rounded-xl border border-black/5 shadow-sm overflow-hidden">
                  <div className="relative aspect-square bg-gray-100">
                    {item.media_type === 'photo' ? (
                      <Image src={item.media_url} alt="" fill className="object-cover" unoptimized />
                    ) : (
                      <video src={item.media_url} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs text-[#3D2E2E]/60 mb-1">{item.provider?.shop_handle ?? 'Unknown shop'} · {item.category?.name ?? 'Uncategorised'}</div>
                    <div className="text-xs text-[#3D2E2E]/40 mb-3">{new Date(item.created_at).toLocaleDateString('en-GB')}</div>
                    <div className="flex gap-2">
                      <button onClick={() => decide(item, 'approved')}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700">
                        Approve
                      </button>
                      <button onClick={() => decide(item, 'rejected')}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-red-100 text-red-700">
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'text' && (
        <div className="space-y-3">
          {flaggedLoading ? (
            <div className="text-center py-16 text-[#3D2E2E]/40 text-sm">Scanning…</div>
          ) : flaggedError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <p className="font-medium mb-1">Couldn’t scan content</p>
              <p className="mb-3 text-red-600">{flaggedError}</p>
              <button onClick={loadFlagged} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium">Retry</button>
            </div>
          ) : flagged.length === 0 ? (
            <div className="text-center py-16 text-[#3D2E2E]/30 text-sm">No flagged content</div>
          ) : flagged.map(f => (
            <div key={f.id} className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                  f.type === 'message' ? 'bg-blue-100 text-blue-700'
                  : f.type === 'review' ? 'bg-purple-100 text-purple-700'
                  // Public profile copy — flag it more loudly than a private DM.
                  : 'bg-amber-100 text-amber-800'
                }`}>{f.type === 'shop' ? 'shop text' : f.type}</span>
                <span className="text-xs text-[#3D2E2E]/40">
                  {f.user_name}{f.user_email ? ` (${f.user_email})` : ''} · id {f.user_id.slice(0, 8)}
                  {['message', 'review'].includes(f.type) && ` · ${new Date(f.created_at).toLocaleDateString('en-GB')}`}
                </span>
              </div>
              <p className="text-sm text-[#3D2E2E] mb-2">{f.body}</p>
              <div className="flex gap-1 flex-wrap">
                {f.matched_words.map((w, i) => (
                  <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{w}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
