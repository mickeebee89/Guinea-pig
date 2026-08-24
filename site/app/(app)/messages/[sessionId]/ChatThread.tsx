'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { markThreadRead, type Thread, type ThreadMessage } from '@/lib/queries/thread'
import { Avatar, StatusPill } from '@/components/ui'
import { SafetyMenu } from '@/components/SafetyMenu'

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

  const [messages, setMessages] = useState<ThreadMessage[]>(thread.messages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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
   * Block and report both moved to <SafetyMenu>, which calls the server actions
   * in app/(app)/safety-actions.ts.
   *
   * They used to live here as two inline callbacks — the block cascade
   * hand-ported from mobile, the report a free-text box. Both are now shared
   * with the two profile screens. A copy per surface is precisely how the chat
   * version and the profile version drift into doing different things, and for
   * a block that means one of them silently stops cancelling the pair's live
   * bookings.
   *
   * It also moved them off the browser client and onto the server, so this file
   * keeps being the only browser-client user on the site.
   */


  return (
    <div className="flex min-h-[70dvh] flex-col">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/messages" className="text-sm font-bold text-rose hover:underline">← Messages</Link>
      </div>

      <header className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-white p-4">
        <Avatar src={thread.otherParty.picUrl} name={thread.otherParty.name} size={44} />
        <div className="min-w-0 flex-1">
          {/* Both sides have a profile route now. The stylist's takes a
              providers.id and the model's takes an auth user id — they are
              different kinds of id and always will be, which is why the safety
              controls take a tagged subject rather than a string. */}
          <Link
            href={thread.isModel
              ? `/stylist/${thread.session.provider_id}`
              : `/model/${otherUserId}`}
            className="font-bold text-warm-dark underline decoration-hairline underline-offset-2 hover:text-rose"
          >
            {thread.otherParty.name}
          </Link>
          <p className="text-xs text-muted">
            {new Date(thread.session.date + 'T00:00:00').toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
            {thread.treatmentCategory && ` · ${thread.treatmentCategory}`}
          </p>
        </div>
        <StatusPill status={thread.session.status} />
      </header>


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
          You can’t message this person. If you blocked them, you can undo that in Settings.
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
          message someone is not the same as being unable to report them. And
          present whatever state the other account is in: reports outlive
          accounts by design (migration 0004), so the UI must not be the half
          that cannot. */}
      <div className="mt-6 flex flex-wrap gap-3 border-t border-hairline pt-4">
        {otherUserId && (
          <SafetyMenu
            subject={{ userId: otherUserId }}
            name={thread.otherParty.name}
            sessionId={sessionId}
            alreadyBlocked={thread.isBlocked}
            align="left"
          />
        )}
      </div>
    </div>
  )
}
