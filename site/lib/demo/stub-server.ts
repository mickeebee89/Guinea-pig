/**
 * DEMO MODE — what `@supabase/ssr` and `@supabase/supabase-js` resolve to on
 * the SERVER while demo mode is on. Audit item 69.
 *
 * next.config.ts aliases both packages here only under local `next dev` with
 * DEMO_MODE=1. So lib/supabase-server.ts, lib/supabase-public.ts and proxy.ts
 * run exactly as written, and get this instead of a real client. No request of
 * any kind goes to Supabase: there is no network code in this folder.
 *
 * One store per server process, kept on globalThis so a hot reload doesn't
 * reset it mid-session. Restart the dev server to reset the data.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { assertDemoAllowed, DEMO_AS_COOKIE, parseDemoAs } from './guard'
import { DemoStore, makeDemoClient, type DemoUser, type Row } from './engine'
import { buildTables, VIEWS, DEMO_MODEL_ID, DEMO_STYLIST_ID, type DemoImages } from './fixtures'
import { demoRpc } from './rpc'

assertDemoAllowed('the server')

const IMG = /\.(png|jpe?g|webp)$/i
const SEED_PHOTOS = path.resolve(process.cwd(), '..', 'seed', 'photos')

/** Files in one seed/photos folder, sorted, or none if the folder isn't there. */
function seedFiles(folder: string): string[] {
  try { return readdirSync(path.join(SEED_PHOTOS, folder)).filter(f => IMG.test(f)).sort() } catch { return [] }
}

/**
 * Where the pictures come from, in order:
 *   1. public/demo-images/avatars/<key>.<ext> — Micky's own, if he drops any in;
 *   2. seed/photos/ — the AI-generated seed set (seed/README.md), served by the
 *      demo-only /demo-photos route. Named NN-<key>.png for a face, and
 *      NN-<key>-N.png for work (portfolio/) or a model's own photos (gallery/).
 * Nothing found means null, and the site's initials placeholder shows.
 */
function diskImages(): DemoImages {
  const byKey = (folder: string, key: string, numbered: boolean) =>
    seedFiles(folder)
      .filter(f => (numbered ? new RegExp(`^\\d+-${key}-\\d+\\.`, 'i') : new RegExp(`^\\d+-${key}\\.`, 'i')).test(f))
      .map(f => `/demo-photos/${folder}/${f}`)
  return {
    avatar(key) {
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        const rel = `demo-images/avatars/${key}.${ext}`
        if (existsSync(path.join(process.cwd(), 'public', rel))) return `/${rel}`
      }
      return byKey('stylists', key, false)[0] ?? byKey('models', key, false)[0] ?? null
    },
    portfolio: key => byKey('portfolio', key, true),
    gallery: key => byKey('gallery', key, true),
  }
}

const g = globalThis as unknown as { __cavyDemoStore?: DemoStore }
function store(): DemoStore {
  return (g.__cavyDemoStore ??= new DemoStore(buildTables(diskImages()), VIEWS))
}

export function demoUserFor(as: string | undefined | null): DemoUser | null {
  const who = parseDemoAs(as)
  if (who === 'none') return null
  const id = who === 'stylist' ? DEMO_STYLIST_ID : DEMO_MODEL_ID
  const u = store().tables.users.find(r => r.id === id) as Row
  return {
    id, email: String(u.email), aud: 'authenticated', role: 'authenticated',
    user_metadata: { first_name: u.first_name, role: u.role }, app_metadata: {},
    created_at: String(u.created_at),
  }
}

type CookieOpts = { cookies?: { getAll?: () => { name: string; value: string }[] | Promise<{ name: string; value: string }[]> } }

async function userFromCookies(opts?: CookieOpts): Promise<DemoUser | null> {
  const all = (await opts?.cookies?.getAll?.()) ?? []
  return demoUserFor(all.find(c => c.name === DEMO_AS_COOKIE)?.value)
}

/**
 * The real createServerClient is synchronous and reads cookies lazily. Here the
 * identity is resolved when auth.getUser() is called, so the shape matches.
 */
export function createServerClient(_url: string, _key: string, opts?: CookieOpts) {
  const lazy = { user: undefined as DemoUser | null | undefined }
  const resolve = async () => (lazy.user === undefined ? (lazy.user = await userFromCookies(opts)) : lazy.user)
  const client = makeDemoClient({ store: store(), user: null, rpc: demoRpc })
  const getUser = async () => ({ data: { user: await resolve() }, error: null })
  const getSession = async () => {
    const user = await resolve()
    return { data: { session: user ? { user, access_token: 'demo', refresh_token: 'demo', expires_in: 3600, token_type: 'bearer' } : null }, error: null }
  }
  return {
    ...client,
    // rpc needs the caller for cancel_booking; bind it once resolved.
    rpc: (name: string, args: Row = {}) => {
      const p = {
        then: async (f?: (r: unknown) => unknown, r?: (e: unknown) => unknown) => {
          const user = await resolve()
          return makeDemoClient({ store: store(), user, rpc: demoRpc }).rpc(name, args).then(f, r)
        },
        single: () => p, maybeSingle: () => p,
      }
      return p
    },
    auth: { ...client.auth, getUser, getSession },
  }
}

/** lib/supabase-public.ts's anonymous client: no user, public views only. */
export function createClient() {
  return makeDemoClient({ store: store(), user: null, rpc: demoRpc })
}

/**
 * A client component is rendered once on the server before it hydrates, and
 * ChatThread calls getSupabaseBrowser() while rendering. So this has to return
 * something harmless here: the server store, signed out. Nothing it subscribes
 * to fires on the server; in the browser, stub-browser.ts takes over.
 */
export function createBrowserClient() {
  return makeDemoClient({ store: store(), user: null, rpc: demoRpc })
}
