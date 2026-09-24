'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { humanError } from '@/lib/adminActions'

interface Party {
  id: string
  first_name: string
  last_name: string | null
  last_initial: string | null
  email: string
}

interface SubjectHistory {
  reported_email_hash: string
  child_safety_reports: number
  last_child_safety_at: string | null
  total_reports: number
}

interface Report {
  id: string
  reason: string
  /** Machine-readable category from migration 0021. Null on pre-0021 rows. */
  reason_code: string | null
  details: string | null
  status: string
  created_at: string
  session_id: string | null
  // Null when the account was deleted (migration 0004 nulls the FK) or when RLS
  // hides the row. The *_name / *_email_hash columns tell those two apart.
  reporter: Party | null
  reported: Party | null
  reporter_name: string | null
  reporter_email_hash: string | null
  reported_name: string | null
  reported_email_hash: string | null
}

// Admin-only full identity: prefer the private full surname, fall back to the
// initial for legacy accounts that never captured one.
// What each action actually does. Warn/suspend/ban act on the USER and leave the
// report open; dismiss/resolve only close the REPORT and don't touch the user —
// so handling someone properly is a two-step job, which the buttons alone don't say.
/**
 * ── THE PRIORITY RULE ──────────────────────────────────────────────────────
 *
 * A report is flagged, and sorts to the top, if EITHER:
 *   * it is itself a child-safety report, or
 *   * the person it is about has EVER been the subject of one.
 *
 * The second half is the one that matters and the one that is easy to leave
 * out. A flag that lives on the individual report disappears the moment that
 * report is resolved — so a person reported for child safety in March, dealt
 * with, and reported again in June for something else would arrive in the queue
 * looking new. The history is the signal, not the row.
 *
 * It keys on `reported_email_hash` rather than the user id because that is the
 * identity that survives (migration 0004): deleting the account, or deleting
 * and re-registering, does not reset the flag.
 *
 * This is also the mechanism behind a promise made to reporters in the app —
 * "child-safety reports go to the top of our queue and we look at these first".
 * If this sort is removed, that sentence has to go with it.
 */
function isFlagged(r: Report, history: Map<string, SubjectHistory>): boolean {
  if (r.reason_code === 'child_safety') return true
  const h = r.reported_email_hash ? history.get(r.reported_email_hash) : undefined
  return !!h && h.child_safety_reports > 0
}

const ACTION_HELP: Record<string, string> = {
  warn:    'Sends this user an official warning in the app. It does NOT close the report — resolve it afterwards.',
  // The stylist half since 0044 (audit item 66): suspend and ban withdraw a stylist.
  suspend: 'Blocks this user from applying, messaging and reviewing for the chosen number of days. If they are a stylist, their shop is hidden and their upcoming bookings are cancelled, and it stays hidden when the suspension ends until they republish it. It does NOT close the report — resolve it afterwards.',
  ban:     'Permanently blocks this user from using the app. If they are a stylist, their shop is hidden and their upcoming bookings are cancelled. It does NOT close the report — resolve it afterwards.',
  dismiss: 'Closes this report with NO action against the user. Use when the report wasn’t a genuine breach.',
  resolve: 'Closes this report as actioned. Use after you’ve warned, suspended or banned the user.',
}

// Tolerates null: a joined users row hidden by RLS comes back as NULL rather than
// an error, and dereferencing it here used to blank the whole page.
//
// `stored` is the name captured on the report itself at the time it was filed
// (migration 0004). A null join WITH a stored name means the account was
// deleted; a null join WITHOUT one means RLS is hiding it. Those need different
// words — "Not visible" told an admin to go looking for an account that no
// longer exists.
function fullName(u: Party | null | undefined, stored?: string | null) {
  if (!u) return stored ? `${stored} — deleted account` : 'Not visible'
  const last = u.last_name ?? (u.last_initial ? `${u.last_initial}.` : '')
  return `${u.first_name} ${last}`.trim()
}

// The email, or — once the account is gone — the first bytes of the SHA-256 of
// it. That hash is the whole reason it is stored: two reports about the same
// deleted person show the same prefix, so deleting and re-registering does not
// break the trail. Without surfacing it here it would be invisible to the only
// people who would ever act on it.
function identity(u: Party | null | undefined, hash?: string | null) {
  if (u) return u.email
  if (hash) return `hash ${hash.slice(0, 8)}…`
  return '—'
}

