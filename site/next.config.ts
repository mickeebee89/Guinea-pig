import type { NextConfig } from 'next'

/**
 * ── DEMO MODE: THE FIRST LOCK (audit item 69) ─────────────────────────────
 * DEMO_MODE=1 under local `next dev` swaps Supabase for made-up fixtures, so
 * Micky can take screenshots of the real pages without touching the live
 * database. See lib/demo/README.md.
 *
 * It works ONLY by the aliases and the page extension below, which exist ONLY
 * when this is true. A production build has neither, so nothing in the build
 * references lib/demo or app/demo at all.
 *
 * Asking for demo mode anywhere it isn't allowed FAILS, rather than being
 * quietly ignored: `DEMO_MODE=1 next build`, or DEMO_MODE set on Vercel, stops
 * with the reason. A setting that silently does nothing is how someone ends up
 * believing it did something.
 */
const DEMO_MODE = (() => {
  if (process.env.DEMO_MODE !== '1') return false
  const refused: string[] = []
  if (process.env.NODE_ENV !== 'development') refused.push(`NODE_ENV is "${process.env.NODE_ENV}"`)
  if (process.env.VERCEL_ENV) refused.push(`VERCEL_ENV is "${process.env.VERCEL_ENV}"`)
  if (process.env.VERCEL) refused.push('VERCEL is set')
  if (refused.length) {
    throw new Error(`DEMO_MODE=1 refused: ${refused.join('; ')}. Demo mode runs only under local \`next dev\`.`)
  }
  return true
})()

const demoAliases = {
  '@supabase/ssr': { browser: './lib/demo/stub-browser.ts', default: './lib/demo/stub-server.ts' },
  '@supabase/supabase-js': { browser: './lib/demo/stub-browser.ts', default: './lib/demo/stub-server.ts' },
  '@/components/DemoLabel': './lib/demo/DemoLabel.tsx',
}

