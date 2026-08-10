'use client'

/**
 * A short buzz on a deliberate action. Web's thin equivalent of expo-haptics.
 *
 * ── WHAT IT DOES AND DOES NOT REACH ───────────────────────────────────────
 * `navigator.vibrate` is Android Chrome and desktop Chrome/Firefox. **iOS
 * Safari does not implement it at all** and there is no shim — so on an iPhone
 * this is silently nothing, for ever, no matter how it is called. Worth knowing
 * before anyone spends an afternoon deciding it is broken.
 *
 * Desktop browsers expose the function on machines with no vibration motor,
 * where it is a no-op. That is fine; it is not worth sniffing for.
 *
 * The API also requires a real user gesture — a call outside a click or key
 * handler is dropped by the browser. Every use here is inside an onClick, which
 * is also the only place a buzz means anything.
 *
 * Guarded rather than trusted: `vibrate` throws in some embedded webviews and a
 * failed buzz must never take a save down with it.
 */
export function tap(ms = 10): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(ms)
  } catch {
    /* A buzz is decoration. Never let it break the thing it was decorating. */
  }
}
