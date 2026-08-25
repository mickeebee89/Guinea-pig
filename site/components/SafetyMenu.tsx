'use client'

import { useState, useTransition } from 'react'
import { REPORT_REASONS, EMERGENCY_LINE, reportAcknowledgement, type ReportReason } from '@/lib/reportReasons'
import { submitReport, submitBlock } from '@/app/(app)/safety-actions'
import type { ReportSubject } from '@/lib/report'

/**
 * Report and block, for chat and for profiles.
 *
 * ── TWO SEPARATE ACTIONS, ON PURPOSE ──────────────────────────────────────
 * Neither path goes through the other. You can report without blocking (you may
 * still have an appointment with them, or want them dealt with rather than just
 * hidden) and you can block without reporting (you owe nobody an explanation
 * for not wanting contact). Coupling them raises the cost of the safety action,
 * which is the opposite of what a safety action should cost.
 *
 * The acknowledgement after a report MENTIONS blocking as a next step. That is
 * an offer, not a step: nothing has been blocked at that point.
 *
 * ── IT MUST WORK WHEN THE OTHER PARTY IS GONE ─────────────────────────────
 * Suspended or deleted. Reports outlive accounts by design (migration 0004) and
 * the UI must not be the half that cannot. A suspended user still has a
 * `public.users` row so nothing special happens; a deleted one resolves to
 * nothing and the server action says so in a sentence, which this renders as-is
 * rather than replacing with "something went wrong".
 *
 * ── WHY THE SUBJECT IS PASSED THROUGH UNTOUCHED ───────────────────────────
 * `{ userId }` or `{ providerId }`, decided by whichever page renders this.
 * This component never unwraps it, so it cannot mix them up.
 */