const nextConfig: NextConfig = {
  // Demo mode only: app/demo/route.demo.ts becomes a route. Otherwise the
  // default extensions, under which that file is not a route at all.
  //
  // And its own build cache. Sharing .next/dev with a normal `next dev` left
  // stale route tables that 404'd every page but / and /demo on 22 Sep; a
  // separate folder means the two can never read each other's.
  //
  // And no Next.js dev badge in the corner: these are for screenshots.
  ...(DEMO_MODE
    ? { pageExtensions: ['tsx', 'ts', 'jsx', 'js', 'demo.ts'], distDir: '.next-demo', devIndicators: false }
    : {}),

  /**
   * Local only, and only because of a stray C:\Users\micky\package-lock.json:
   * without this Next walks up looking for a lockfile, finds that one, and
   * infers the home directory as the workspace root.
   *
   * Deliberately NOT set on Vercel, and `outputFileTracingRoot` is deliberately
   * not set at all. Both existed to stop Turbopack reaching the repo root and
   * compiling the admin console's proxy.ts into this app — which is what broke
   * the first two deploys. The admin app now lives in admin/, so there is no
   * app above this one to reach, and pinning the tracing root on Vercel only
   * fights the value Vercel injects and reintroduces the "must have the same
   * value" warning.
   */
  ...(process.env.VERCEL ? {} : {
    turbopack: {
      root: __dirname,
      ...(DEMO_MODE ? { resolveAlias: demoAliases } : {}),
    },
  }),

  /**
   * DEVELOPMENT ONLY. Hosts allowed to fetch /_next/* from the dev server.
   *
   * Next blocks dev resources for any origin that is not localhost, which is
   * right — a dev server should not hand its internals to anything on the
   * network. But it means a PHONE on the same Wi-Fi gets the HTML and none of
   * the JavaScript, so the page renders and nothing works: no hydration, no
   * event handlers, no uploads. The failure looks like broken app code, and the
   * only place it is explained is the dev server's own stdout.
   *
   * This app's whole premise is "the web works without the app", most of which
   * means a phone browser, so testing on a real handset cannot require a
   * deploy. Set DEV_LAN_ORIGIN in .env.local when your LAN address changes —
   * DHCP will move it eventually.
   *
   * Never set on Vercel: production serves everything from one origin and has
   * no dev resources to expose.
   */
  ...(process.env.NODE_ENV === 'production' ? {} : {
    allowedDevOrigins: [
      ...(process.env.DEV_LAN_ORIGIN ? [process.env.DEV_LAN_ORIGIN] : []),
      '10.25.91.247',
    ],
  }),

  /**
   * /sessions -> /bookings, renamed 2 Sep 2026.
   *
   * Nothing outside this app ever linked to /sessions - no email template, no
   * deep link, no notification - so this is not repairing a broken inbound
   * link. It is here because a URL that has been live is a URL somebody may
   * have bookmarked, and a 404 is a worse answer than a redirect for a cost of
   * three lines. Permanent so it is cached and search engines follow it.
   */
  async redirects() {
    return [
      { source: '/sessions', destination: '/bookings', permanent: true },
      { source: '/sessions/:path*', destination: '/bookings/:path*', permanent: true },
    ]
  },

  images: {
    // Stylist avatars and banners live in the public `profile-pics` bucket.
    // Without this every image 400s at runtime with an error that reads like a
    // network failure rather than a config one.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ptluekkhiopowuyvkgnd.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  /**
   * Security headers.
   *
   * The CSP is intentionally NOT nonce-based. Nonces require middleware on
   * every request, which makes every route dynamic — and static rendering is
   * the thing the whole SEO plan rests on. So `script-src` keeps
   * 'unsafe-inline' for Next's hydration payload, and the value here comes from
   * everything else: no UNLISTED third-party origin can load a script, be
   * framed, or receive a form post.
   *
   * ── ⚠️ THIS USED TO SAY "loads nothing external at all" ──────────────────
   * It did, and that was true until 14 Sep 2026. Fonts are still self-hosted by
   * next/font. (This said "there is still no analytics" until 22 Sep 2026, when
   * Vercel Web Analytics was added — same-origin in production, so it needs no
   * origin here; see script-src below and audit item 67.) What changed is Stripe: card
   * payments cannot be collected without loading Stripe's script and framing
   * their card field, because the whole point is that card numbers never touch
   * this origin.
   *
   * The sentence is rewritten rather than left standing, because a comment
   * describing a policy the file no longer has is how "there is no webhook"
   * survived nine places for three weeks (audit item 47). The allowlist below
   * now has exactly three external origins and every one is Stripe's.
   *
   * ── WHY THIS MATTERS MORE THAN MOST OF THIS FILE ─────────────────────────
   * A CSP mistake is invisible to every check this project has. eslint, tsc,
   * `next build`, CI and a Vercel deploy all pass on a policy that blocks the
   * payment form, and the failure appears only in a real browser. The comment
   * on connect-src below records the last time exactly that happened here.
   */
  async headers() {
    // React's DEV build uses eval() for debugging features — reconstructing
    // callstacks across environments, mainly. Without 'unsafe-eval' the dev
    // overlay reports an error on every page load. React never uses eval() in
    // production, so this is added in development ONLY and the shipped policy
    // is unchanged.
    const isProd = process.env.NODE_ENV === 'production'
    const devEval = isProd ? '' : " 'unsafe-eval'"

    // Vercel Web Analytics (components/SiteAnalytics.tsx). In PRODUCTION its
    // script is /_vercel/insights/script.js and it reports to /_vercel/insights/*,
    // both this origin, so 'self' covers them and the shipped policy gains
    // nothing. In development the package swaps in a debug build from
    // va.vercel-scripts.com (@vercel/analytics 2.0.1, getScriptSrc), which only
    // logs to the console; allowing it in dev alone keeps the dev console free
    // of a CSP error on every page. Audit item 67.
    const devAnalytics = isProd ? '' : ' https://va.vercel-scripts.com'

    // The member area talks to Supabase from the browser: PostgREST over https
    // for sends and reads, and a WebSocket for realtime chat.
    //
    // `connect-src 'self'` was correct for phase 1, when this site made no
    // client-side request of any kind. It became wrong the moment slice 2
    // shipped, and it failed in the two worst ways at once: the send surfaced
    // as an opaque "TypeError: Failed to fetch" with no mention of CSP, and
    // realtime failed SILENTLY — the socket is refused, no error reaches the
    // page, and chat simply never updates.
    //
    // Derived from the env var rather than hardcoded, so the policy cannot
    // drift from the URL the client is actually calling.
    const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const wsOrigin = supabaseOrigin.replace(/^https:/, 'wss:')

    // Stripe.js posts the payment confirmation to api.stripe.com DIRECTLY from
    // the browser — it is not proxied through this origin, and that is the
    // design: card details must not reach our server. Omitting it fails exactly
    // the way connect-src 'self' did in slice 2: an opaque "TypeError: Failed to
    // fetch" that never mentions CSP, at the moment someone is paying.
    const STRIPE_API = 'https://api.stripe.com'
    const connectSrc = ["'self'", supabaseOrigin, wsOrigin, STRIPE_API]
      .filter(Boolean).join(' ')

    const csp = [
      "default-src 'self'",
      // js.stripe.com serves Stripe.js. It is the ONLY external script origin
      // on this site, and Stripe requires it be loaded from there rather than
      // bundled — they ship fixes to it without a release on our side.
      `script-src 'self' 'unsafe-inline' https://js.stripe.com${devEval}${devAnalytics}`,
      "style-src 'self' 'unsafe-inline'",
      // next/image proxies remote images through /_next/image, so they are
      // same-origin by the time a browser sees them; the Supabase host is
      // listed for the unoptimised fallback path.
      "img-src 'self' data: https://ptluekkhiopowuyvkgnd.supabase.co",
      "font-src 'self'",
      `connect-src ${connectSrc}`,
      // ⚠️ THERE WAS NO frame-src HERE AT ALL, so default-src 'self' governed
      // frames and Stripe's card field was refused. Elements puts the card
      // input in an iframe on Stripe's origin precisely so the number never
      // enters this page's DOM — blocking it does not make the site safer, it
      // makes payment impossible while every build stays green.
      //
      // hooks.stripe.com is the 3-D Secure challenge frame. A card that needs
      // SCA — which, in the UK, is most of them — fails at the bank step
      // without it, AFTER the customer believes they have paid.
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      // NB X-Frame-Options: DENY below and frame-ancestors 'none' above both
      // govern THIS site being framed by someone else. They have nothing to do
      // with this site framing Stripe, which is frame-src. Worth saying: it is
      // the first question anyone asks when reading these together.
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      // PRODUCTION ONLY. This rewrites every http:// subresource request to
      // https://, which is right for a shipped site and breaks the dev server
      // the moment it is reached over anything but localhost.
      //
      // Browsers exempt localhost as a "potentially trustworthy" origin, so
      // this never bites on a desktop. A bare LAN IP gets no exemption — so
      // testing on a phone at http://10.x.x.x:PORT loads the HTML (requested
      // before the header is parsed) and then upgrades every stylesheet and
      // script to https, which the dev server does not speak. The page renders
      // as unstyled markup with dead buttons and nothing in the console
      // mentions CSP.
      //
      // Mobile web is half the point of this app existing, so testing it on a
      // real handset must not require deploying first.
      ...(isProd ? ['upgrade-insecure-requests'] : []),
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            // camera=(self), not camera=(). This site now HAS a camera feature:
            // /verify takes the ID-check photo, and `camera=()` denies the
            // capability to the page's own origin.
            //
            // The header was written when nothing here touched a camera, and it
            // was right then. Piece 4 made it wrong — a rule that was correct
            // for an earlier version of the app and outlived it.
            //
            // (self) is the minimum that works: this origin may use a camera,
            // no third party may, and nothing can be framed here to try
            // (frame-ancestors 'none'). Everything else stays fully denied —
            // there is still no microphone, location, payment or USB use.
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default nextConfig
