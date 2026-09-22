import { assertDemoAllowed } from './guard'

/**
 * DEMO MODE — the optional "Example screen" label for marketing images.
 * Shown only when DEMO_LABEL=1 is also set. Audit item 69.
 */
export function DemoLabel() {
  assertDemoAllowed('the example-screen label')
  if (process.env.DEMO_LABEL !== '1') return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-[999px] bg-warm-dark/80 px-3 py-1 text-xs font-bold text-white"
    >
      Example screen
    </div>
  )
}
