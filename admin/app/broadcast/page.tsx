'use client'

/**
 * ONE MESSAGE TO MANY PEOPLE.
 *
 * ── ⚠️⚠️ NOTHING UNDERNEATH THIS SCREEN IS NEW ───────────────────────────
 * A broadcast is a PACED LOOP over `broadcast_as_admin` (0101), which writes
 * exactly the kind of notification row the rest of the product already writes.
 * The notify_email trigger, tg_notify_email, send-email, the unsubscribe page
 * and one-click headers, notification preferences and email_sends are all
 * untouched. If an email arrives wrong, this file is not where it went wrong.
 *
 * ── ⚠️⚠️ WHY THE LOOP IS SLOW ON PURPOSE. DO NOT REMOVE THE DELAY ────────
 * Read the comment at SEND_GAP_MS before changing it. In short: Resend allows
 * ten requests a second, pg_net dispatches up to 200 at a time, and
 * run_email_reconcile NOTICES a failed send but NEVER RETRIES one. The delay
 * is the only thing standing between a 40-person broadcast and a handful of
 * permanently undelivered emails.
 *
 * ── ⚠️ THE REPORT READS email_sends. IT DOES NOT TRUST THIS LOOP ─────────
 * The loop finishing means rows were written, not that mail was sent. Those
 * are different claims and only the second one matters to the person waiting
 * for it. Every outcome shown below comes from email_sends, and a recipient
 * with no row yet is reported as "no attempt yet" rather than quietly counted
 * as a success.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface Member {
  id: string
  first_name: string | null
  last_initial: string | null
  email: string
  role: string
  created_at: string
  profile_pic_url: string | null
  postcode: string | null
  /** From admin_signin_facts(), the only read of auth.users in the product. */
  last_sign_in_at: string | null
  email_confirmed_at: string | null
}

/**
 * ⚠️⚠️ DECLARED HERE AS NULLABLE BECAUSE THE GENERATED TYPE IS WRONG ABOUT IT,
 * AND BELIEVING IT WOULD DELETE THIS FEATURE.
 *
 * `database.types.ts` types `admin_signin_facts().Returns` as
 * `{ last_sign_in_at: string; email_confirmed_at: string }` — non-null. The
 * columns are `auth.users.last_sign_in_at` and `.email_confirmed_at`, both of
 * which are null for an account that has never signed in. The generator does
 * not express nullability for `returns table(...)` columns; it is not lying on
 * purpose, it simply cannot say.
 *
 * ⚠️ CORRECTION, 24 Oct 2026: that generated type never reached this call site
 * at all. `admin/lib/supabase.ts` builds the client with no `<Database>`
 * generic, so nothing in this console is type-checked against the schema and
 * `database.types.ts` is imported by nothing here. The reasoning below was
 * right and the mechanism named above was not — this interface is doing all of
 * the work, rather than correcting something the generator got wrong.
 *
 * ⚠️ IF THAT TYPE WERE TRUSTED, `m.last_sign_in_at === null` would read as
 * always-false and the "Never signed in" filter would silently match nobody —
 * worse, a later reader would be right to "simplify" the comparison away. Same
 * class as 0099, where the generator typed a defaulted argument as optional
 * but not nullable and the fix was to omit it rather than cast it.
 */
interface SignInFact {
  user_id: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
}

/** What the RPC wrote for one person. `wasNew` false means already sent. */
interface Written {
  userId: string
  notificationId: string
  wasNew: boolean
}

interface Outcome {
  status: 'sent' | 'failed' | 'skipped'
  reason: string | null
}

