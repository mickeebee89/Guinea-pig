/**
 * check-unsubscribe-route.mjs — is the unsubscribe link live on the website?
 * Audit item 74.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * On 22 Sep 2026 the test email arrived with an unsubscribe link that 404'd,
 * because the site deploy carrying `/email/unsubscribe` had not landed while
 * the edge function was already sending. Every notification email would have
 * shipped the same broken link.
 *
 * The email and the website deploy separately and neither knows about the
 * other, so nothing could have caught it. This is that missing check, and it
 * runs at the one moment that matters: `install-email-secret.mjs` is what ARMS
 * the system — before it, every trigger call is refused for want of the shared
 * secret. So the system cannot be armed while the link it will print is dead.
 *
 * Both addresses are checked, because an email carries two:
 *   * the visible link → the page, which asks before it acts;
 *   * the List-Unsubscribe header → /confirm, which Gmail and Yahoo POST to.
 * A check of only the visible one would have missed half of it.
 */

const SITE = 'https://cavybeauty.com'

/** Never a real token: this is a liveness check, not an unsubscribe. */
const PROBE = 'preflight-not-a-token'

async function status(url, redirect) {
  try {
    // HEAD, so a GET handler that does work never runs. Next.js answers HEAD
    // for a page with the same status as GET.
    const res = await fetch(url, { method: 'HEAD', redirect })
    return res.status
  } catch (e) {
    return `unreachable (${e?.cause?.code ?? e?.code ?? 'network error'})`
  }
}

/**
 * Returns null when both addresses are live, or a printable reason when they
 * are not. Never throws: the caller decides what to do about it.
 */
export async function unsubscribeRouteProblem() {
  const pageUrl = `${SITE}/email/unsubscribe?t=${PROBE}`
  // The header points here, and a GET of it redirects to the page — so a
  // redirect is a pass, and only a 404 or a server error is a failure.
  const confirmUrl = `${SITE}/email/unsubscribe/confirm?t=${PROBE}`

  const [page, confirm] = await Promise.all([
    status(pageUrl, 'follow'),
    status(confirmUrl, 'manual'),
  ])

  const pageOk = page === 200
  const confirmOk = typeof confirm === 'number' && confirm < 400
  if (pageOk && confirmOk) return null

  return [
    'The unsubscribe link is not live on the website yet.',
    `  visible link        ${pageUrl}  →  ${page}${pageOk ? '' : '   ← must be 200'}`,
    `  List-Unsubscribe    ${confirmUrl}  →  ${confirm}${confirmOk ? '' : '   ← must be under 400'}`,
    '',
    'Both come from site/app/email/unsubscribe/. A 404 means the Vercel',
    'production deploy carrying them has not landed — check the deployment for',
    'the latest commit on main, then run this again.',
  ].join('\n')
}
