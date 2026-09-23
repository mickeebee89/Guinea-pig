'use client'

import { useState } from 'react'
import {
  ackParts,
  allRequiredTicked,
  toAcceptedConsent,
  type ConsentDocument,
} from '@/lib/queries/consent'

/**
 * "Before you apply" — the document, the ticks, and nothing else.
 * Audit item 80. The web half of mobile/src/components/ConsentGate.tsx.
 *
 * ── WHAT IT RENDERS ───────────────────────────────────────────────────────
 * The document's own title, its body as plain text with the whitespace it was
 * written with, and EVERY acknowledgement — the ones that need a tick as
 * checkboxes, the ones that do not as notices. The hash recorded against this
 * application covers all of that, so leaving any of it out, or restyling the
 * text into markdown, would mean the hash no longer describes what was read.
 *
 * ⚠️ A NOTICE IS A HEADING AND A PARAGRAPH. This component shipped on 23 Sep
 * rendering only the heading, because it read every acknowledgement through
 * `text ?? title ?? key` — and v2's notices have no `text`, only `title` and
 * `body` (0001:131-151). Three paragraphs a model is told she has read would
 * never have appeared. Everything now goes through ackParts(), which is the
 * one place that decides what an acknowledgement looks like.
 *
 * Nothing is pre-ticked, and the document is never summarised.
 *
 * ── HOW IT HANDS OVER ─────────────────────────────────────────────────────
 * It lives inside the caller's <form action={…}> and contributes three hidden
 * fields plus its own submit button:
 *
 *   consent_document_id   which document
 *   consent_hash          the hash OF THE TEXT ON SCREEN
 *   consent_payload       the full acknowledgement record, as JSON
 *
 * The server action must re-read the document by that id and refuse if the
 * hash has moved — consentStillCurrent() in lib/queries/consent.ts. The
 * browser is not trusted with any of this; it is trusted only to say what it
 * was shown, which the server then checks.
 */
export function ConsentGate({
  doc,
  submitLabel = 'Agree and send my application',
  pending = false,
  disabled = false,
  onAccept,
}: {
  doc: ConsentDocument
  submitLabel?: string
  pending?: boolean
  /** The caller's own reasons for not being ready — a missing slot, say. */
  disabled?: boolean
  /**
   * Mobile's shape: hand the ticked document UP and let the caller carry it to
   * the end (ConsentGate.tsx:196-207). Used by the wizard, where consent is
   * step 6 and sending is step 7 — the hidden fields below would unmount in
   * between, and a consent record that vanished on the way to the button is
   * the one failure this component exists to prevent.
   *
   * Without it, this renders the hidden fields and its own submit button, for
   * a caller that is already a <form>.
   */
  onAccept?: (accepted: ReturnType<typeof toAcceptedConsent>) => void
}) {
  const [ticked, setTicked] = useState<string[]>([])

  const ticks = doc.acknowledgements.filter(a => a.requires_tick)
  const notices = doc.acknowledgements.filter(a => !a.requires_tick)
  const ready = allRequiredTicked(doc, ticked)

  const toggle = (key: string) =>
    setTicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))

  return (
    <section className="rounded-lg border border-hairline bg-white p-5">
      <h2 className="font-display text-xl text-warm-dark">{doc.title}</h2>

      {/* The body, as written. `whitespace-pre-wrap` keeps the paragraphing the
          hash was computed over; nothing is parsed or re-flowed. */}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-warm-dark">
        {doc.body}
      </p>

      {notices.length > 0 && (
        <ul className="mt-4 space-y-2">
          {notices.map(a => {
            const { heading, body } = ackParts(a)
            return (
              <li key={a.key} className="rounded-md bg-input-bg px-3 py-2">
                <p className="text-sm font-bold text-warm-dark">{heading}</p>
                {body && <p className="mt-1 text-sm text-muted">{body}</p>}
              </li>
            )
          })}
        </ul>
      )}

      <fieldset className="mt-5">
        <legend className="text-xs font-bold uppercase tracking-widest text-muted">
          Please tick each one
        </legend>
        <ul className="mt-2 space-y-3">
          {ticks.map(a => (
            <li key={a.key}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={ticked.includes(a.key)}
                  onChange={() => toggle(a.key)}
                  className="mt-0.5 size-5 shrink-0 accent-rose"
                />
                <span className="text-sm text-warm-dark">
                  {ackParts(a).heading}
                  {/* A tick with a paragraph would be unusual — and it would
                      still be shown, because the rule is "everything the
                      document carries", not "everything v2 happened to have". */}
                  {ackParts(a).body && (
                    <span className="mt-1 block text-muted">{ackParts(a).body}</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {/* What the server will be told it showed. Checked there, never trusted.
          In onAccept mode the caller carries these instead. */}
      {!onAccept && (
        <>
          <input type="hidden" name="consent_document_id" value={doc.id} />
          <input type="hidden" name="consent_hash" value={doc.contentHash} />
          <input
            type="hidden"
            name="consent_payload"
            value={JSON.stringify(toAcceptedConsent(doc, ticked))}
          />
        </>
      )}

      <button
        type={onAccept ? 'button' : 'submit'}
        onClick={onAccept ? () => onAccept(toAcceptedConsent(doc, ticked)) : undefined}
        disabled={!ready || pending || disabled}
        className="mt-6 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
      >
        {pending ? 'Sending…' : submitLabel}
      </button>

      {!ready && (
        <p className="mt-2 text-xs text-muted">
          Tick all {ticks.length} to continue.
        </p>
      )}

      <p className="mt-4 text-xs text-muted">
        Version {doc.version}. We keep a record of this exact wording with your application.
      </p>
    </section>
  )
}

/**
 * The other half of the contract, for the server action that receives the form.
 *
 * ⚠️ Returns null rather than throwing, and null must be treated as "refuse the
 * application". The caller still has to call consentStillCurrent() — this only
 * checks that the browser sent something shaped like consent, not that it is
 * the consent that is currently on file.
 */
export function readConsentFields(form: FormData): {
  documentId: string
  hash: string
  payload: unknown
} | null {
  const documentId = String(form.get('consent_document_id') ?? '')
  const hash = String(form.get('consent_hash') ?? '')
  const raw = String(form.get('consent_payload') ?? '')
  if (!documentId || !hash || !raw) return null
  try {
    return { documentId, hash, payload: JSON.parse(raw) }
  } catch {
    return null
  }
}
