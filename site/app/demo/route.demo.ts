/**
 * DEMO MODE — /demo. Picks who you're "signed in" as and lists every screen.
 * Audit item 69.
 *
 * ⚠️ THIS IS NOT A ROUTE IN ANY REAL BUILD. Next only treats `route.demo.ts`
 * as a route when next.config.ts adds 'demo.ts' to pageExtensions, which it
 * does only under local `next dev` with DEMO_MODE=1. Everywhere else /demo is
 * a 404 and this file is never compiled.
 *
 *   /demo                       the index
 *   /demo?as=model&to=/dashboard   sign in as the model, then go to /dashboard
 *   /demo?as=stylist&to=/shop      sign in as the stylist, then go to /shop
 *   /demo?as=none&to=/             signed out
 */
import { NextResponse, type NextRequest } from 'next/server'
import { assertDemoAllowed, DEMO_AS_COOKIE, parseDemoAs } from '@/lib/demo/guard'
import { BOOKINGS_PATH } from '@/lib/routes'

assertDemoAllowed('the /demo route')

const uid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const AMELIA_SHOP = uid(101)
const MODEL_THREAD = uid(3000)
const STYLIST_THREAD = uid(3004)

const SCREENS: { title: string; as: 'model' | 'stylist' | 'none'; to: string }[] = [
  { title: 'Homepage', as: 'none', to: '/' },
  { title: 'Treatment page, with stylists (hair)', as: 'none', to: '/hair-models' },
  { title: 'Stylist profile, with portfolio', as: 'model', to: `/stylist/${AMELIA_SHOP}` },
  { title: 'Browse', as: 'model', to: '/browse' },
  { title: 'Model dashboard', as: 'model', to: '/dashboard' },
  { title: 'Model bookings', as: 'model', to: BOOKINGS_PATH },
  { title: 'Model message thread', as: 'model', to: `/messages/${MODEL_THREAD}` },
  { title: 'Stylist dashboard', as: 'stylist', to: '/dashboard' },
  { title: 'Stylist bookings', as: 'stylist', to: BOOKINGS_PATH },
  { title: 'Stylist message thread', as: 'stylist', to: `/messages/${STYLIST_THREAD}` },
  { title: 'Shop editor (/shop)', as: 'stylist', to: '/shop' },
  { title: 'Availability', as: 'stylist', to: '/availability' },
  { title: 'Model profile, with photos (Sophie, as her stylist)', as: 'stylist', to: `/model/${uid(21)}` },
]

/** Same-site paths only, so /demo can never be used to bounce somewhere else. */
const safePath = (p: string | null) => (p && p.startsWith('/') && !p.startsWith('//') ? p : null)

export function GET(req: NextRequest) {
  const as = req.nextUrl.searchParams.get('as')
  const to = safePath(req.nextUrl.searchParams.get('to'))

  if (as) {
    const res = NextResponse.redirect(new URL(to ?? '/dashboard', req.url))
    res.cookies.set(DEMO_AS_COOKIE, parseDemoAs(as), { path: '/', sameSite: 'lax' })
    return res
  }

  // Query-only hrefs: they point back at this same page. Written that way on
  // purpose. scripts/check-links.mjs is right that "/demo" is no route in a
  // real build, and a link that only ever resolves in demo mode shouldn't say
  // otherwise.
  const link = (s: (typeof SCREENS)[number]) =>
    `<li><a href="?as=${s.as}&amp;to=${encodeURIComponent(s.to)}">${s.title}</a> <code>${s.to}</code> <small>(${s.as === 'none' ? 'signed out' : `as the ${s.as}`})</small></li>`

  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Cavy demo mode</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#2B2531}
a{color:#C23A71;font-weight:600}code{background:#FFF0F6;padding:1px 5px;border-radius:4px;font-size:13px}small{color:#6E6675}</style></head>
<body><h1>Cavy demo mode</h1>
<p>Made-up data from <code>site/lib/demo/fixtures.ts</code>. Nothing here reaches the live database.
No reviews, ratings or photos of real people. Restart the dev server to reset anything you changed.</p>
<p>Each link signs you in as the right account first. The choice sticks in a cookie, so after that you can type the address directly.</p>
<ul>${SCREENS.map(link).join('')}</ul>
<p><small>"Example screen" label: start the server with <code>DEMO_LABEL=1</code> as well.</small></p>
</body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
