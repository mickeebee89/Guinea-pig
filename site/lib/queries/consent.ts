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

/**
 * ⚠️ TWO SHAPES IN ONE ARRAY, AND THEY ARE NOT INTERCHANGEABLE.
 *
 * v2's ticks carry `text`. Its NOTICES carry `title` + `body` + `icon` and no
 * `text` at all (migration 0001:131-151). A renderer that reads
 * `text ?? title ?? key` therefore shows a notice's heading and silently drops
 * its entire paragraph — which is what this file did on 23 Sep, before any
 * page existed to show it. The hash would have gone on claiming she read the
 * paragraph.
 *
 * So every text-bearing field is listed here, and ackParts() below is the ONLY
 * way to turn one of these into something on screen. Adding a field to a future
 * document without adding it here is caught at load time, loudly — see
 * UNKNOWN_ACK_FIELDS.
 */
export interface ConsentAck {
  key: string
  requires_tick: boolean
  /** The tick's own sentence. Absent on notices. */
  text?: string | null
  /** A notice's heading. Absent on ticks. */
  title?: string | null
  /** A notice's paragraph. THE PART THAT WENT MISSING. */
  body?: string | null
  /** Mobile draws an Ionicon; the web does not, and dropping it shows nothing. */
  icon?: string | null
}

/** Every field the renderer knows how to show. Anything else is a warning. */
const KNOWN_ACK_FIELDS = new Set(['key', 'requires_tick', 'text', 'title', 'body', 'icon'])

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
 * ⚠️ NOT CURRENTLY SENT, AND THE RECORD SAYING OTHERWISE WAS CORRECTED.
 * The web's first real application failed with PGRST202 because its RPC call
 * carried p_device_info and p_category_id, and no overload matched the
 * resulting argument set. The call now sends the fifteen arguments the
 * installed app has been booking with, which are the only ones with live
 * evidence behind them, and those two are omitted until the live signature
 * has been read.
 *
 * Kept here, unused, because the DECISION behind it still stands and should
 * not have to be made again: if this ever goes back, it is the platform and
 * nothing else. Mobile records device details; Privacy publishes that we
 * record no device information, and that claim is one of the few the audit
 * found holding. Matching mobile exactly would make a published statement
 * false.
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
  warnOnUnrenderedFields(doc)
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

/**
 * What the RECORD calls this acknowledgement — heading only, matching mobile's
 * handleContinue exactly so both clients write the same shape into
 * session_consents. Deliberately NOT what is rendered: see ackParts.
 */
export function ackText(a: ConsentAck): string {
  return a.text ?? a.title ?? a.key
}

/**
 * Everything this acknowledgement has to say, for the screen.
 *
 * A tick is one sentence. A notice is a heading and a paragraph, and BOTH must
 * appear: the hash covers them, so showing one without the other is a record
 * that claims more was read than was shown.
 */
export function ackParts(a: ConsentAck): { heading: string; body: string | null } {
  const heading = a.requires_tick
    ? (a.text ?? a.title ?? a.key)
    : (a.title ?? a.text ?? a.key)
  // A tick with a body would be unusual, and it would still be rendered — the
  // rule is "show everything the document carries", not "show what v2 had".
  const body = a.body && a.body !== heading ? a.body : null
  return { heading, body }
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

/**
 * ⚠️ THE CANARY. A future document version that adds a field this renderer does
 * not know about would show less than the hash describes, silently — the exact
 * failure that lost the notices' bodies. It cannot be caught by types, because
 * the column is jsonb and the document is data.
 *
 * It logs rather than blocks: refusing to show a consent document because it
 * gained a field would stop every application over a copy change, which is a
 * worse outcome than a server log nobody reads for a day. Fail closed is for
 * "we cannot show it at all"; this is "we may be showing less of it".
 */
function warnOnUnrenderedFields(doc: ConsentDocument): void {
  for (const a of doc.acknowledgements) {
    const unknown = Object.keys(a).filter(k => !KNOWN_ACK_FIELDS.has(k))
    if (unknown.length > 0) {
      console.error(
        '[consent] acknowledgement carries fields this page does not render — it may be showing less than the hash covers',
        { document: doc.id, version: doc.version, key: a.key, unknown },
      )
    }
  }
}
