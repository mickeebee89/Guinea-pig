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

/**
 * WHAT THE BROWSER IS ALLOWED TO SEND. Audit item 84b, 23 Sep 2026.
 *
 * Three things, and not one of them is wording: which document she was shown,
 * the hash she was shown it under, and which boxes she ticked. The record
 * itself is built on the server from the document — see toAcceptedConsent.
 *
 * WARNING: DO NOT ADD A FIELD TO THIS. Every field here is something a caller
 * can choose, and everything a caller can choose has to be either verified or
 * discarded. The document id is verified (read by id), the hash is verified
 * (compared with the row), and the keys are discarded unless they match a key
 * the document actually has. That is the whole reason it is only three.
 */
export interface AcceptedTicks {
  consent_document_id: string
  content_hash: string
  ticked_keys: string[]
}

/**
 * The other half of the contract, for a server action that receives the form.
 *
 * ⚠️ Returns null rather than throwing, and null must be treated as "refuse
 * the application". It reads the three fields; it does not verify any of them.
 * The caller must still call reReadConsentDocument(), and must build the
 * record from the document that returns — never from anything in here.
 *
 * There is nothing to JSON.parse any more, and that is the change: this used
 * to hand back a `payload` of unknown shape that went on to become the stored
 * wording (item 84b).
 */
export function readConsentFields(form: FormData): AcceptedTicks | null {
  const documentId = String(form.get('consent_document_id') ?? '')
  const hash = String(form.get('consent_hash') ?? '')
  if (!documentId || !hash) return null
  return {
    consent_document_id: documentId,
    content_hash: hash,
    // Keys only. A key the document does not have is ignored when the record
    // is rebuilt, so this needs no validation of its own.
    ticked_keys: String(form.get('ticked_keys') ?? '')
      .split(',').map(k => k.trim()).filter(Boolean),
  }
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
 * ⚠️ NEVER SENT, AND IT CANNOT BE: THE FUNCTION HAS NO SUCH PARAMETER.
 *
 * The web's first real application failed with PGRST202 because its call
 * carried p_device_info. The live signature is sixteen arguments, one
 * overload, and p_device_info is not among them.
 *
 * ── WHY IT IS NOT THERE, WHICH IS THE PART THAT MATTERS ───────────────────
 * ~~It is absent, so the Privacy claim is true "by absence, not by choice".~~
 * CORRECTED 23 Sep 2026. It was ENTIRELY a choice, taken on 9 Aug 2026 and
 * argued at length in migration 0010, which dropped the parameter AND the
 * session_consents.device_info column. Its five reasons are worth reading
 * before anyone adds this back: the contested fact is WHAT was agreed and
 * content_hash answers that; an IP does not identify a person; device info is
 * self-reported and unattested, so it proves nothing in the only case where
 * it would matter; collecting it only on web would build a two-tier record
 * whose weaker tier is the common one; and UK GDPR Art. 5(1)(c).
 *
 * 0010 flags it for the solicitor as a small migration to reverse if they
 * weigh evidential value differently. So this is a recorded decision with an
 * argument attached, not a gap — and it is reversible deliberately.
 *
 * Kept, unused, so that if a parameter ever comes back it carries the platform
 * and nothing else: mobile records device details, and matching it would make
 * a published statement false.
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

export type ConsentReRead =
  | { ok: true; doc: ConsentDocument }
  /** The row exists and its hash has changed: the text moved under the reader. */
  | { ok: false; reason: 'moved' }
  /** The row could not be read at all. Not her fault, and not re-tickable. */
  | { ok: false; reason: 'unreadable' }

/**
 * At submit: re-read the document the browser says it showed, BY ID, and
 * confirm the hash still matches.
 *
 * ⚠️ IT MUST NEVER ASK FOR "THE ACTIVE DOCUMENT" INSTEAD. That is the race
 * this exists to close: a version going active while she reads would record
 * consent against text she never saw.
 *
 * ⚠️ IT RETURNS THE DOCUMENT, AND THAT IS THE POINT (item 84b). It used to
 * return a boolean, `consentStillCurrent`, and the record was then built from
 * the browser's own copy of the wording — so the server proved the text had
 * not changed and then wrote down a version of it that it never looked at.
 * Whatever is recorded is now taken from THIS document, which is the one the
 * hash was verified against.
 */
export async function reReadConsentDocument(
  supabase: SupabaseClient,
  documentId: string,
  shownHash: string,
): Promise<ConsentReRead> {
  if (!documentId || !shownHash) return { ok: false, reason: 'unreadable' }
  const { data, error } = await supabase
    .from('consent_documents')
    .select(SELECT)
    .eq('id', documentId)
    .maybeSingle()
  if (error) {
    console.error('[consent] could not re-read the document at submit', {
      code: error.code, message: error.message,
    })
    return { ok: false, reason: 'unreadable' }
  }
  // No row for an id the page itself issued minutes ago: deleted, or filtered.
  // Either way there is nothing to verify against, so it is not 'moved'.
  if (!data) return { ok: false, reason: 'unreadable' }

  const doc = shape(data)
  if (doc.contentHash !== shownHash) return { ok: false, reason: 'moved' }
  return { ok: true, doc }
}

/**
 * The payload for the RPC, BUILT FROM THE DOCUMENT.
 *
 * EVERY acknowledgement is recorded, not only the ticked ones, so the row
 * shows the whole document as presented rather than a filtered view of it.
 * Items that need no tick are recorded as agreed, which is what "notice"
 * means. Same rule as mobile's handleContinue.
 *
 * ⚠️ ON THE WEB THIS RUNS ON THE SERVER, AND `doc` MUST BE THE RE-READ ROW
 * (item 84b, 23 Sep 2026). It used to run in the browser, inside ConsentGate,
 * and its output was posted back as JSON — so the wording that went into a
 * six-year record was the browser's copy of it, editable by whoever sent it.
 * `tickedKeys` is the only part that may come from the client, and a key that
 * is not in the document is ignored here by construction: this maps over the
 * DOCUMENT's acknowledgements and merely asks the set whether each was ticked.
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
