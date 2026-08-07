'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface UserResult {
  id: string
  first_name: string
  last_initial: string | null
  email: string
  role: string
  is_verified: boolean
}

interface SentMessage {
  id: string
  title: string
  body: string
  created_at: string
  user: { first_name: string; last_initial: string | null; email: string }
}

export default function MessagesPage() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<UserResult[]>([])
  const [selected, setSelected] = useState<UserResult | null>(null)
  const [title, setTitle]       = useState('')
  const [body, setBody]         = useState('')
  const [sending, setSending]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [log, setLog]           = useState<SentMessage[]>([])
  const [logLoading, setLogLoading] = useState(true)

  useEffect(() => {
    async function loadLog() {
      const { data } = await supabase
        .from('notifications')
        .select('id, title, body, created_at, user:users!user_id(first_name, last_initial, email)')
        .eq('type', 'admin_message')
        .order('created_at', { ascending: false })
        .limit(50)
      setLog((data as unknown as SentMessage[]) ?? [])
      setLogLoading(false)
    }
    loadLog()
  }, [sent])

  async function search() {
    if (!query.trim()) return
    const q = query.toLowerCase()
    const { data } = await supabase
      .from('users')
      .select('id, first_name, last_initial, email, role, is_verified')
      .or(`email.ilike.%${q}%,first_name.ilike.%${q}%`)
      .limit(10)
    setResults((data as UserResult[]) ?? [])
  }

  async function send() {
    if (!selected || !title.trim() || !body.trim()) return
    setSending(true)
    await supabase.from('notifications').insert({
      user_id: selected.id,
      type: 'admin_message',
      title: title.trim(),
      body: body.trim(),
    })
    await logAction('admin_message_sent', {
      targetUserId: selected.id,
      details: { title, body },
    })
    setSending(false)
    setSent(s => !s)
    setTitle('')
    setBody('')
    setSelected(null)
    setResults([])
    setQuery('')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Messages</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Compose */}
        <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5">
          <h2 className="font-semibold text-[#3D2E2E] mb-4">Send Message</h2>

          <div className="mb-4">
            <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Find user</label>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Name or email…"
                className="border border-black/10 rounded-lg px-3 py-2 text-sm flex-1 bg-white"
              />
              <button onClick={search} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ backgroundColor: '#8C4A58' }}>
                Search
              </button>
            </div>
            {results.length > 0 && (
              <div className="mt-2 border border-black/10 rounded-xl overflow-hidden">
                {results.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { setSelected(u); setResults([]) }}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-[#FAF7F4] border-b border-black/5 last:border-0 transition-colors ${
                      selected?.id === u.id ? 'bg-[#FAF7F4]' : ''
                    }`}
                  >
                    <div className="font-medium text-[#3D2E2E]">{u.first_name} {u.last_initial}.</div>
                    <div className="text-xs text-[#3D2E2E]/50">{u.email} · {u.role}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="mb-4 bg-[#FAF7F4] rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-[#3D2E2E]">{selected.first_name} {selected.last_initial}.</div>
                <div className="text-xs text-[#3D2E2E]/50">{selected.email}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#3D2E2E]/30 hover:text-[#3D2E2E] text-sm">✕</button>
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Message from Cavy"
              className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
          </div>
          <div className="mb-4">
            <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5}
              placeholder="Write your message…"
              className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
          </div>
          <button
            onClick={send}
            disabled={!selected || !title.trim() || !body.trim() || sending}
            className="w-full py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#8C4A58' }}>
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>

        {/* Notes */}
        <div className="bg-[#FAF7F4] rounded-xl border border-black/5 p-5">
          <h2 className="font-semibold text-[#3D2E2E] mb-3">How this works</h2>
          <ul className="space-y-2 text-sm text-[#3D2E2E]/70">
            <li>• Messages appear in the user's in-app notification inbox</li>
            <li>• Type is <code className="bg-black/5 px-1 rounded text-xs">admin_message</code></li>
            <li>• All sent messages are logged below and in the Audit Log</li>
            <li>• Users cannot reply to admin messages</li>
          </ul>
        </div>
      </div>

      {/* Log */}
      <h2 className="text-sm font-semibold text-[#3D2E2E]/40 uppercase tracking-widest mb-3">Sent Message Log</h2>
      {logLoading ? (
        <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-black/5 shadow-sm overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-[#3D2E2E]/50 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">To</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Body</th>
                <th className="text-left px-4 py-3">Sent</th>
              </tr>
            </thead>
            <tbody>
              {log.map(m => (
                <tr key={m.id} className="border-b border-black/5 last:border-0">
                  {/* Null when RLS hides the recipient — don't crash the table. */}
                  <td className="px-4 py-3 font-medium">
                    {m.user ? `${m.user.first_name} ${m.user.last_initial ?? ''}.` : <span className="italic text-[#3D2E2E]/30">Not visible</span>}
                  </td>
                  <td className="px-4 py-3">{m.title}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/60 max-w-xs truncate">{m.body}</td>
                  <td className="px-4 py-3 text-[#3D2E2E]/40 whitespace-nowrap">{new Date(m.created_at).toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.length === 0 && (
            <div className="text-center py-10 text-[#3D2E2E]/30 text-sm">No messages sent yet</div>
          )}
        </div>
      )}
    </div>
  )
}