export function SafetyMenu({
  subject,
  name,
  sessionId = null,
  alreadyBlocked = false,
  align = 'right',
}: {
  subject: ReportSubject
  name: string
  sessionId?: string | null
  alreadyBlocked?: boolean
  align?: 'left' | 'right'
}) {
  const [open, setOpen]       = useState(false)
  const [mode, setMode]       = useState<'menu' | 'report' | 'block' | 'done'>('menu')
  const [chosen, setChosen]   = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<{ title: string; body: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function close() {
    setOpen(false)
    setMode('menu'); setChosen(null); setDetails(''); setError(null); setDone(null)
  }

  function fileReport(reason: ReportReason) {
    setError(null)
    startTransition(async () => {
      const res = await submitReport({
        subject,
        reasonCode: reason.code,
        details,
        sessionId,
      })
      if (!res.ok) { setError(res.error); return }
      setDone(reportAcknowledgement(reason.code))
      setMode('done')
    })
  }

  function doBlock() {
    setError(null)
    startTransition(async () => {
      const res = await submitBlock({ subject })
      if (!res.ok) { setError(res.error); return }
      const n = res.cancelledBookings ?? 0
      setDone({
        title: 'Blocked',
        body: n > 0
          ? `${name} can no longer message you, and ${n} upcoming booking${n === 1 ? ' was' : 's were'} cancelled. ` +
            'Unblocking later won’t bring those bookings back.'
          : `${name} can no longer message you.`,
      })
      setMode('done')
    })
  }

  return (
    <>
      {/* ── WHY THIS IS ROSE AND NOT GREY ──────────────────────────────────
          It was `text-muted` inside a hairline border: grey on white, quieter
          than the "Verified" badge sitting next to it. Micky could not find it
          on his own stylist profile and had to ask where it was — which is the
          test result, not a preference. This is the only route to a
          child-safety report on the web, and it was styled like a footnote.

          `shrink-0` + `ml-auto` pin it to the right of the header row. The row
          is `flex-wrap`, so without shrink-0 it drops onto its own line below
          the name at narrow widths — the one place it is least likely to be
          looked for, on the device most likely to be used in the moment. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-rose/40 px-3 py-1.5 text-sm font-bold text-rose hover:bg-soft-pink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        aria-haspopup="dialog"
        aria-label={`Report or block ${name}`}
      >
        {/* Inline so it cannot fail to load. This site pulls in no icon set and
            no external asset — see the CSP in next.config.ts. */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
        Safety
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Safety options for ${name}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-warm-dark/40 p-0 sm:items-center sm:p-4"
          onClick={e => { if (e.target === e.currentTarget && !pending) close() }}
        >
          <div className={`max-h-[88dvh] w-full overflow-y-auto rounded-t-lg bg-white p-5 shadow-soft sm:max-w-md sm:rounded-lg ${align === 'left' ? 'sm:mr-auto' : ''}`}>

            {/* ── The menu ── */}
            {mode === 'menu' && (
              <>
                <h2 className="font-display text-xl text-warm-dark">{name}</h2>
                <p className="mt-1 text-sm text-muted">
                  Reporting and blocking are separate — doing one never does the other.
                </p>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => setMode('report')}
                    className="w-full rounded-md border border-hairline px-4 py-3 text-left hover:border-rose"
                  >
                    <span className="block font-bold text-warm-dark">Report {name}</span>
                    <span className="block text-sm text-muted">Tell us about a safety or conduct concern.</span>
                  </button>
                  {!alreadyBlocked && (
                    <button
                      type="button"
                      onClick={() => setMode('block')}
                      className="w-full rounded-md border border-hairline px-4 py-3 text-left hover:border-rose"
                    >
                      <span className="block font-bold text-warm-dark">Block {name}</span>
                      <span className="block text-sm text-muted">They won’t be able to message you.</span>
                    </button>
                  )}
                  {alreadyBlocked && (
                    <p className="rounded-md bg-input-bg px-4 py-3 text-sm text-muted">
                      You’ve already blocked this person, or they’ve blocked you. You can undo your own
                      block in Settings.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* ── Pick a reason ── */}
            {mode === 'report' && (
              <>
                <h2 className="font-display text-xl text-warm-dark">What happened?</h2>
                {/* Above the list, not buried under it. We are not an emergency service. */}
                <p className="mt-1 text-sm font-bold text-rose">{EMERGENCY_LINE}</p>

                <ul className="mt-4 space-y-2">
                  {REPORT_REASONS.map(reason => (
                    <li key={reason.code}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          // One tap for seven of the eight. Only "Something
                          // else" needs words, which is what makes the
                          // Community Guidelines claim true.
                          if (reason.requiresDetails) { setChosen(reason); return }
                          setChosen(reason)
                          fileReport(reason)
                        }}
                        className="w-full rounded-md border border-hairline px-4 py-3 text-left hover:border-rose disabled:opacity-50"
                      >
                        <span className="block font-bold text-warm-dark">{reason.label}</span>
                        {reason.hint && <span className="block text-sm text-muted">{reason.hint}</span>}
                      </button>
                    </li>
                  ))}
                </ul>

                {chosen?.requiresDetails && (
                  <div className="mt-4">
                    <label htmlFor="report-details" className="block text-sm font-bold text-warm-dark">
                      Tell us what happened
                    </label>
                    <textarea
                      id="report-details"
                      rows={4}
                      value={details}
                      onChange={e => setDetails(e.target.value)}
                      className="mt-1 w-full rounded-md border border-hairline bg-input-bg px-3 py-2 text-sm text-warm-dark"
                    />
                    <button
                      type="button"
                      disabled={pending || !details.trim()}
                      onClick={() => fileReport(chosen)}
                      className="mt-2 w-full rounded-md bg-rose px-4 py-2.5 font-bold text-white disabled:opacity-50"
                    >
                      {pending ? 'Sending…' : 'Send report'}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Confirm a block ── */}
            {mode === 'block' && (
              <>
                <h2 className="font-display text-xl text-warm-dark">Block {name}?</h2>
                {/* The cancellation is named here because it is PERMANENT and
                    this is the only moment anyone can decline it. `cancelled`
                    is terminal in enforce_session_status_transition. */}
                <p className="mt-2 text-sm text-warm-dark">
                  They won’t be able to message you, and any upcoming bookings between you will be
                  cancelled. Unblocking later won’t bring those bookings back.
                </p>
                <p className="mt-2 text-sm text-muted">
                  Blocking doesn’t tell us anything. If you want someone to look at what happened,
                  report them as well.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setMode('menu')}
                    className="flex-1 rounded-md border border-hairline px-4 py-2.5 font-bold text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={doBlock}
                    className="flex-1 rounded-md bg-rose px-4 py-2.5 font-bold text-white disabled:opacity-50"
                  >
                    {pending ? 'Blocking…' : 'Block'}
                  </button>
                </div>
              </>
            )}

            {/* ── Afterwards ── */}
            {mode === 'done' && done && (
              <>
                <h2 className="font-display text-xl text-warm-dark">{done.title}</h2>
                <p className="mt-2 whitespace-pre-line text-sm text-warm-dark">{done.body}</p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-4 w-full rounded-md bg-rose px-4 py-2.5 font-bold text-white"
                >
                  Done
                </button>
              </>
            )}

            {error && (
              <p role="alert" className="mt-3 rounded-md border border-hairline bg-input-bg px-3 py-2 text-sm text-warm-dark">
                {error}
              </p>
            )}

            {mode !== 'done' && (
              <button
                type="button"
                disabled={pending}
                onClick={close}
                className="mt-4 w-full text-sm font-bold text-muted hover:text-rose"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
