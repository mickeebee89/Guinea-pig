'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Run an async load whenever `key` changes, with a DERIVED loading flag and
 * cancellation.
 *
 * ── WHY THIS EXISTS RATHER THAN `useEffect(() => { load() }, [filter])` ────
 *
 * Every page in this console had the same shape:
 *
 *     async function load() {
 *       setLoading(true)            // ← synchronous setState inside an effect
 *       const { data } = await q    // ← no cancellation
 *       setRows(data); setLoading(false)
 *     }
 *     useEffect(() => { load() }, [filter])
 *
 * Two problems, and only the first one is cosmetic.
 *
 * 1. `setLoading(true)` runs synchronously when the effect fires, which costs a
 *    cascading render. That is what react-hooks/set-state-in-effect flagged, and
 *    on its own it would not have been worth nine rewrites.
 *
 * 2. NOTHING CANCELLED THE OLD REQUEST. Change a filter twice quickly and the
 *    slower first response can land last, so the list shows rows for a filter
 *    that is no longer selected — open reports under a "resolved" heading, on a
 *    moderation console. The screen disagreeing with the data, which is the
 *    failure this project keeps finding.
 *
 * ── HOW IT FIXES BOTH ─────────────────────────────────────────────────────
 *
 * `loading` is DERIVED — it is "the key I have loaded is not the key I want" —
 * so nothing has to set it, and there is no setState in the effect body at all.
 * The only setState happens after an await, on a run that has not been
 * superseded.
 *
 * `run` receives `stale()`. CALL IT before every setState in your loader: this
 * hook can refuse to record a superseded run, but only the loader knows which
 * pieces of state it was about to write.
 *
 * `reload()` is for buttons and post-mutation refreshes. It bumps a nonce, so it
 * refetches even when no filter changed, and it goes through the same
 * cancellation as everything else.
 */
export function useLoader(
  /** Everything the load depends on, as one string. Changing it refetches. */
  key: string,
  run: (stale: () => boolean) => Promise<void>,
): { loading: boolean; reload: () => void } {
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fullKey = `${nonce}\u0000${key}`

  // `run` is a fresh closure every render. Held in a ref so the fetch effect can
  // depend on `fullKey` alone and still call the current one — putting `run` in
  // the dependency array would refetch on every render, for ever.
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await runRef.current(() => cancelled)
      } catch (e) {
        // A throw must not leave the page stuck on "Loading…" with no way out.
        // app/providers/page.tsx had its own try/finally for exactly this and
        // relies on the guarantee living here now.
        console.error("[useLoader] load threw", e)
      } finally {
        if (!cancelled) setLoadedKey(fullKey)
      }
    })()
    return () => { cancelled = true }
  }, [fullKey])

  return {
    loading: loadedKey !== fullKey,
    reload: () => setNonce(n => n + 1),
  }
}
