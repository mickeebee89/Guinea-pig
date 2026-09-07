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

interface StatusPost {
  id: string
  body: string
  created_at: string
  expires_at: string
  moderation_status: string
  provider: { id: string; name: string | null } | null
  /**
   * Whole hours until expiry, computed WHEN THE QUEUE LOADS, not during render.
   *
   * Date.now() is impure, so calling it while rendering lets a re-render move
   * the number under the reader — and here that number is the whole reason to
   * act now rather than later. Third time this pattern came up in one session
   * (the web cancel panel and the mobile CancelSheet were the others), which is
   * why it is a field rather than a helper anyone can call from JSX.
   */
  hoursLeft: number
}

type Kind = 'images' | 'text' | 'status'

const KINDS: { key: Kind; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'status', label: 'Status posts' },
  { key: 'text',   label: 'Flagged text' },
]

export default function ModerationPage() {
  const [imageReview, setImageReview]   = useState(false)
  const [items, setItems]               = useState<PortfolioItem[]>([])
  const [flagged, setFlagged]           = useState<FlaggedContent[]>([])
  /**
   * -- EVERYTHING SHOWS BY DEFAULT; THE FILTER SUBTRACTS --------------------
   *
   * This was three tabs, and the default view was whichever one happened to be
   * first. A moderator opening the page saw one category. An empty tab reads as
   * "nothing to do" while another holds a queue, and nothing on the screen
   * prompts anyone to check the others -- the same shape as the
   * notification-type allowlist: correct for the cases present when it was
   * written, silent about the rest.
   *
   * So the honest view is the default one, and hiding a type is a deliberate
   * act. `hidden` rather than `shown` on purpose: a type added later is visible
   * unless somebody hides it, which is the safe direction for a queue.
   */
  const [hidden, setHidden]             = useState<Set<Kind>>(new Set())
  const [posts, setPosts]               = useState<StatusPost[]>([])
  // Same lesson as the text tab: without these, "still loading" and "the query
  // failed" both render as an empty queue, which is the one state a moderation
  // queue must never fake.
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsError, setPostsError]     = useState<string | null>(null)
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
      // ══════════════════════════════════════════════════════════════════
      //  THIS MATCHING IS ADVISORY. THE AUTHORITATIVE COPY IS IN THE DATABASE.
      // ══════════════════════════════════════════════════════════════════
      //
      // The same word list is matched in two places, on purpose:
      //
      //   public.screen_status_post()          migration 0032. AUTHORITATIVE.
      //     A BEFORE INSERT/UPDATE trigger on status_posts. Gates publication
      //     and cannot be bypassed — not even by calling PostgREST directly
      //     with an author's own token.
      //
      //   here                                  ADVISORY.
      //     A retrospective search over rows that are ALREADY PUBLISHED, run
      //     when a human opens this tab. It flags; it has never blocked
      //     anything and cannot.
      //
      // THE LIST ITSELF IS SINGLE-SOURCE — settings.banned_words, edited in
      // admin Settings. Only the matching is duplicated.
      //
      // If you change the semantics here, change 0032 too, and vice versa. They
      // must agree on: CASE-INSENSITIVE SUBSTRING, NO WORD BOUNDARIES. "cash"
      // matches "cashmere". A word that flags in one must flag in the other or
      // the queue and the search disagree about the same post.
      //
      // The implementations differ deliberately. This one builds a regex and so
      // must escape metacharacters — see below; a stray "(" once threw inside an
      // un-awaited call and left this tab silently empty. The trigger uses
      // strpos(), which takes no pattern at all, so that class of bug cannot
      // occur there. Copying this approach into SQL would have copied the hazard.
      //
      // Written in BOTH files on purpose: a note in one does not reach the
      // person editing the other, which is how location and location_text
      // drifted apart for months.
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

  async function loadStatusPosts() {
    setPostsLoading(true); setPostsError(null)
    // Held posts only. Expired ones are excluded: a post whose 48 hours have
    // run out cannot be published by approving it, so offering the button would
    // be offering an action with no effect.
    const { data, error } = await supabase
      .from('status_posts')
      .select('id, body, created_at, expires_at, moderation_status, provider:providers!provider_id(id, name)')
      .eq('moderation_status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
    setPostsLoading(false)
    if (error) { setPostsError(`Couldn't read the status queue: ${error.message}`); return }
    const now = Date.now()
    setPosts(((data as unknown as StatusPost[]) ?? []).map(p => ({
      ...p,
      hoursLeft: Math.max(0, Math.round((new Date(p.expires_at).getTime() - now) / 3_600_000)),
    })))
  }

  async function decidePost(post: StatusPost, decision: 'approved' | 'rejected', note: string) {
    // review_note is what the stylist is shown when a post is rejected, so a
    // rejection without one leaves them with "not published" and no reason —
    // the silent-failure shape this queue exists to remove.
    if (decision === 'rejected' && !note.trim()) {
      alert('A rejection needs a reason. The stylist is shown it, and "not published" with no explanation is why this queue exists.')
      return
    }
    const { error } = await supabase
      .from('status_posts')
      .update({
        moderation_status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        review_note: note.trim() || null,
      })
      .eq('id', post.id)
    if (error) {
      alert(`Couldn't ${decision === 'approved' ? 'approve' : 'reject'} this post: ${error.message}`)
      return
    }
    // ── TELL THEM, RATHER THAN LETTING IT EXPIRE ─────────────────────────
    //
    // A rejected post is visible to its author as 'rejected' (0031's RLS) but
    // only if they go and look. Without this they watch an update never appear
    // and learn nothing — the silent failure this queue was added to remove.
    //
    // ⚠️ THE NOTE MUST NOT QUOTE THE FLAGGED WORD. Telling someone which term
    // tripped the screen hands them the way around it, and the list is not
    // public. The composer's own note field says so; this only forwards what
    // the admin wrote.
    //
    // Approval is deliberately silent: the post simply appears, which is what
    // the stylist expected when they wrote it.
    if (decision === 'rejected' && post.provider?.id) {
      const { data: prov } = await supabase
        .from('providers').select('user_id').eq('id', post.provider.id).maybeSingle()
      const uid = (prov as { user_id?: string } | null)?.user_id
      if (uid) {
        const { error: noteErr } = await supabase.from('notifications').insert({
          user_id: uid,
          type: 'admin_message',
          title: 'Your update wasn\u2019t published',
          body: 'We didn\u2019t publish your recent shop update.'
            + (note.trim() ? '\n\n' + note.trim() : '')
            + '\n\nYou can post a new one from your dashboard.',
        })
        // Logged, not fatal: the decision has already been written and undoing
        // it because a notification failed would be worse than a quiet one.
        if (noteErr) console.error('[moderation] rejection notice failed', noteErr)
      }
    }

    await logAction(`status_post_${decision}`, {
      // undefined, not null: logAction takes an optional string, and a post with
      // no resolvable provider should omit the field rather than record a null.
      targetProviderId: post.provider?.id ?? undefined,
      details: { post_id: post.id, note: note.trim() || null },
    })
    await loadStatusPosts()
  }

  useEffect(() => { loadSettings(); loadItems(); loadFlagged(); loadStatusPosts() }, [])

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

  const counts: Record<Kind, number> = {
    images: items.length, text: flagged.length, status: posts.length,
  }
  const anyLoading   = loading || flaggedLoading || postsLoading
  const totalWaiting = counts.images + counts.text + counts.status
  const hiddenCount  = [...hidden].reduce((n, k) => n + counts[k], 0)
  const show = (k: Kind) => !hidden.has(k)
  const toggle = (k: Kind) => setHidden(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#3D2E2E]">Moderation Queue</h1>
          {/* The total is deliberately NOT filtered. It is the one number on
              this page that always answers "is there anything waiting", so
              hiding a type must not be able to change it. */}
          <p className="text-sm text-[#3D2E2E]/50">
            {anyLoading
              ? 'Counting the queues\u2026'
              : totalWaiting === 0
              ? 'Nothing waiting'
              : totalWaiting + ' item' + (totalWaiting === 1 ? '' : 's') + ' waiting across all types'}
          </p>
        </div>
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

      <div className="mb-6">
        <div className="flex flex-wrap gap-3">
          {KINDS.map(k => {
            const on = show(k.key)
            return (
              <button key={k.key} onClick={() => toggle(k.key)}
                aria-pressed={on}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  on ? 'text-white' : 'bg-white border border-black/10 text-[#3D2E2E]/40'
                }`}
                style={on ? { backgroundColor: '#8C4A58' } : {}}>
                {k.label} ({counts[k.key]}){on ? '' : ' - hidden'}
              </button>
            )
          })}
        </div>
        {hidden.size > 0 && (
          <p className="mt-2 text-sm text-amber-800">
            {hiddenCount === 0
              ? 'A filter is on. Nothing is hidden by it right now.'
              : 'A filter is on - ' + hiddenCount + ' item' + (hiddenCount === 1 ? '' : 's') + ' not shown.'}{' '}
            <button onClick={() => setHidden(new Set())} className="underline font-medium">
              Show everything
            </button>
          </p>
        )}
      </div>

      {show('images') && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#3D2E2E]/50">
            Images ({items.length})
          </h2>
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
        </section>
      )}

      {/* ── STATUS POSTS ────────────────────────────────────────────────────
          The queue that makes `pending` mean something. Without it, 0032's
          fail-closed default is fail-SILENT: a flagged post sits invisible
          until its 48 hours run out and the stylist is never told why.

          ⚠️ AUDIT ITEM 17. banned_words currently holds placeholder values
          including "hair", which flags nearly every legitimate post a hair
          stylist writes. Expect this queue to be full of ordinary posts until a
          real list is set. That is the list being wrong, not the screen. */}
      {show('status') && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#3D2E2E]/50">
            Status posts ({posts.length})
          </h2>
          <div className="space-y-3">
          {postsLoading ? (
            <div className="text-[#3D2E2E]/40 text-sm">Loading the queue…</div>
          ) : postsError ? (
            <div className="text-sm font-medium text-red-700">{postsError}</div>
          ) : posts.length === 0 ? (
            <div className="text-[#3D2E2E]/40 text-sm">
              Nothing held for review. Posts that pass the word screen publish
              immediately and never appear here.
            </div>
          ) : (
            posts.map(post => <StatusPostRow key={post.id} post={post} onDecide={decidePost} />)
          )}
          </div>
        </section>
      )}

      {show('text') && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#3D2E2E]/50">
            Flagged text ({flagged.length})
          </h2>
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
        </section>
      )}

      {hidden.size === KINDS.length && (
        <p className="text-sm text-[#3D2E2E]/50">
          Every type is filtered out. {totalWaiting} item{totalWaiting === 1 ? '' : 's'}{' '}
          {totalWaiting === 1 ? 'is' : 'are'} waiting and none are shown.
        </p>
      )}
    </div>
  )
}

/**
 * One held post, with the note field beside the buttons rather than behind a
 * prompt() — because a rejection without a reason is refused, and a field the
 * admin has to go looking for is a field that gets left empty.
 */
function StatusPostRow({
  post, onDecide,
}: {
  post: StatusPost
  onDecide: (p: StatusPost, d: 'approved' | 'rejected', note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (decision: 'approved' | 'rejected') => {
    setBusy(true)
    await onDecide(post, decision, note)
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-[#3D2E2E]">
          {post.provider?.name ?? 'Unknown stylist'}
        </div>
        {/* Time pressure is the whole point of a 48-hour post: an approval that
            lands after expiry publishes nothing. */}
        <div className={`text-xs ${post.hoursLeft <= 6 ? 'text-red-700 font-semibold' : 'text-[#3D2E2E]/40'}`}>
          {post.hoursLeft === 0 ? 'expires within the hour' : `${post.hoursLeft}h left`}
        </div>
      </div>

      {/* Rendered as text. The body has already had links stripped by trigger
          (0032), and nothing here parses it. */}
      <p className="mt-2 whitespace-pre-line text-sm text-[#3D2E2E]">{post.body}</p>

      <input
        value={note}
        onChange={e => setNote(e.target.value.slice(0, 280))}
        placeholder="Reason \u2014 sent to the stylist. Don\u2019t name the flagged word."
        className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
        disabled={busy}
      />

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => run('approved')}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#2F7A4F' }}
        >
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button
          onClick={() => run('rejected')}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
