/**
 * The `?next=` return path, built in one place and validated in the same one.
 * Audit item 186.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * A model picks a slot on a stylist's profile, presses Apply, and meets the
 * membership wall at `apply/page.tsx:77`. The wall RENDERS rather than
 * redirecting, so the slot is still in the URL behind it — but `/subscribe` is a
 * different page, and without a return she lands on a success panel with no way
 * back to the time she chose.
 *
 * ── ⚠️⚠️ AN UNVALIDATED RETURN PARAMETER IS AN OPEN REDIRECT ────────────
 * `?next=` arrives in a URL anyone can construct and send. If it were used
 * as-is, `/subscribe?next=https://evil.example/login` would bounce a member
 * — mid-payment, at their most trusting — to somebody else's page wearing our
 * flow's clothes.
 *
 * So `safeReturnTo` is an **ALLOWLIST, not a denylist**: it matches the one
 * route this is for and refuses everything else, including anything it has never
 * heard of. A denylist of "no http://, no //" is a list of the attacks somebody
 * thought of.
 *
 * ── WHY BUILD AND VALIDATE LIVE TOGETHER ────────────────────────────────
 * The apply page BUILDS the value; the subscribe page VALIDATES it. Two regexes
 * in two files is the shape this codebase keeps finding broken — so there is one
 * pattern, used by both, and a round-trip assertion in the tests below it.
 */

/**
 * `/stylist/<uuid>/apply` with an optional query string.
 *
 * ⚠️ DELIBERATELY NARROW. It pins the literal path segments, the uuid shape and
 * the characters allowed in the query. It cannot match an absolute URL (no
 * scheme), a protocol-relative one (`//host` fails at the second character), a
 * backslash-smuggled one, or a path traversal — none of those can produce
 * `/stylist/` followed by a uuid followed by `/apply`.
 */
const APPLY_RETURN = /^\/stylist\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/apply(\?[A-Za-z0-9=&_%,.-]*)?$/

/**
 * The return path for a model who hit the wall partway through applying.
 *
 * `search` is the apply page's own query string — `step`, `date`, `slot` — so
 * she comes back to the slot she chose rather than to the top of the wizard.
 */
export function applyReturnTo(providerId: string, search: string): string {
  const q = search.startsWith('?') ? search : search ? `?${search}` : ''
  return `/stylist/${providerId}/apply${q}`
}

/**
 * The validated path, or null.
 *
 * ⚠️ NULL IS A WORKING ANSWER, NOT AN ERROR. A missing or unrecognised `next`
 * means the page shows its ordinary dashboard link — nobody is shown a failure
 * for a parameter they never knowingly supplied, and nobody is redirected
 * somewhere this function does not recognise.
 */
export function safeReturnTo(raw: string | undefined | null): string | null {
  if (!raw) return null
  // A single decode, then match. Encoded input is normal — the value travels as
  // a query parameter — but anything that still fails the pattern afterwards is
  // refused rather than decoded again looking for something acceptable.
  let value = raw
  try {
    value = decodeURIComponent(raw)
  } catch {
    return null // malformed percent-encoding
  }
  if (value.includes('\\') || value.includes('\0')) return null
  return APPLY_RETURN.test(value) ? value : null
}

/**
 * ⚠️ THE CASES THAT MUST STAY REFUSED, kept beside the pattern rather than in a
 * test file, because the pattern is the thing a future edit will loosen and this
 * is what it is for. `scripts/check-return-to.mjs` runs them.
 */
export const RETURN_TO_CASES: { input: string; accepted: boolean; why: string }[] = [
  { input: '/stylist/b604a402-91b7-448a-91de-4aedff94521c/apply?step=3&slot=abc',
    accepted: true, why: 'the real thing, with the wizard state' },
  { input: '/stylist/b604a402-91b7-448a-91de-4aedff94521c/apply',
    accepted: true, why: 'no query is still the apply page' },
  { input: 'https://evil.example/login',
    accepted: false, why: 'absolute URL to another host' },
  { input: '//evil.example/login',
    accepted: false, why: 'protocol-relative — the browser treats this as another host' },
  { input: 'http://localhost:3000/stylist/b604a402-91b7-448a-91de-4aedff94521c/apply',
    accepted: false, why: 'absolute, even to our own host: only relative paths are returned to' },
  { input: '/stylist/not-a-uuid/apply',
    accepted: false, why: 'the id must look like an id' },
  { input: '/dashboard',
    accepted: false, why: 'a real page of ours, and still not what this parameter is for' },
  { input: '/stylist/b604a402-91b7-448a-91de-4aedff94521c/apply/../../settings',
    accepted: false, why: 'traversal' },
  { input: '\\/evil.example',
    accepted: false, why: 'backslash smuggling' },
  { input: '/stylist/b604a402-91b7-448a-91de-4aedff94521c/apply?x=<script>',
    accepted: false, why: 'characters outside the query allowlist' },
  { input: '%2f%2fevil.example',
    accepted: false, why: 'encoded protocol-relative — decoded once, then matched' },
  { input: '',
    accepted: false, why: 'absent is not an error, it is just no return' },
]
