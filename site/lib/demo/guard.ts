/**
 * DEMO MODE — the second lock. Audit item 69.
 *
 * The first lock is next.config.ts: without DEMO_MODE=1 in local `next dev`,
 * the aliases that route Supabase to lib/demo don't exist, and nothing reaches
 * this folder. This is here in case that is ever misconfigured: every demo
 * stand-in calls it when it loads, and refuses to run anywhere but a local
 * development server.
 *
 * NODE_ENV is inlined by Next at build time, so in a production bundle the
 * first condition is a constant and this throws unconditionally.
 */
export function assertDemoAllowed(where: string): void {
  const problems: string[] = []
  if (process.env.NODE_ENV !== 'development') problems.push(`NODE_ENV is "${process.env.NODE_ENV}"`)
  // Server-side only: the browser bundle has no VERCEL variables to read.
  if (typeof window === 'undefined') {
    if (process.env.VERCEL_ENV) problems.push(`VERCEL_ENV is "${process.env.VERCEL_ENV}"`)
    if (process.env.VERCEL) problems.push('VERCEL is set')
    if (process.env.DEMO_MODE !== '1') problems.push('DEMO_MODE is not "1"')
  }
  if (problems.length) {
    throw new Error(`Cavy demo mode refused to start in ${where}: ${problems.join('; ')}. ` +
      'Demo mode only runs under local `next dev` with DEMO_MODE=1.')
  }
}

/** Who you are signed in as. Chosen at /demo, kept in this cookie. */
export const DEMO_AS_COOKIE = 'cavy_demo_as'
export type DemoAs = 'model' | 'stylist' | 'none'
export const parseDemoAs = (v: string | undefined | null): DemoAs =>
  v === 'stylist' ? 'stylist' : v === 'none' ? 'none' : 'model'
