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
  type: 'message' | 'review'
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
    const { data: bannedRow } = await supabase.from('settings').select('value').eq('key', 'banned_words').single()
    let banned: string[] = []
    try { banned = JSON.parse(bannedRow?.value ?? '[]') } catch { banned = [] }
    if (!banned.length) { setFlagged([]); return }

    const pattern = banned.join('|')
    const re = new RegExp(`(${pattern})`, 'gi')

    const [{ data: msgs }, { data: revs }] = await Promise.all([
      supabase.from('messages').select('id, body, created_at, sender_id, sender:users!sender_id(first_name, last_name, last_initial, email)').limit(500),
      supabase.from('reviews').select('id, comment, created_at, reviewer_id, reviewer:users!reviewer_id(first_name, last_name, last_initial, email)').limit(500),
    ])

    // Admin-only full identity: prefer the private full surname, fall back to the initial.
    const fullName = (u: { first_name: string; last_name: string | null; last_initial: string | null }) =>
      `${u.first_name} ${u.last_name ?? (u.last_initial ? `${u.last_initial}.` : '')}`.trim()

    const results: FlaggedContent[] = []
    for (const m of (msgs ?? []) as unknown as { id: string; body: string; created_at: string; sender_id: string; sender: { first_name: string; last_name: string | null; last_initial: string | null; email: string | null } }[]) {
      const matches = m.body.match(re)
      if (matches) results.push({ id: m.id, type: 'message', body: m.body, created_at: m.created_at, matched_words: matches, user_id: m.sender_id, user_name: fullName(m.sender), user_email: m.sender.email })
    }
    for (const r of (revs ?? []) as unknown as { id: string; comment: string | null; created_at: string; reviewer_id: string; reviewer: { first_name: string; last_name: string | null; last_initial: string | null; email: string | null } }[]) {
      if (!r.comment) continue
      const matches = r.comment.match(re)
      if (matches) results.push({ id: r.id, type: 'review', body: r.comment, created_at: r.created_at, matched_words: matches, user_id: r.reviewer_id, user_name: fullName(r.reviewer), user_email: r.reviewer.email })
    }
    setFlagged(results)
  }

  useEffect(() => { loadSettings(); loadItems(); loadFlagged() }, [])

  async function toggleImageReview() {
    const next = !imageReview
    await supabase.from('settings').upsert({ key: 'image_review_enabled', value: String(next), updated_at: new Date().toISOString() })
    await logAction('toggle_image_review', { details: { enabled: next } })
    setImageReview(next)
    if (!next) {
      await supabase.from('portfolio_items').update({ moderation_status: 'approved' }).eq('moderation_status', 'pending')
      loadItems()
    }
  }

  async function decide(item: PortfolioItem, decision: 'approved' | 'rejected') {
    await supabase.from('portfolio_items').update({ moderation_status: decision }).eq('id', item.id)
    await logAction(`image_${decision}`, { targetProviderId: item.provider.id, details: { item_id: item.id } })
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
                    <div className="text-xs text-[#3D2E2E]/60 mb-1">{item.provider.shop_handle} · {item.category.name}</div>
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
          {flagged.length === 0 ? (
            <div className="text-center py-16 text-[#3D2E2E]/30 text-sm">No flagged content</div>
          ) : flagged.map(f => (
            <div key={f.id} className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                  f.type === 'message' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                }`}>{f.type}</span>
                <span className="text-xs text-[#3D2E2E]/40">
                  {f.user_name}{f.user_email ? ` (${f.user_email})` : ''} · id {f.user_id.slice(0, 8)} · {new Date(f.created_at).toLocaleDateString('en-GB')}
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
