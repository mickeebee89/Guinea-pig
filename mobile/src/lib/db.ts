/**
 * Write helpers that FAIL LOUDLY.
 *
 * ── The problem this exists to solve ────────────────────────────────────────
 * supabase-js does not reject when the database refuses a write. It resolves
 * with `{ data: null, error }`. So this, which appears all over the app, is a
 * lie:
 *
 *     try {
 *       await supabase.from('sessions').update({ status: 'accepted' })…
 *       showSuccess()            // ← always runs
 *     } catch {
 *       showError()              // ← unreachable for any database error
 *     }
 *
 * The catch only ever fires for a thrown JS error. A rejected UPDATE — RLS,
 * a trigger, a constraint — sails straight through to showSuccess().
 *
 * That was harmless while writes never failed. It stopped being harmless when
 * we added the session-status guard and suspension enforcement: those exist
 * precisely to REJECT writes, and every rejection was landing silently.
 *
 * Wrapping a call in `mustWrite` makes it throw, which turns the try/catch
 * blocks the app already has into working error handling.
 */

type Result<T> = { data: T; error: { message: string; code?: string } | null }

/**
 * Await a Supabase write and throw if the database refused it.
 * `what` is a short human description used in the log line.
 */
export async function mustWrite<T>(query: PromiseLike<Result<T>>, what: string): Promise<T> {
  const { data, error } = await query
  if (error) {
    console.error(`[db] ${what} failed:`, error.message, error.code ?? '')
    throw new Error(error.message)
  }
  return data
}

/**
 * For writes whose failure genuinely doesn't matter to the user (marking a
 * notification read, saving a push token). Logs, never throws — so that
 * "we don't care" is a decision recorded in the code rather than an accident.
 */
export async function tryWrite(query: PromiseLike<Result<unknown>>, what: string): Promise<void> {
  try {
    const { error } = await query
    if (error) console.warn(`[db] ${what} failed (ignored):`, error.message)
  } catch (e) {
    console.warn(`[db] ${what} threw (ignored):`, e)
  }
}
