'use client'

import { useState } from 'react'
import {
  ackParts,
  allRequiredTicked,
  type AcceptedTicks,
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
  onAccept?: (accepted: AcceptedTicks) => void
}) {
  const [ticked, setTicked] = useState<string[]>([])

  const ticks = doc.acknowledgements.filter(a => a.requires_tick)
  const notices = doc.acknowledgements.filter(a => !a.requires_tick)
  const ready = allRequiredTicked(doc, ticked)

  const toggle = (key: string) =>
    setTicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))

  /**
   * WARNING: THIS IS EVERYTHING THE BROWSER IS ALLOWED TO SAY (item 84b).
   *
   * Which document, under which hash, and which boxes. No wording, no version,
   * no `agreed` flags — all of those are rebuilt on the server from the
   * document it re-reads. Until 23 Sep 2026 this component called
   * toAcceptedConsent() and posted the whole record as JSON, which meant the
   * text in a six-year evidence row was the browser's copy of it.
   */
  const accepted = (): AcceptedTicks => ({
    consent_document_id: doc.id,
    content_hash: doc.contentHash,
    ticked_keys: ticked,
  })

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

      {/* Which document, and which boxes. The server re-reads the document by
          this id, checks this hash against it, and builds the record from the
          row — so none of this is trusted, and none of it is wording.
          In onAccept mode the caller carries the same three instead. */}
      {!onAccept && (
        <>
          <input type="hidden" name="consent_document_id" value={doc.id} />
          <input type="hidden" name="consent_hash" value={doc.contentHash} />
          <input type="hidden" name="ticked_keys" value={ticked.join(',')} />
        </>
      )}

      <button
        type={onAccept ? 'button' : 'submit'}
        onClick={onAccept ? () => onAccept(accepted()) : undefined}
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
