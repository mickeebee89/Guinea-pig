/**
 * Call a server action and never come back with nothing. Audit item 107.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  A SILENT REJECTION IS ITS OWN FAILURE
 * ══════════════════════════════════════════════════════════════════════════
 * Every client component written in this session did the same thing:
 *
 *     start(async () => {
 *       const res = await someServerAction(x)      // <- can THROW
 *       if (!res.ok) { setError(res.error); return }
 *       …
 *     })
 *
 * A server action can reject as well as return `{ ok: false }` — a dropped
 * connection, an exception on the server, or a client bundle older than the
 * deployment it is posting to, which makes Next fail to find the action at
 * all. On every one of those the promise rejects, the handler unwinds, and
 * **nothing is rendered**. The control appears to do nothing whatsoever.
 *
 * Found on /profile's Instagram field on 24 Sep 2026: pasting an email did
 * not save and said nothing. It was not the input discarding the value —
 * there is no client-side check on that field at all — and it was not the
 * refusal going to the wrong place, which item 106 had already fixed. The
 * outcome never arrived, because a throw has nowhere to go.
 *
 * ⚠️ AND IT AFFECTED EVERY ONE OF THEM, not just that field: the bio, the nine
 * attributes, the photo manager, the avatar, the postcode box, the favourite
 * button and the shop details form. Six components, one missing `catch`.
 *
 * ── ⚠️ WHAT MUST STILL BE ALLOWED THROUGH ─────────────────────────────────
 * `redirect()` and `notFound()` work by THROWING, and `requireUser()` calls
 * redirect (supabase-server.ts:86). Swallowing those would mean a member whose
 * session had expired clicked Save and was told "something went wrong" instead
 * of being taken to sign in. They are identified by their `digest` — Next's
 * own convention — and rethrown untouched.
 */

/** Next's control flow, which travels as an exception and must keep travelling. */
function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest
  return typeof digest === 'string'
    && (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
}

export type Outcome = { ok: boolean; error?: string }

/**
 * ⚠️ THE MESSAGE DOES NOT CLAIM NOTHING WAS SAVED, because it cannot know.
 * A throw can happen after the write as easily as before it — an avatar can be
 * in the bucket with the row unwritten. "Nothing has changed" is the
 * comfortable sentence and it would sometimes be a lie, so this says what is
 * actually true: we do not know, go and look.
 */
const UNKNOWN =
  'Something went wrong and we couldn’t tell what. Reload the page to see what saved, then try again.'

export async function attempt<T extends Outcome>(
  work: () => Promise<T>,
  /** For the server log. The member never sees it. */
  label: string,
): Promise<T | { ok: false; error: string }> {
  try {
    const res = await work()
    // A server action that resolves with nothing usable is the same problem
    // wearing a different hat, and it would otherwise read as success.
    if (!res || typeof res.ok !== 'boolean') {
      console.error(`[${label}] action returned nothing usable`, res)
      return { ok: false, error: UNKNOWN }
    }
    return res
  } catch (e) {
    if (isNextControlFlow(e)) throw e
    console.error(`[${label}] action threw`, e)
    return { ok: false, error: UNKNOWN }
  }
}
