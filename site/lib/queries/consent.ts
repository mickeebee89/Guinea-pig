import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The consent document a model agrees to before applying. Audit item 80.
 * Ported from mobile/src/components/ConsentGate.tsx, deliberately faithfully.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ONE PROPERTY THIS FILE EXISTS TO PROTECT
 * ══════════════════════════════════════════════════════════════════════════
 * `session_consents` records a content_hash, and that hash is only worth
 * anything if it is the hash OF THE TEXT THE PERSON READ. The hash is computed
 * in the database, by set_consent_hash() over title || body ||
 * acknowledgements::text (schema snapshot :189). Nothing here recomputes it:
 * it is read from the row that was rendered and passed through untouched.
 *
 * So every rule below is a way of saying the same thing — do not let the text
 * shown and the hash recorded come apart:
 *
 *   1. RENDER THE DOCUMENT, NEVER A COPY OF IT. No hardcoded fallback, ever.
 *      Mobile's header records why: a hardcoded gate silently diverged from an
 *      active v1 that had been live since June and was never shown to anyone.
 *   2. RENDER IT WHOLE AND RAW. Plain text, whitespace preserved, every
 *      acknowledgement including the ones that need no tick. The hash covers
 *      the lot; markdown, truncation or a "read more" means the shown text is
 *      not the hashed text.
 *   3. NEVER RE-FETCH "THE ACTIVE DOCUMENT" AT SUBMIT. A version going active
 *      while someone reads would record consent to text they never saw. Submit
 *      re-reads BY ID — see consentStillCurrent below.
 *   4. FAIL CLOSED. No active document, a failed read, or a document with
 *      nothing to tick all block the application.
 *   5. DO NOT CACHE. The page that renders this must be dynamic: a cached
 *      document would outlive a deactivation.
 *
 * ── THE WEB IS NOT MOBILE, IN ONE WAY THAT MATTERS ────────────────────────
 * Mobile hands the fetched document straight to the RPC, and trusts itself to.
 * A browser cannot be trusted with the same job: anything posted back can be
 * edited. So the browser posts the document's ID and the hash it was shown,
 * and the server re-reads that row and refuses if the two disagree.
 */

export interface ConsentAck {
  key: string
  requires_tick: boolean
  /** Some items carry `title` instead of `text`; both are rendered as-is. */
  text?: string | null
  title?: string | null
}

export interface ConsentDocument {
  id: string
  version: number
  title: string
  body: string
  contentHash: string
  acknowledgements: ConsentAck[]
}

/** What the RPC needs, in the shape create_session_with_consent takes. */
export interface AcceptedConsent {
  consent_document_id: string
  consent_version: number
  content_hash: string
  acknowledgements: { key: string; text: string; agreed: boolean }[]
}

/**
 * Device info for session_consents.
 *
 * ⚠️ Deliberately just the platform. Mobile records device details; Privacy
 * publishes that we record no device information and that claim currently
 * holds (audit: "no IP or device recorded" is listed among the things that do).
 * Matching mobile exactly here would make a published statement false, so it
 * does not.
 */
export const CONSENT_DEVICE_INFO = { platform: 'web' } as const

export type ConsentLoad =
  | { ok: true; doc: ConsentDocument }
  | { ok: false; reason: string }

const SELECT = 'id, version, title, body, content_hash, acknowledgements'

/** The wording a model sees when consent cannot be shown. Blocking, in every case. */
const UNAVAILABLE =
  'We can’t show the terms you’d be agreeing to right now, so applications are paused. Please try again shortly.'

export async function loadActiveConsentDocument(
  supabase: SupabaseClient,
): Promise<ConsentLoad> {
  const { data, error } = await supabase
    .from('consent_documents')
    .select(SELECT)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[consent] could not read the active document', { code: error.code, message: error.message })
    return { ok: false, reason: UNAVAILABLE }
  }
  if (!data) {
    // Not a network problem: nothing is marked active. Blocking is correct —
    // a booking with no consent record is the hole this whole flow closes.
    console.error('[consent] no active consent document')
    return { ok: false, reason: UNAVAILABLE }
  }

  const doc = shape(data)
  if (!doc.acknowledgements.some(a => a.requires_tick)) {
    console.error('[consent] active document has nothing to tick', { id: doc.id, version: doc.version })
    return { ok: false, reason: UNAVAILABLE }
  }
  return { ok: true, doc }
}

/**
 * At submit: is the document the browser says it read still that document?
 *
 * ⚠️ Reads BY ID and compares the hash. It must never ask for "the active
 * document" instead — that is the race this exists to close. A false answer
 * means the text changed under the reader, and the application must be
 * refused and the new document shown, not quietly recorded against.
 */
export async function consentStillCurrent(
  supabase: SupabaseClient,
  documentId: string,
  shownHash: string,
): Promise<boolean> {
  if (!documentId || !shownHash) return false
  const { data, error } = await supabase
    .from('consent_documents')
    .select('id, content_hash')
    .eq('id', documentId)
    .maybeSingle()
  if (error || !data) return false
  return (data as { content_hash: string }).content_hash === shownHash
}

/**
 * The payload for the RPC.
 *
 * EVERY acknowledgement is recorded, not only the ticked ones, so the row
 * shows the whole document as presented rather than a filtered view of it.
 * Items that need no tick are recorded as agreed, which is what "notice"
 * means. Same rule as mobile's handleContinue.
 */
export function toAcceptedConsent(
  doc: ConsentDocument,
  tickedKeys: string[],
): AcceptedConsent {
  const ticked = new Set(tickedKeys)
  return {
    consent_document_id: doc.id,
    consent_version: doc.version,
    content_hash: doc.contentHash,
    acknowledgements: doc.acknowledgements.map(a => ({
      key: a.key,
      text: ackText(a),
      agreed: a.requires_tick ? ticked.has(a.key) : true,
    })),
  }
}

/** Are all the tickable items ticked? Nothing may be pre-ticked. */
export function allRequiredTicked(doc: ConsentDocument, tickedKeys: string[]): boolean {
  const ticked = new Set(tickedKeys)
  const required = doc.acknowledgements.filter(a => a.requires_tick)
  return required.length > 0 && required.every(a => ticked.has(a.key))
}

/** The text of one acknowledgement, exactly as stored. Never reworded here. */
export function ackText(a: ConsentAck): string {
  return a.text ?? a.title ?? a.key
}

function shape(row: unknown): ConsentDocument {
  const r = row as {
    id: string; version: number; title: string | null; body: string | null
    content_hash: string; acknowledgements: ConsentAck[] | null
  }
  return {
    id: r.id,
    version: r.version,
    // The hash covers these exactly as they are stored, so they are not
    // trimmed, defaulted or tidied on the way out.
    title: r.title ?? '',
    body: r.body ?? '',
    contentHash: r.content_hash,
    acknowledgements: r.acknowledgements ?? [],
  }
}
