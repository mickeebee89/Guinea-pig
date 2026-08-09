'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { markThreadRead, type Thread, type ThreadMessage } from '@/lib/queries/thread'
import { Avatar, StatusPill } from '@/components/ui'

/**
 * The realtime half of a conversation.
 *
 * This is the ONLY place the browser client is used, which is what makes the
 * claim in lib/supabase-browser.ts checkable rather than asserted: everything
 * else on the site renders on the server.
 *
 * Ported from mobile/src/app/(app)/chat/[sessionId].tsx. The state rules, the
 * block cascade and the "never mention blocking" notification wording are all
 * mobile's, reproduced deliberately — see the notes at each.
 */
export function ChatThread({ thread, userId }: { thread: Thread; userId: string }) {
  const supabase = getSupabaseBrowser()
  const router = useRouter()

  const [messages, setMessages] = useState<ThreadMessage[]>(thread.messages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'block' | 'report'>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const sessionId = thread.session.id
  const otherUserId = thread.otherParty.userId

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  // Mark read once the thread is actually on screen. Deliberately not done in
  // the server component: that would mark a conversation read on a prefetch
  // nobody looked at.
  useEffect(() => {
    if (thread.messages.some(m => !m.read_at && m.sender_id !== userId)) {
      markThreadRead(supabase, sessionId, userId).catch(e =>
        console.error('[chat] mark read failed', e),
      )
    }
    // Once per thread. Re-running on every message would fight the realtime
    // handler, which marks incoming messages read as they arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Realtime. Mobile subscribes on accepted only, so this does too — a locked
  // session has nothing arriving.
  useEffect(() => {
    if (!thread.isLive) return

    const channel = supabase
      .channel(`chat-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload: { new: ThreadMessage }) => {
          const incoming = payload.new
          // The sender already has it optimistically; without this guard their
          // own message appears twice.
          setMessages(prev => (prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]))
          if (incoming.sender_id !== userId) {
            supabase.from('messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', incoming.id)
              .then(() => {})
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload: { new: ThreadMessage }) => {
          const updated = payload.new
          setMessages(prev => prev.map(m => (m.id === updated.id ? updated : m)))
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, sessionId, userId, thread.isLive])

  const send = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    setText('')

    const { error } = await supabase.from('messages').insert({
      session_id: sessionId, sender_id: userId, body,
    })
    if (error) {
      setText(body)   // restore rather than lose what they typed
      // The RESTRICTIVE policies refuse a send from a blocked or suspended
      // user. Say something true without guessing which one fired.
      setSendError('That didn’t send. Reload the page and try again.')
      console.error('[chat] send failed', error)
    }
    setSending(false)
  }, [supabase, sessionId, userId, text, sending])

  /**
   * Block, with the cascade. Ported from chat/[sessionId].tsx:316-371.
   *
   * The cascade is the point: cancelling live bookings between the pair. Leaving
   * them booked in while they can no longer message each other is the one
   * outcome blocking exists to prevent — they would still be expected to meet.
   */
  const block = useCallback(async () => {
    if (!otherUserId || busy) return
    setBusy('block')
    try {
      const { error } = await supabase.from('blocks')
        .insert({ blocker_id: userId, blocked_id: otherUserId })
      // 23505 = already blocked. That is the desired end state, not a failure.
      if (error && error.code !== '23505') throw error

      const { data: provRows } = await supabase.from('providers')
        .select('id, user_id').in('user_id', [userId, otherUserId])
      type ProvRow = { id: string; user_id: string }
      const rows = (provRows ?? []) as ProvRow[]
      const mine   = rows.find(p => p.user_id === userId)?.id
      const theirs = rows.find(p => p.user_id === otherUserId)?.id

      const orParts: string[] = []
      if (mine)   orParts.push(`and(model_user_id.eq.${otherUserId},provider_id.eq.${mine})`)
      if (theirs) orParts.push(`and(model_user_id.eq.${userId},provider_id.eq.${theirs})`)

      if (orParts.length > 0) {
        const { data: pair } = await supabase.from('sessions')
          .select('id').in('status', ['pending', 'accepted']).or(orParts.join(','))
        const ids = ((pair ?? []) as { id: string }[]).map(r => r.id)
        if (ids.length > 0) {
          const { error: cancelErr } = await supabase.from('sessions')
            .update({ status: 'cancelled' }).in('id', ids)
          if (cancelErr) throw cancelErr
          // Never mentions blocking — the other party is told their booking is
          // cancelled, not that they were blocked.
          await supabase.from('notifications').insert(ids.map(sid => ({
            user_id: otherUserId,
            type: 'session_cancelled',
            title: 'Booking cancelled',
            body: 'Your upcoming treatment has been cancelled.',
            session_id: sid,
          })))
        }
      }
      router.refresh()
    } catch (e) {
      console.error('[chat] block failed', e)
      setNotice('We couldn’t complete that. Nothing has changed — please try again.')
    } finally {
      setBusy(null)
    }
  }, [supabase, router, userId, otherUserId, busy])

  const report = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otherUserId || !reportReason.trim() || busy) return
    setBusy('report')
    const { error } = await supabase.from('reports').insert({
      reporter_id: userId,
      reported_id: otherUserId,
      session_id: sessionId,
      reason: reportReason.trim(),
    })
    setBusy(null)
    if (error) {
      console.error('[chat] report failed', error)
      setNotice('We couldn’t send that report. Please try again.')
      return
    }
    setReportOpen(false)
    setReportReason('')
    setNotice('Thanks — we’ve received your report and someone will look at it.')
  }, [supabase, userId, otherUserId, sessionId, reportReason, busy])

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/messages" className="text-sm font-bold text-rose hover:underline">← Messages</Link>
      </div>

      <header className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-white p-4">
        <Avatar src={thread.otherParty.picUrl} name={thread.otherParty.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-warm-dark">{thread.otherParty.name}</p>
          <p className="text-xs text-muted">
            {new Date(thread.session.date + 'T00:00:00').toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
            {thread.treatmentCategory && ` · ${thread.treatmentCategory}`}
          </p>
        </div>
        <StatusPill status={thread.session.status} />
      </header>

      {notice && (
        <p role="status" className="mb-3 rounded-md border border-hairline bg-input-bg px-3 py-2 text-sm text-warm-dark">
          {notice}
        </p>
      )}

      <ol className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-hairline bg-white p-4">
        {messages.length === 0 && (
          <li className="py-10 text-center text-sm text-muted">No messages yet. Say hello.</li>
        )}
        {messages.map(m => {
          const mine = m.sender_id === userId
          return (
            <li key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  mine ? 'bg-rose text-white' : 'bg-input-bg text-warm-dark'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-1 text-[11px] ${mine ? 'text-white/70' : 'text-muted'}`}>
                  {new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </li>
          )
        })}
        <div ref={bottomRef} />
      </ol>

      {thread.isBlocked ? (
        <p className="mt-3 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          You can’t message this person. You can unblock them from settings in the app.
        </p>
      ) : thread.canSend ? (
        <form onSubmit={send} className="mt-3 flex items-end gap-2">
          <label htmlFor="msg" className="sr-only">Message</label>
          <textarea
            id="msg"
            value={text}
            onChange={e => setText(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Type a message…"
            className="min-h-11 flex-1 resize-none rounded-md border border-hairline bg-white px-3 py-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white transition-colors hover:bg-rose-dark disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : (
        <p className="mt-3 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          {thread.session.status === 'completed'
            ? 'This treatment is finished, so the conversation is read-only.'
            : 'You’ll be able to message once this booking is confirmed.'}
        </p>
      )}

      {sendError && <p role="alert" className="mt-2 text-sm text-danger">{sendError}</p>}

      {/* Safety controls. Present whatever the session status — being unable to
          message someone is not the same as being unable to report them. */}
      <div className="mt-6 flex flex-wrap gap-3 border-t border-hairline pt-4">
        <button
          onClick={() => setReportOpen(o => !o)}
          className="text-sm font-bold text-muted hover:text-warm-dark"
        >
          Report this person
        </button>
        {!thread.isBlocked && (
          <button
            onClick={block}
            disabled={busy !== null}
            className="text-sm font-bold text-danger hover:underline disabled:opacity-50"
          >
            {busy === 'block' ? 'Blocking…' : 'Block this person'}
          </button>
        )}
      </div>

      {reportOpen && (
        <form onSubmit={report} className="mt-3 rounded-lg border border-hairline bg-white p-4">
          <label htmlFor="reason" className="block text-sm font-bold text-warm-dark">
            What’s happened?
          </label>
          <p className="mt-1 text-xs text-muted">
            This goes to our moderation team. Blocking is separate — it stops them contacting you
            straight away.
          </p>
          <textarea
            id="reason"
            value={reportReason}
            onChange={e => setReportReason(e.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-2 w-full resize-none rounded-md border border-hairline bg-white px-3 py-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={!reportReason.trim() || busy !== null}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy === 'report' ? 'Sending…' : 'Send report'}
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-5 text-sm font-bold text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
