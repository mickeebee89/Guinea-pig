/**
 * The Instagram handle: one rule, used on the way in AND on the way out.
 * Audit item 102.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AN EMAIL ADDRESS WAS STORED HERE AND PUBLISHED TO EVERY SIGNED-IN MEMBER
 * ══════════════════════════════════════════════════════════════════════════
 * Found live on 24 Sep 2026: a model's profile rendered
 * "@someone.something@gmail.com" where the handle goes. Nothing had ever
 * checked the field — not either client, not the database.
 *
 * ⚠️ THE WEB SHOWS IT AS TEXT. **MOBILE MAKES IT A LINK** and opens
 * `https://instagram.com/<value>` (model/[id].tsx:506). With an email address
 * in the column that URL carries the address in its PATH — to Instagram's
 * servers, into their logs, and into the device's browser history. A field
 * nobody validated turned into a way of handing a member's email to a third
 * party by tapping their profile.
 *
 * ── WHY THE RULE IS USED TWICE, NOT ONCE ──────────────────────────────────
 * Validating the write only protects values written AFTER the fix. The column
 * already holds whatever four months of unvalidated writes put there, and
 * mobile can still write more until it gets the same rule. **So the renderer
 * checks too**: a value that fails is not shown at all.
 *
 * The edit screen is the deliberate exception — it shows her the stored value
 * even when it fails, because a value she cannot see is one she cannot clear.
 */

/**
 * Instagram's own rule: 1–30 characters, letters, numbers, full stops and
 * underscores. Deliberately not stricter — a handle we refuse is a real person
 * unable to enter their real handle, which is worse than a handle that turns
 * out to lead nowhere.
 *
 * It is strict enough for the case that mattered: an email address fails on
 * the `@` in the middle, and on the `-` and `+` characters that addresses use.
 */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/

/** True when this value is safe to show and safe to put in a URL. */
export function isValidInstagramHandle(value: string | null | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  // Instagram rejects both of these, and a leading dot in a path is the kind
  // of thing that ends up meaning something else somewhere.
  if (v.startsWith('.') || v.endsWith('.')) return false
  return HANDLE.test(v)
}

export type InstagramParse =
  | { ok: true; handle: string | null }   // null means "cleared"
  | { ok: false; error: string }

/**
 * Take what she typed and turn it into a handle, or refuse it.
 *
 * Accepts, matching mobile's own leniency (model-profile.tsx:674) so the two
 * clients take the same input:
 *   * a bare handle            `cavybeauty`
 *   * with a leading @         `@cavybeauty`
 *   * a pasted profile URL     `https://instagram.com/cavybeauty?igsh=…`
 *   * empty                    clears it
 *
 * Everything else is refused, WITH THE RULE IN THE MESSAGE. "That doesn't look
 * right" tells someone nothing about what to type instead.
 */
export function parseInstagram(input: string): InstagramParse {
  const raw = input.trim()
  if (raw === '') return { ok: true, handle: null }

  // A pasted link, in any of the forms the app actually gets handed.
  const urlMatch = raw.match(/instagram\.com\/([^/?#]+)/i)
  const candidate = (urlMatch ? urlMatch[1] : raw.replace(/^@/, '')).trim()

  if (candidate === '') return { ok: true, handle: null }

  if (!isValidInstagramHandle(candidate)) {
    return {
      ok: false,
      error:
        'That doesn’t look like an Instagram username. Use just the username — letters, ' +
        'numbers, full stops and underscores — or paste the link to your profile. ' +
        'Don’t put an email address here: it would be shown to anyone who opens your profile.',
    }
  }

  return { ok: true, handle: candidate }
}
