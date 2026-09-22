/**
 * DEMO MODE — what `@supabase/ssr` and `@supabase/supabase-js` resolve to in
 * the BROWSER while demo mode is on. Audit item 69.
 *
 * Used by the two client components that talk to Supabase directly: the chat
 * thread (a realtime subscription, a send, read receipts) and the portfolio
 * manager. The browser has its own copy of the fixtures, so a message sent here
 * appears in the thread through the fake realtime channel, but isn't seen by
 * the server. Reload the page and it's gone. That is fine for screenshots.
 */
import { assertDemoAllowed, DEMO_AS_COOKIE, parseDemoAs } from './guard'
import { DemoStore, makeDemoClient, type DemoUser } from './engine'
import { buildTables, VIEWS, DEMO_MODEL_ID, DEMO_STYLIST_ID } from './fixtures'
import { demoRpc } from './rpc'

assertDemoAllowed('the browser')

let client: ReturnType<typeof makeDemoClient> | undefined

function currentUser(): DemoUser | null {
  const raw = document.cookie.split('; ').find(c => c.startsWith(`${DEMO_AS_COOKIE}=`))?.split('=')[1]
  const who = parseDemoAs(raw)
  if (who === 'none') return null
  return {
    id: who === 'stylist' ? DEMO_STYLIST_ID : DEMO_MODEL_ID, email: `${who}@demo.invalid`,
    aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {},
    created_at: new Date().toISOString(),
  }
}

export function createBrowserClient() {
  return (client ??= makeDemoClient({ store: new DemoStore(buildTables(), VIEWS), user: currentUser(), rpc: demoRpc }))
}

export function createClient() {
  return createBrowserClient()
}

export function createServerClient(): never {
  throw new Error('demo: createServerClient was resolved to the browser stub.')
}