/**
 * ⚠️⚠️ THIS NUMBER IS PROTECTION, NOT POLITENESS, AND IT IS NOT SPARE.
 *
 *   * Resend allows 10 requests per second per team. The 11th in a second
 *     takes a 429.
 *   * Every notification row fires notify_email, which posts through pg_net.
 *     pg_net.batch_size is 200 (read from the live database), so rows written
 *     together are dispatched together.
 *   * run_email_reconcile does NOT retry. Read its live body: it counts
 *     failures into email_reconcile_runs and purges rows over 90 days. It
 *     notices; it never resends.
 *
 * So a 429 here is a person who never gets the email, with nothing behind it
 * to put that right. 180ms is about five a second — half the documented limit,
 * because the limit is per TEAM and ordinary transactional mail is sharing it
 * while this runs. Forty recipients take about seven seconds. That is the
 * correct trade and removing it to "speed up the send" would be a silent
 * downgrade from slow to lossy.
 */
const SEND_GAP_MS = 180

/** Survives a reload, so a refresh cannot start a second broadcast. */
const ACTIVE_KEY = 'cavy.broadcast.active'

interface Persisted {
  broadcastId: string
  title: string
  body: string
  recipients: string[]
  written: Written[]
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function nameOf(m: Member): string {
  const n = `${m.first_name ?? ''} ${m.last_initial ?? ''}`.trim()
  return n.length > 0 ? n : '(no name)'
}

function joined(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** The label a role gets in the list. 'both' is called what it is. */
function roleLabel(role: string): string {
  if (role === 'both') return 'model + stylist'
  if (role === 'provider') return 'stylist'
  return role
}

type QuickId = 'everyone' | 'models' | 'stylists' | 'no_photo' | 'no_postcode' | 'never_signed_in'

const QUICK: { id: QuickId; label: string; match: (m: Member) => boolean }[] = [
  { id: 'everyone', label: 'Everyone', match: () => true },
  // ⚠️ INCLUSIVE OF 'both', AND THE LABEL SAYS SO. A `role = 'model'` test
  // would drop the both account out of BOTH groups, so the one person who is
  // both a model and a stylist would receive neither mailing — a silent
  // omission, which is the worst kind on a screen whose job is reaching people.
  { id: 'models', label: 'Models (incl. both)', match: m => m.role === 'model' || m.role === 'both' },
  { id: 'stylists', label: 'Stylists (incl. both)', match: m => m.role === 'provider' || m.role === 'both' },
  { id: 'no_photo', label: 'No profile photo', match: m => !m.profile_pic_url?.trim() },
  { id: 'no_postcode', label: 'No postcode', match: m => !m.postcode?.trim() },
  // ⚠️ REAL, BUT NEARLY EMPTY TODAY — see the note rendered under the buttons.
  { id: 'never_signed_in', label: 'Never signed in', match: m => m.last_sign_in_at === null },
]

export default function BroadcastPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [signInsUnavailable, setSignInsUnavailable] = useState(false)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const [stage, setStage] = useState<'compose' | 'confirm' | 'sending' | 'report'>('compose')
  const [broadcastId, setBroadcastId] = useState<string | null>(null)
  const [written, setWritten] = useState<Written[]>([])
  const [stoppedAt, setStoppedAt] = useState<{ userId: string; error: string } | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [outcomesLoading, setOutcomesLoading] = useState(false)
  const [resumable, setResumable] = useState<Persisted | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  // ── load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_initial, email, role, created_at, profile_pic_url, postcode')
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setLoading(false)
        return
      }

      const base = ((data ?? []) as unknown as Omit<Member, 'last_sign_in_at' | 'email_confirmed_at'>[])

      // ⚠️ THE SIGN-IN READ IS ALLOWED TO FAIL WITHOUT TAKING THE PAGE WITH
      // IT. It is the one call here that touches auth.users, and a broadcast
      // must still be sendable if it is unavailable — the only thing lost is
      // one quick filter, and the UI says so rather than showing an empty one.
      const facts: Record<string, SignInFact> = {}
      const { data: sf, error: sfErr } = await supabase.rpc('admin_signin_facts')
      if (sfErr) {
        if (!cancelled) setSignInsUnavailable(true)
      } else {
        for (const f of (sf ?? []) as unknown as SignInFact[]) facts[f.user_id] = f
      }

