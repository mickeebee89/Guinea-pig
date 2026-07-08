'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface VerificationRequest {
  id: string
  selfie_url: string
  status: string
  notes: string | null
  created_at: string
  user: {
    id: string
    first_name: string
    last_initial: string | null
    email: string
    role: string
    is_verified: boolean
  }
}

// Shown when there's no signed URL (missing image, or an old public-URL row).
const NO_PHOTO_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect fill="%23f5f0ed" width="144" height="144"/><text x="72" y="76" text-anchor="middle" fill="%239b8b86" font-size="14">No photo</text></svg>'

export default function VerificationQueuePage() {
  const [requests, setRequests]     = useState<VerificationRequest[]>([])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})   // selfie signed URLs, keyed by request id
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]     = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [notes, setNotes]       = useState<Record<string, string>>({})
  const [working, setWorking]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('verification_requests')
      .select('id, selfie_url, status, notes, created_at, user:users!user_id(id, first_name, last_initial, email, role, is_verified)')
      .eq('status', filter)
      .order('created_at', { ascending: false })
    if (error) console.error('verification requests load failed:', error)
    const rows = (data ?? []) as unknown as VerificationRequest[]
    setRequests(rows)

    // verification-selfies is a PRIVATE bucket. selfie_url now holds a storage path;
    // sign it for ~5 minutes so the <img> can load. Old test rows hold full public
    // URLs (not paths) → signing fails → they fall back to the "No photo" placeholder.
    const entries = await Promise.all(
      rows.map(async r => {
        if (!r.selfie_url) return [r.id, ''] as const
        const { data: signed } = await supabase.storage
          .from('verification-selfies')
          .createSignedUrl(r.selfie_url, 300)
        return [r.id, signed?.signedUrl ?? ''] as const
      }),
    )
    setSignedUrls(Object.fromEntries(entries))
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  async function approve(req: VerificationRequest) {
    setWorking(req.id)
    const note = notes[req.id] ?? ''
    // Update request status
    const { error: updateErr } = await supabase
      .from('verification_requests')
      .update({ status: 'approved', notes: note, reviewed_at: new Date().toISOString() })
      .eq('id', req.id)

    if (req.user.role === 'model') {
      // Models: verify immediately
      await supabase.from('users').update({ is_verified: true }).eq('id', req.user.id)
      await supabase.from('notifications').insert({
        user_id: req.user.id,
        type: 'verification',
        title: 'You\'re verified! ✅',
        body: 'Your Guinea Pig profile is now verified. Your badge is live!',
      })
    } else {
      // Providers: approval is the unlock (payment is now decoupled / pay-first).
      // Verify the user AND make their profile visible.
      await supabase.from('users').update({ is_verified: true }).eq('id', req.user.id)
      await supabase.from('providers').update({ is_published: true }).eq('user_id', req.user.id)
      await supabase.from('notifications').insert({
        user_id: req.user.id,
        type: 'verification',
        title: 'You\'re verified! 🎉',
        body: 'Your identity check passed — your verified badge and profile are now live.',
      })
    }
    // Audit only after the status update actually succeeded (admin_id stamped by logAction).
    if (!updateErr) {
      await logAction('verification_approve', {
        targetUserId: req.user.id,
        details: { request_id: req.id, role: req.user.role, outcome: 'approved' },
      })
    }
    setWorking(null)
    load()
  }

  async function reject(req: VerificationRequest) {
    setWorking(req.id)
    const note = notes[req.id] ?? ''
    const { error: updateErr } = await supabase
      .from('verification_requests')
      .update({ status: 'rejected', notes: note, reviewed_at: new Date().toISOString() })
      .eq('id', req.id)
    await supabase.from('notifications').insert({
      user_id: req.user.id,
      type: 'verification',
      title: 'Verification not approved',
      body: note
        ? `Your verification was not approved: ${note}`
        : 'Your verification was not approved. Please resubmit with a clearer photo.',
    })
    // Audit only after the status update actually succeeded (admin_id stamped by logAction).
    if (!updateErr) {
      await logAction('verification_reject', {
        targetUserId: req.user.id,
        details: { request_id: req.id, role: req.user.role, outcome: 'rejected', reason: note || null },
      })
    }
    setWorking(null)
    load()
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-2">Verification Queue</h1>
      <p className="text-sm text-[#3D2E2E]/50 mb-6">Review selfie verification requests from users.</p>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['pending', 'approved', 'rejected'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize border transition-colors ${
              filter === f
                ? 'bg-[#8C4A58] text-white border-[#8C4A58]'
                : 'bg-white text-[#3D2E2E]/60 border-black/10 hover:border-[#8C4A58]/40'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-black/5 p-10 text-center text-[#3D2E2E]/30 text-sm">
          No {filter} requests
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map(req => (
            <div key={req.id} className="bg-white rounded-xl border border-black/5 shadow-sm overflow-hidden">
              <div className="flex gap-6 p-5">
                {/* Selfie */}
                <div className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={signedUrls[req.id] || NO_PHOTO_SVG}
                    alt="Verification selfie"
                    className="w-36 h-36 object-cover rounded-xl border border-black/5"
                    onError={e => { (e.target as HTMLImageElement).src = NO_PHOTO_SVG }}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4 mb-1">
                    <div>
                      <span className="font-semibold text-[#3D2E2E]">
                        {req.user.first_name} {req.user.last_initial ? req.user.last_initial + '.' : ''}
                      </span>
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                        style={{ background: req.user.role === 'model' ? '#E8B5C220' : '#C8788A20', color: req.user.role === 'model' ? '#7B5EA7' : '#8C4A58' }}>
                        {req.user.role}
                      </span>
                      {req.user.is_verified && (
                        <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Already verified</span>
                      )}
                    </div>
                    <span className="text-xs text-[#3D2E2E]/40 shrink-0">{formatDate(req.created_at)}</span>
                  </div>
                  <p className="text-sm text-[#3D2E2E]/50 mb-3">{req.user.email}</p>

                  {req.user.role === 'provider' && filter === 'pending' && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                      Provider — approval will send payment notification (£14.99 required to activate badge)
                    </p>
                  )}

                  {req.notes && filter !== 'pending' && (
                    <p className="text-sm text-[#3D2E2E]/60 italic mb-3">Notes: {req.notes}</p>
                  )}

                  {filter === 'pending' && (
                    <>
                      <textarea
                        placeholder="Notes (optional — shown to user on rejection)"
                        value={notes[req.id] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [req.id]: e.target.value }))}
                        className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm resize-none mb-3"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => approve(req)}
                          disabled={working === req.id}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {working === req.id ? 'Working…' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => reject(req)}
                          disabled={working === req.id}
                          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
