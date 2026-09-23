/**
 * Slot prices. Audit item 79.
 *
 * ── THREE STATES, NEVER TWO ────────────────────────────────────────────────
 *   null → the stylist has not said     "Price not set"
 *   0    → the stylist has said: free   "Free"
 *   n    → £n/100
 *
 * Merging the first two is the mistake this file exists to prevent. Every slot
 * that existed before 0050 has no price, and rendering those as "Free" would
 * publish a promise on behalf of a stylist who has never seen the feature.
 *
 * Pence, integer, like verification_payments.amount_pence. Money in a float is
 * how £14.99 becomes £14.989999999999998.
 *
 * ⚠️ mobile/src/lib/price.ts is this file, twice. The three apps share no code
 * — separate package.json, no workspace linkage (CLAUDE.md) — so the copies are
 * deliberate and must be changed together. The cap lives in the DATABASE
 * (availability_price_pence_range, 0050); these two are the friendly message.
 */

/** £100, matching the CHECK constraint in 0050. */
export const MAX_PRICE_PENCE = 10_000

/** What a model sees. `short` drops "Price not set" to nothing, for tight rows. */
export function formatPrice(pence: number | null | undefined): string | null {
  if (pence === null || pence === undefined) return null
  if (pence === 0) return 'Free'
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`
}

/** For a stylist's own editor: never blank, because "not set" is a real answer. */
export function formatPriceLong(pence: number | null | undefined): string {
  return formatPrice(pence) ?? 'Price not set'
}

/** The editor's text box holds pounds. '' means "not set", and stays null. */
export function poundsToPence(input: string): { ok: true; pence: number | null } | { ok: false; error: string } {
  const raw = input.trim().replace(/^£/, '')
  if (raw === '') return { ok: true, pence: null }
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, error: 'Use a number, like 25 or 12.50.' }
  }
  const pence = Math.round(Number(raw) * 100)
  if (pence > MAX_PRICE_PENCE) return { ok: false, error: 'The most a slot can be is £100.' }
  return { ok: true, pence }
}

/** Pence back into what the box shows. Whole pounds lose the .00. */
export function penceToPounds(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return ''
  return pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2)
}