      if (cancelled) return
      setMembers(base.map(m => ({
        ...m,
        last_sign_in_at: facts[m.id]?.last_sign_in_at ?? null,
        email_confirmed_at: facts[m.id]?.email_confirmed_at ?? null,
      })))

      // ⚠️ A RELOAD MUST NOT BE A SECOND BROADCAST. If a run was interrupted,
      // its id and the people already written are still here, so resuming
      // reuses the SAME broadcast_id and the unique index makes the overlap a
      // no-op.
      //
      // ⚠️ READ HERE RATHER THAN IN THE EFFECT BODY, and not because a lint
      // rule said so: `react-hooks/set-state-in-effect` is right that a
      // synchronous setState in an effect cascades, and the lazy-initialiser
      // alternative would read window during the server render and mismatch on
      // hydration. Inside this async function it is neither.
      try {
        const raw = window.localStorage.getItem(ACTIVE_KEY)
        if (raw && !cancelled) setResumable(JSON.parse(raw) as Persisted)
      } catch {
        // A corrupt or blocked store must not stop the page loading. What is
        // lost is the resume OFFER, not the dedupe — that lives in the index.
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ── the visible list: search FILTERS, quick buttons TICK ────────────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(m =>
      m.email.toLowerCase().includes(q) ||
      nameOf(m).toLowerCase().includes(q))
  }, [members, query])

  const visibleSelected = useMemo(
    () => visible.filter(m => selected.has(m.id)).length, [visible, selected])

  const allVisibleTicked = visible.length > 0 && visibleSelected === visible.length

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  /**
   * ⚠️ TICK-ALL MEANS "THE ONES I CAN CURRENTLY SEE", AND NOTHING ELSE.
   * It unions the filtered rows into the selection and never touches anyone
   * outside the filter — so ticking someone, then searching for someone else,
   * leaves the first person ticked and counted. Unticking removes only the
   * rows on screen, for the same reason. The button and the counter both say
   * "shown" whenever a filter is applied, so the gap between what is selected
   * and what is visible is never something to deduce.
   */
  const toggleAllVisible = useCallback(() => {
    setSelected(prev => {
      const next = new Set(prev)
      if (visible.every(m => next.has(m.id))) {
        for (const m of visible) next.delete(m.id)
      } else {
        for (const m of visible) next.add(m.id)
      }
      return next
    })
  }, [visible])

  /** Quick filters SET the ticks rather than filtering the view. */
  const applyQuick = useCallback((q: QuickId) => {
    const match = QUICK.find(x => x.id === q)!.match
    setSelected(new Set(members.filter(match).map(m => m.id)))
  }, [members])

  const chosen = useMemo(
    () => members.filter(m => selected.has(m.id)), [members, selected])

  const canCompose = title.trim().length > 0 && body.trim().length > 0

  // ── sending ─────────────────────────────────────────────────────────────
  const persist = useCallback((p: Persisted) => {
    try { window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(p)) } catch { /* see above */ }
  }, [])

  const clearPersisted = useCallback(() => {
    try { window.localStorage.removeItem(ACTIVE_KEY) } catch { /* see above */ }
  }, [])

  const runLoop = useCallback(async (
    id: string, subject: string, text: string, recipients: string[], already: Written[],
  ) => {
    setStage('sending')
    setStoppedAt(null)

    const done: Written[] = [...already]
    const doneIds = new Set(done.map(d => d.userId))
    setWritten(done)

    for (const userId of recipients) {
      if (doneIds.has(userId)) continue

      const { data, error } = await supabase.rpc('broadcast_as_admin', {
        p_user_id: userId, p_title: subject, p_body: text, p_broadcast_id: id,
      })

      if (error) {
        // ⚠️ STOP, AND SAY WHO WAS ALREADY REACHED. A half-finished broadcast
        // that reports nothing is worse than one that fails loudly: the next
        // person has to guess whether to run it again.
        setStoppedAt({ userId, error: error.message })
        persist({ broadcastId: id, title: subject, body: text, recipients, written: done })
        setStage('report')
        return
      }

      const row = (data ?? [])[0]
      if (row) {
        done.push({ userId, notificationId: row.notification_id, wasNew: row.was_new })
        setWritten([...done])
        persist({ broadcastId: id, title: subject, body: text, recipients, written: done })
      }

      await sleep(SEND_GAP_MS)
    }

    await logAction('admin_broadcast_sent', {
      details: { broadcastId: id, title: subject, recipients: recipients.length },
    })
    clearPersisted()
    setStage('report')
  }, [persist, clearPersisted])

  const startSend = useCallback(async () => {
    const id = broadcastId ?? crypto.randomUUID()
    setBroadcastId(id)
    await runLoop(id, title.trim(), body.trim(), chosen.map(m => m.id), [])
  }, [broadcastId, title, body, chosen, runLoop])

  const resume = useCallback(async () => {
    if (!resumable) return
    const r = resumable
    setResumable(null)
    setBroadcastId(r.broadcastId)
    setTitle(r.title)
    setBody(r.body)
    setSelected(new Set(r.recipients))
    await runLoop(r.broadcastId, r.title, r.body, r.recipients, r.written)
  }, [resumable, runLoop])

  /**
   * ⚠️ THE TEST USES THE IDENTICAL PATH — same RPC, same type, same copy, same
   * trigger, same send-email. It is not a preview rendered here, because a
   * preview rendered here would be this file's opinion of the email rather
   * than the email. Its own broadcast_id, so testing never consumes a real
   * recipient's slot in the real send.
   */
  const sendTestToMyself = useCallback(async () => {
    if (!canCompose) return
    setTesting(true)
    setTestNote(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setTestNote('Could not work out who you are signed in as. Nothing was sent.')
      setTesting(false)
      return
    }
    const { error } = await supabase.rpc('broadcast_as_admin', {
      p_user_id: user.id, p_title: title.trim(), p_body: body.trim(),
      p_broadcast_id: crypto.randomUUID(),
    })
    setTestNote(error
      ? `Not sent: ${error.message}`
      : 'Sent to you. It goes through the same trigger and the same email as a real one, so what arrives is what they get.')
    setTesting(false)
  }, [canCompose, title, body])

  // ── the report, read from email_sends ───────────────────────────────────
  const loadOutcomes = useCallback(async () => {
    if (written.length === 0) return
    setOutcomesLoading(true)
    const { data } = await supabase
      .from('email_sends')
      .select('ref_id, status, reason, created_at')
      .eq('kind', 'notification')
      .in('ref_id', written.map(w => w.notificationId))
      .order('created_at', { ascending: false })

    const rows = (data ?? []) as unknown as
      { ref_id: string; status: Outcome['status']; reason: string | null }[]
    const map: Record<string, Outcome> = {}
    // Ordered newest first, so the first row seen for a notification is its
    // latest attempt. Later rows for the same one are earlier tries.
    for (const r of rows) if (!map[r.ref_id]) map[r.ref_id] = { status: r.status, reason: r.reason }
    setOutcomes(map)
    setOutcomesLoading(false)
  }, [written])

  useEffect(() => {
    if (stage !== 'report') return
    // ⚠️ send-email runs AFTER this loop, through pg_net — so the rows are not
    // there the instant the loop ends. One delayed read, then the button. An
    // immediate read showing all-blank would look like total failure.
    const t = setTimeout(() => { void loadOutcomes() }, 2500)
    return () => clearTimeout(t)
  }, [stage, loadOutcomes])

  const byId = useMemo(() => {
    const m: Record<string, Member> = {}
    for (const x of members) m[x.id] = x
    return m
  }, [members])

  const tally = useMemo(() => {
    let sent = 0, skipped = 0, failed = 0, pending = 0, already = 0
    for (const w of written) {
      if (!w.wasNew) already++
      const o = outcomes[w.notificationId]
      if (!o) pending++
      else if (o.status === 'sent') sent++
      else if (o.status === 'skipped') skipped++
      else failed++
    }
    return { sent, skipped, failed, pending, already }
  }, [written, outcomes])

  // ── render ──────────────────────────────────────────────────────────────
  const card = 'bg-white rounded-xl border border-black/5 shadow-sm'
  const field = 'w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-[#3D2E2E] ' +
    'focus:outline-none focus:ring-2 focus:ring-[#DB4B86]/40'

  if (loading) {
    return <div className="text-sm text-[#3D2E2E]/60">Loading members…</div>
  }
  if (loadError) {
    return (
      <div className={`${card} p-5`}>
        <p className="font-semibold text-[#3D2E2E]">Could not load the member list</p>
        <p className="mt-1 text-sm text-[#3D2E2E]/70">{loadError}</p>
        <p className="mt-2 text-sm text-[#3D2E2E]/70">Nothing has been sent.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Broadcast</h1>
        <p className="mt-1 text-sm text-[#3D2E2E]/60">
          One message to many members. It arrives as a notification and an email, through
          the same path as every other Cavy email.
        </p>
      </div>

      {resumable && stage === 'compose' && (
        <div className={`${card} border-amber-300 bg-amber-50 p-4`}>
          <p className="font-semibold text-[#3D2E2E]">A broadcast was interrupted</p>
          <p className="mt-1 text-sm text-[#3D2E2E]/80">
            “{resumable.title}” — {resumable.written.length} of {resumable.recipients.length} were
            written before it stopped. Resuming reuses the same broadcast, so nobody already
            reached will be sent to twice.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => void resume()}
              className="rounded-lg bg-[#DB4B86] px-3 py-1.5 text-sm font-medium text-white">
              Resume it
            </button>
            <button onClick={() => { clearPersisted(); setResumable(null) }}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#3D2E2E]">
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ── compose ─────────────────────────────────────────────────────── */}
      {stage === 'compose' && (
        <>
          <div className={`${card} p-5 space-y-4`}>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#3D2E2E]/60" htmlFor="b-title">
                Subject
              </label>
              <input id="b-title" className={field} value={title} maxLength={120}
                onChange={e => setTitle(e.target.value)}
                placeholder="What this message is about" />
              {/* ⚠️ Unlike a one-to-one admin message, the subject here IS the
                  email's subject line. Saying so stops it being discovered in
                  an inbox. */}
              <p className="mt-1 text-xs text-[#3D2E2E]/60">
                This is the email’s subject line, exactly as written.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#3D2E2E]/60" htmlFor="b-body">
                Message
              </label>
              <textarea id="b-body" className={`${field} min-h-[8rem]`} value={body}
                onChange={e => setBody(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={!canCompose || testing} onClick={() => void sendTestToMyself()}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#3D2E2E] disabled:opacity-40">
                {testing ? 'Sending…' : 'Send a test to myself'}
              </button>
              {testNote && <span className="text-sm text-[#3D2E2E]/70">{testNote}</span>}
            </div>
          </div>

          <div className={`${card} p-5`}>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK.map(q => (
                <button key={q.id} onClick={() => applyQuick(q.id)}
                  disabled={q.id === 'never_signed_in' && signInsUnavailable}
                  className="rounded-full border border-black/10 px-3 py-1 text-sm text-[#3D2E2E] hover:bg-black/5 disabled:opacity-40">
                  {q.label}
                </button>
              ))}
              <button onClick={() => setSelected(new Set())}
                className="rounded-full px-3 py-1 text-sm text-[#3D2E2E]/60 hover:bg-black/5">
                Clear
              </button>
            </div>
            <p className="mt-2 text-xs text-[#3D2E2E]/60">
              These set the ticks — they don’t hide anyone. The search box below filters what
              you can see; it never changes who is ticked.
            </p>
            {/* ⚠️ A filter that selects one person is not a useful filter yet,
                and saying so is cheaper than letting it be discovered. */}
            {signInsUnavailable
              ? <p className="mt-1 text-xs text-amber-700">
                  “Never signed in” is unavailable — the sign-in read failed. Everything else works.
                </p>
              : <p className="mt-1 text-xs text-[#3D2E2E]/60">
                  “Never signed in” currently matches{' '}
                  {members.filter(m => m.last_sign_in_at === null).length} of {members.length} —
                  it earns its place as the list grows.
                </p>}
            {/* The both account is the admin's own, so every inclusive filter
                includes him. Better said here than discovered in his inbox. */}
            {members.some(m => m.role === 'both') && (
              <p className="mt-1 text-xs text-[#3D2E2E]/60">
                The model + stylist account is yours, so “Models” and “Stylists” both include you.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input className={`${field} max-w-xs`} value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name or email" />
              <button onClick={toggleAllVisible}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#3D2E2E]">
                {allVisibleTicked
                  ? `Untick the ${visible.length} shown`
                  : `Select all ${visible.length} shown`}
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-[#3D2E2E]/50">
                  <tr>
                    <th className="w-8 py-2"></th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Joined</th>
                    <th className="py-2 pr-3">Photo</th>
                    <th className="py-2 pr-3">Postcode</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(m => (
                    <tr key={m.id} className="border-t border-black/5">
                      <td className="py-2">
                        <input type="checkbox" checked={selected.has(m.id)}
                          onChange={() => toggle(m.id)}
                          aria-label={`Include ${nameOf(m)}`} />
                      </td>
                      <td className="py-2 pr-3 text-[#3D2E2E]">{nameOf(m)}</td>
                      <td className="py-2 pr-3 text-[#3D2E2E]/70">{m.email}</td>
                      <td className="py-2 pr-3 text-[#3D2E2E]/70">{roleLabel(m.role)}</td>
                      <td className="py-2 pr-3 text-[#3D2E2E]/70">{joined(m.created_at)}</td>
                      <td className="py-2 pr-3">{m.profile_pic_url?.trim() ? 'Yes' : '—'}</td>
                      <td className="py-2 pr-3">{m.postcode?.trim() ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-[#3D2E2E]/60">
                      Nobody matches that search. Anyone already ticked is still ticked.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ⚠️ The count is pinned beside the button, and names the gap
              between what is selected and what is on screen. */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-black/5 bg-white/95 p-4 backdrop-blur">
            <span className="text-sm font-semibold text-[#3D2E2E]">
              {selected.size} selected
              {query.trim() && <span className="font-normal text-[#3D2E2E]/60">
                {' '}({visibleSelected} of the {visible.length} shown)
              </span>}
            </span>
            <button disabled={selected.size === 0 || !canCompose}
              onClick={() => { setBroadcastId(crypto.randomUUID()); setStage('confirm') }}
              className="rounded-lg bg-[#DB4B86] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Review and send
            </button>
            {selected.size > 0 && !canCompose &&
              <span className="text-sm text-[#3D2E2E]/60">Add a subject and a message first.</span>}
          </div>
        </>
      )}

      {/* ── confirm ─────────────────────────────────────────────────────── */}
      {stage === 'confirm' && (
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-[#3D2E2E]">
            Send to {chosen.length} {chosen.length === 1 ? 'person' : 'people'}?
          </h2>
          <p className="mt-1 text-sm text-[#3D2E2E]/70">
            This goes to real people and cannot be taken back. They receive a notification and,
            unless they have turned emails off, an email with the subject “{title.trim()}”.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#3D2E2E]/80">
            {chosen.slice(0, 5).map(m => (
              <li key={m.id}>{nameOf(m)} — {m.email}</li>
            ))}
          </ul>
          {chosen.length > 5 && (
            <p className="mt-1 text-sm text-[#3D2E2E]/60">…and {chosen.length - 5} more.</p>
          )}
          <p className="mt-3 text-xs text-[#3D2E2E]/60">
            Sent one at a time, about five a second, so none of them is dropped by the email
            provider’s rate limit. {chosen.length} will take roughly{' '}
            {Math.ceil((chosen.length * SEND_GAP_MS) / 1000)} seconds.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => void startSend()}
              className="rounded-lg bg-[#DB4B86] px-4 py-2 text-sm font-medium text-white">
              Send to {chosen.length}
            </button>
            <button onClick={() => setStage('compose')}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#3D2E2E]">
              Back
            </button>
          </div>
        </div>
      )}

      {/* ── sending ─────────────────────────────────────────────────────── */}
      {stage === 'sending' && (
        <div className={`${card} p-5`}>
          <p className="font-semibold text-[#3D2E2E]">
            Sending… {written.length} of {chosen.length}
          </p>
          <p className="mt-1 text-sm text-[#3D2E2E]/70">
            Leave this page open. If it is interrupted you will be offered the chance to resume,
            and nobody already reached will be sent to twice.
          </p>
        </div>
      )}

      {/* ── report ──────────────────────────────────────────────────────── */}
      {stage === 'report' && (
        <div className={`${card} p-5`}>
          {stoppedAt ? (
            <>
              <h2 className="font-semibold text-red-700">It stopped partway</h2>
              <p className="mt-1 text-sm text-[#3D2E2E]/80">
                {written.length} of {chosen.length} were written before it failed on{' '}
                {byId[stoppedAt.userId] ? nameOf(byId[stoppedAt.userId]) : stoppedAt.userId}:{' '}
                {stoppedAt.error}
              </p>
              <p className="mt-1 text-sm text-[#3D2E2E]/80">
                Everyone listed below has been reached. Reload this page to be offered a resume
                that skips them.
              </p>
            </>
          ) : (
            <h2 className="font-semibold text-[#3D2E2E]">
              Finished — {written.length} written
              {tally.already > 0 && `, ${tally.already} of them already sent in an earlier run`}
            </h2>
          )}

          {/* ⚠️ "Written" is not "delivered", and the two are shown apart. */}
          <p className="mt-2 text-sm text-[#3D2E2E]/70">
            {tally.sent} sent · {tally.skipped} skipped · {tally.failed} failed ·{' '}
            {tally.pending} no attempt recorded yet
          </p>
          <p className="mt-1 text-xs text-[#3D2E2E]/60">
            Read from <code>email_sends</code>, not from the loop. The email is sent after the
            notification is written, so “no attempt recorded yet” usually means it is still in
            flight — give it a moment and refresh.
          </p>
          <button onClick={() => void loadOutcomes()} disabled={outcomesLoading}
            className="mt-3 rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#3D2E2E] disabled:opacity-40">
            {outcomesLoading ? 'Checking…' : 'Refresh outcomes'}
          </button>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[#3D2E2E]/50">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Why</th>
                </tr>
              </thead>
              <tbody>
                {written.map(w => {
                  const m = byId[w.userId]
                  const o = outcomes[w.notificationId]
                  return (
                    <tr key={w.userId} className="border-t border-black/5">
                      <td className="py-2 pr-3 text-[#3D2E2E]">{m ? nameOf(m) : w.userId}</td>
                      <td className="py-2 pr-3 text-[#3D2E2E]/70">{m?.email ?? '—'}</td>
                      <td className="py-2 pr-3">
                        {!o ? <span className="text-[#3D2E2E]/60">no attempt yet</span>
                          : o.status === 'sent' ? <span className="text-green-700">sent</span>
                          : o.status === 'skipped' ? <span className="text-amber-700">skipped</span>
                          : <span className="text-red-700">failed</span>}
                      </td>
                      <td className="py-2 pr-3 text-[#3D2E2E]/70">
                        {o?.reason ?? (w.wasNew ? '' : 'already sent in an earlier run')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button onClick={() => {
            setStage('compose'); setWritten([]); setOutcomes({})
            setBroadcastId(null); setStoppedAt(null); setSelected(new Set())
            setTitle(''); setBody('')
          }} className="mt-4 rounded-lg border border-black/10 px-3 py-1.5 text-sm text-[#3D2E2E]">
            Start another
          </button>
        </div>
      )}
    </div>
  )
}