/** True when the party is gone rather than merely hidden from this admin. */
function wasDeleted(u: Party | null | undefined, stored?: string | null) {
  return !u && !!stored
}

interface Message {
  id: string
  body: string
  created_at: string
  sender: { first_name: string; last_initial: string | null }
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [history, setHistory] = useState<Map<string, SubjectHistory>>(new Map())
  const [statusFilter, setStatusFilter] = useState('open')
  const [chat, setChat] = useState<{ report: Report; messages: Message[] } | null>(null)
  const [actionModal, setActionModal] = useState<{ report: Report; action: string } | null>(null)
  const [reason, setReason] = useState('')
  // 0058. What the MEMBER reads. `reason` is evidence and may name the
  // person who reported them, so the two are never the same field.
  const [message, setMessage] = useState('')
  const [duration, setDuration] = useState('7')

  const { loading, reload } = useLoader(statusFilter, async stale => {
    let q = supabase
      .from('reports')
      .select(`id, reason, reason_code, details, status, created_at, session_id,
        reporter_name, reporter_email_hash, reported_name, reported_email_hash,
        reporter:users!reporter_id(id, first_name, last_name, last_initial, email),
        reported:users!reported_id(id, first_name, last_name, last_initial, email)`)
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)

    // The history spans EVERY status, so it is fetched separately rather than
    // derived from the filtered list. Deriving it from `data` would mean the
    // "open" tab could not see a resolved child-safety report — which is the
    // one case this exists for.
    const [{ data }, { data: hist, error: histErr }] = await Promise.all([
      q,
      supabase.rpc('report_subject_history'),
    ])

    if (histErr) {
      // Loud rather than silently unflagged. An unflagged queue looks like a
      // calm queue, which is the worst way for this to fail.
      console.error('[reports] report_subject_history failed', histErr)
      alert(
        'Could not load report history, so child-safety flags are NOT shown and the queue ' +
        'is in date order only. Reload before working through it.',
      )
    }
    if (stale()) return
    const map = new Map<string, SubjectHistory>()
    for (const h of ((hist ?? []) as SubjectHistory[])) map.set(h.reported_email_hash, h)
    setHistory(map)

    const rows = (data as unknown as Report[]) ?? []
    // Flagged first, then newest first within each group. Sorting here rather
    // than in the query because the flag depends on the history, which the
    // database cannot express as one ordering without a join this page does not
    // need.
    rows.sort((a, b) => {
      const fa = isFlagged(a, map), fb = isFlagged(b, map)
      if (fa !== fb) return fa ? -1 : 1
      return b.created_at.localeCompare(a.created_at)
    })
    setReports(rows)
  })

  async function viewChat(report: Report) {
    if (!report.session_id) return
    const { data } = await supabase
      .from('messages')
      .select('id, body, created_at, sender:users!sender_id(first_name, last_initial)')
      .eq('session_id', report.session_id)
      .order('created_at')
    setChat({ report, messages: (data as unknown as Message[]) ?? [] })
  }

  /**
   * ── ONE CALL, AND IT TAKES THE REPORT RATHER THAN THE REPORTED USER ───
   *
   * admin_act_on_report (0039) takes the report id, locks the row, and resolves
   * the reported account itself. Five things change here, and three of them are
   * behaviour rather than tidying:
   *
   *   * ⚠️ SUSPENSIONS NOW REPLACE RATHER THAN STACK. warn/suspend/ban go
   *     through the same _admin_apply_user_action as the users page. This page
   *     inserted into suspensions without deleting first, so suspending someone
   *     already suspended left TWO live rows and activeSuspension() picked
   *     whichever came back first. That is a real change in what the button
   *     does, and it is the fix audit item 29 predicted would fall out of there
   *     being one copy of an action instead of three.
   *
   *   * ⚠️ CLOSING A REPORT NOW RECORDS WHO AND WHY. dismiss and resolve write
   *     reports.reviewed_by and reports.resolution in the same transaction.
   *     This page wrote neither: the reason typed into that box reached
   *     admin_audit_log.admin_note and nowhere else, and reports.reviewed_by had
   *     never been written at all — the reports half of audit item 34.
   *
   *   * ⚠️ THE DELETED-ACCOUNT PRE-CHECK IS GONE, and this is the deletion that
   *     is not a simplification. It refused warn/suspend/ban whenever
   *     report.reported?.id was falsy — which is true when the account is gone
   *     AND when RLS merely hid the row from this admin. The function runs as
   *     SECURITY DEFINER, so it can tell those two apart, and an RLS-hidden
   *     account is perfectly actionable to it; refusing here would block
   *     something the database permits. It raises a precise message for the
   *     genuinely deleted case, and the modal keeps its amber warning — so the
   *     explanation still reaches the admin BEFORE they pick an action, which is
   *     earlier than this check ever did.
   *
   *   * logAction is gone. The function writes the row, with the same
   *     report_<action> labels the audit-log page already reads.
   *
   *   * Two admins cannot both close one report: the row is locked FOR UPDATE
   *     before its status is read, so the second is refused with "this report is
   *     already dismissed" rather than quietly overwriting the first decision.
   */
  async function doAction() {
    if (!actionModal) return
    const { report, action } = actionModal

    const { error } = await supabase.rpc('admin_act_on_report', {
      p_report_id:     report.id,
      p_action:        action,
      p_reason:        reason.trim() || null,
      p_duration_days: action === 'suspend' ? Number(duration) : null,
      p_message:       message.trim() || undefined,
    })

    if (error) {
      // Nothing partial to describe: it committed or it did not.
      alert(`Could not ${action} this report.\n\n${humanError(error.message)}\n\nNothing has changed.`)
      return
    }

    setActionModal(null)
    setReason('')
    setMessage('')
    reload()
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
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {/* ── THE BADGE SAYS WHICH KIND OF FLAG IT IS ──────────────
                       isFlagged is true for two different reasons, and a single
                       "CHILD SAFETY" badge said the same thing about both. A spam
                       report about someone with child-safety history was reading
                       as a child-safety report, and the badge is what an admin
                       scans before the reason line.

                       Both stay red and both still sort to the top: the priority
                       is the person's history either way, which is the whole
                       point of keying the flag to reported_email_hash. Only the
                       WORDS differ, because only the words were wrong. */}
                    {isFlagged(r, history) && (
                      r.reason_code === 'child_safety' ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white"
                          title="This report is itself a child-safety report.">
                          CHILD SAFETY
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-600 text-white ring-2 ring-red-200"
                          title="This report is not a child-safety report. The person it is about has been the subject of one before.">
                          CHILD-SAFETY HISTORY
                        </span>
                      )
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{r.status}</span>
                    <span className="text-xs text-[#3D2E2E]/40">{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                  </div>
                  <div className="text-sm mb-1">
                    <span className="font-medium text-[#3D2E2E]">{fullName(r.reporter, r.reporter_name)}</span>
                    <span className="text-[#3D2E2E]/40"> ({identity(r.reporter, r.reporter_email_hash)})</span>
                    <span className="text-[#3D2E2E]/50"> reported </span>
                    <span className="font-medium text-[#3D2E2E]">{fullName(r.reported, r.reported_name)}</span>
                    <span className="text-[#3D2E2E]/40"> ({identity(r.reported, r.reported_email_hash)})</span>
                  </div>
                  <div className="text-sm font-semibold text-[#8C4A58] mb-1">
                    {r.reason}
                    {!r.reason_code && (
                      <span className="ml-2 text-xs font-normal text-[#3D2E2E]/40">
                        (filed before categories existed)
                      </span>
                    )}
                  </div>
                  {r.details && <div className="text-sm text-[#3D2E2E]/60">{r.details}</div>}
                  {/* When the flag comes from HISTORY rather than from this
                      report, say so — otherwise an admin reads "CHILD SAFETY"
                      against a spam report and assumes the badge is broken. */}
                  {isFlagged(r, history) && r.reason_code !== 'child_safety' && (
                    <div className="mt-1 text-xs font-medium text-red-700">
                      This person has been the subject of{' '}
                      {history.get(r.reported_email_hash ?? '')?.child_safety_reports} child-safety
                      report(s) before, including resolved ones.
                    </div>
                  )}
                  {(history.get(r.reported_email_hash ?? '')?.total_reports ?? 0) > 1 && (
                    <div className="mt-1 text-xs text-[#3D2E2E]/50">
                      {history.get(r.reported_email_hash ?? '')?.total_reports} reports about this
                      person in total, across every status.
                    </div>
                  )}
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
                        <button key={a} onClick={() => { setActionModal({ report: r, action: a }); setReason(''); setMessage('') }}
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
                    {m.sender ? `${m.sender.first_name} ${m.sender.last_initial ?? ''}.` : 'Unknown'} · {new Date(m.created_at).toLocaleString('en-GB')}
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
            <p className="text-sm text-[#3D2E2E]/60 mb-3">
              Acting on: <span className="font-medium text-[#3D2E2E]">
                {fullName(actionModal.report.reported, actionModal.report.reported_name)}
              </span>
              {' '}— {identity(actionModal.report.reported, actionModal.report.reported_email_hash)}
              <span className="block text-xs text-[#3D2E2E]/40 mt-0.5">
                id {actionModal.report.reported?.id ?? '—'}
              </span>
            </p>

            {/* The account is gone, so warn/suspend/ban have no target. Say so
                before they pick one, rather than only when they confirm. */}
            {wasDeleted(actionModal.report.reported, actionModal.report.reported_name) && (
              <p className="text-sm text-[#3D2E2E]/70 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                This account has been deleted. The report is kept as a record and their email
                fingerprint still matches if they sign up again — but warn, suspend and ban have
                nothing to act on. Resolve or dismiss.
              </p>
            )}

            {/* Say what the action actually does. "Resolve" vs "dismiss" is not
               self-evident, and warn/suspend/ban do NOT close the report — that
               two-step is the easiest thing to get wrong on this page. */}
            <p className="text-sm text-[#3D2E2E]/70 bg-[#FAF7F4] border border-black/5 rounded-lg px-3 py-2 mb-4">
              {ACTION_HELP[actionModal.action]}
            </p>

            {actionModal.action === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Duration (days)</label>
                <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full" />
              </div>
            )}

            {/* Every action takes a note, including dismiss/resolve — without one
               there's no record of WHY a report was closed.

               Where it goes, since 0039: admin_act_on_report writes it to
               admin_audit_log.admin_note for every action, AND to
               reports.resolution when the action closes the report. So a closed
               report now carries its own reason rather than only being
               explainable by cross-referencing the audit log.

               It previously said "carried into the audit log via logAction's
               adminNote". This page no longer calls logAction — a comment naming
               a function the file does not call is the same defect as an alert
               describing a state that cannot happen, only quieter. */}
            <div className="mb-4">
              <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">
                {['dismiss', 'resolve'].includes(actionModal.action)
                  ? 'Why are you closing this? (recorded in the audit log)'
                  : 'Reason — evidence for the record, never shown to them'}
              </label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder={
                  actionModal.action === 'dismiss' ? 'e.g. not a genuine breach — no action needed'
                  : actionModal.action === 'resolve' ? 'e.g. warned the user, no further action'
                  : ''
                }
                className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
            </div>

            {/* ══ THE MESSAGE BOX — the only part the member reads (0058, item 118).
                The box above is evidence and may name whoever reported them. */}
            {['warn','suspend','ban'].includes(actionModal.action) && (
              <div className="mb-4">
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">
                  {actionModal.action === 'warn'
                    ? `Message to them — required. This IS the warning. ${message.trim().length}/10`
                    : 'Message to them — optional, and the only part they read'}
                </label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
                  placeholder="e.g. Please keep messages to arranging the appointment."
                  className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none" />
                <p className="mt-1 text-[11px] text-[#3D2E2E]/50">
                  ⚠️ <strong>Never name anyone here.</strong>{' '}
                  {actionModal.action === 'warn'
                    ? 'A warning is nothing but this message. It is sent by notification and email, and without it they only learn they are in trouble.'
                    : 'They see the notice and the date either way. This is the only part that says why.'}
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setActionModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={doAction}
                // Matches 0058's warn branch, so she is not refused AFTER pressing it.
                disabled={actionModal.action === 'warn' && message.trim().length < 10}
                className="px-4 py-2 text-sm rounded-lg text-white font-medium disabled:bg-gray-300 disabled:text-gray-500"
                style={actionModal.action === 'warn' && message.trim().length < 10
                  ? undefined : { backgroundColor: '#8C4A58' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
