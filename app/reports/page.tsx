'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface Report {
  id: string
  reason: string
  details: string | null
  status: string
  created_at: string
  session_id: string | null
  reporter: { id: string; first_name: string; last_initial: string | null; email: string }
  reported: { id: string; first_name: string; last_initial: string | null; email: string }
}

interface Message {
  id: string
  body: string
  created_at: string
  sender: { first_name: string; last_initial: string | null }
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [statusFilter, setStatusFilter] = useState('open')
  const [loading, setLoading] = useState(true)
  const [chat, setChat] = useState<{ report: Report; messages: Message[] } | null>(null)
  const [actionModal, setActionModal] = useState<{ report: Report; action: string } | null>(null)
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('7')

  async function load() {
    setLoading(true)
    let q = supabase
      .from('reports')
      .select(`id, reason, details, status, created_at, session_id,
        reporter:users!reporter_id(id, first_name, last_initial, email),
        reported:users!reported_id(id, first_name, last_initial, email)`)
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    const { data } = await q
    setReports((data as unknown as Report[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter])

  async function viewChat(report: Report) {
    if (!report.session_id) return
    const { data } = await supabase
      .from('messages')
      .select('id, body, created_at, sender:users!sender_id(first_name, last_initial)')
      .eq('session_id', report.session_id)
      .order('created_at')
    setChat({ report, messages: (data as unknown as Message[]) ?? [] })
  }

  async function doAction() {
    if (!actionModal) return
    const { report, action } = actionModal
    const reportedId = report.reported.id
    const now = new Date()

    if (action === 'warn') {
      await supabase.from('notifications').insert({
        user_id: reportedId, type: 'admin_warning',
        title: 'Warning from Guinea Pig', body: reason || 'You have received an official warning.',
      })
    }
    if (action === 'suspend') {
      const until = new Date(now.getTime() + parseInt(duration) * 24 * 60 * 60 * 1000)
      await supabase.from('suspensions').insert({ user_id: reportedId, suspended_until: until.toISOString(), banned: false, reason })
    }
    if (action === 'ban') {
      await supabase.from('suspensions').insert({ user_id: reportedId, banned: true, reason })
    }
    if (action === 'dismiss') {
      await supabase.from('reports').update({ status: 'dismissed' }).eq('id', report.id)
    }
    if (action === 'resolve') {
      await supabase.from('reports').update({ status: 'actioned', resolved_at: now.toISOString() }).eq('id', report.id)
    }

    await logAction(`report_${action}`, {
      targetUserId: reportedId,
      details: { report_id: report.id },
      adminNote: reason,
    })
    setActionModal(null)
    setReason('')
    load()
  }

  const statusColor = (s: string) =>
    s === 'open' ? 'bg-red-100 text-red-700' :
    s === 'actioned' ? 'bg-green-100 text-green-700' :
    'bg-gray-100 text-gray-500'

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Reports</h1>

      <div className="flex gap-3 mb-5">
        {['open', 'dismissed', 'actioned', 'all'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize font-medium transition-colors ${
              statusFilter === s ? 'text-white' : 'bg-white border border-black/10 text-[#3D2E2E]/60'
            }`}
            style={statusFilter === s ? { backgroundColor: '#8C4A58' } : {}}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {reports.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-black/5 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-xs text-[#3D2E2E]/40">{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                  </div>
                  <div className="text-sm mb-1">
                    <span className="font-medium text-[#3D2E2E]">{r.reporter.first_name} {r.reporter.last_initial}.</span>
                    <span className="text-[#3D2E2E]/50"> reported </span>
                    <span className="font-medium text-[#3D2E2E]">{r.reported.first_name} {r.reported.last_initial}.</span>
                  </div>
                  <div className="text-sm font-semibold text-[#8C4A58] mb-1">{r.reason}</div>
                  {r.details && <div className="text-sm text-[#3D2E2E]/60">{r.details}</div>}
                </div>
                <div className="flex gap-2 flex-wrap shrink-0">
                  {r.session_id && (
                    <button onClick={() => viewChat(r)}
                      className="text-xs px-2 py-1 rounded-md bg-blue-100 text-blue-700 font-medium">
                      View Chat
                    </button>
                  )}
                  {r.status === 'open' && (
                    <>
                      {['warn','suspend','ban','dismiss','resolve'].map(a => (
                        <button key={a} onClick={() => { setActionModal({ report: r, action: a }); setReason('') }}
                          className={`text-xs px-2 py-1 rounded-md font-medium capitalize ${
                            a === 'dismiss' ? 'bg-gray-100 text-gray-500' :
                            a === 'resolve' ? 'bg-green-100 text-green-700' :
                            a === 'ban'     ? 'bg-red-100 text-red-700' :
                            a === 'suspend' ? 'bg-orange-100 text-orange-700' :
                                              'bg-amber-100 text-amber-700'
                          }`}>{a}</button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <div className="text-center py-16 text-[#3D2E2E]/30 text-sm">No reports</div>
          )}
        </div>
      )}

      {/* Chat modal */}
      {chat && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[80vh]">
            <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
              <h2 className="font-bold text-[#3D2E2E]">Session Chat Thread</h2>
              <button onClick={() => setChat(null)} className="text-[#3D2E2E]/40 hover:text-[#3D2E2E]">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {chat.messages.map(m => (
                <div key={m.id} className="bg-[#FAF7F4] rounded-lg p-3">
                  <div className="text-xs text-[#3D2E2E]/50 mb-1">
                    {m.sender.first_name} {m.sender.last_initial}. · {new Date(m.created_at).toLocaleString('en-GB')}
                  </div>
                  <div className="text-sm text-[#3D2E2E]">{m.body}</div>
                </div>
              ))}
              {chat.messages.length === 0 && <div className="text-center text-[#3D2E2E]/30 text-sm py-8">No messages</div>}
            </div>
          </div>
        </div>
      )}

      {/* Action modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-[#3D2E2E] mb-1 capitalize">{actionModal.action}</h2>
            <p className="text-sm text-[#3D2E2E]/60 mb-4">
              Acting on: {actionModal.report.reported.first_name} {actionModal.report.reported.last_initial}.
            </p>
            {actionModal.action === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Duration (days)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
              </div>
            )}
            {['warn','suspend','ban'].includes(actionModal.action) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Reason / note</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600">Cancel</button>
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
