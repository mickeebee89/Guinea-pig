import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
  ...(process.env.VERCEL ? {} : { turbopack: { root: __dirname } }),

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
   * everything else: no third-party origin can load a script, be framed, or
   * receive a form post. This site loads nothing external at all — fonts are
   * self-hosted by next/font and there is no analytics — so the allowlist can
   * stay this tight.
   */
  async headers() {
    // React's DEV build uses eval() for debugging features — reconstructing
    // callstacks across environments, mainly. Without 'unsafe-eval' the dev
    // overlay reports an error on every page load. React never uses eval() in
    // production, so this is added in development ONLY and the shipped policy
    // is unchanged.
    const isProd = process.env.NODE_ENV === 'production'
    const devEval = isProd ? '' : " 'unsafe-eval'"

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
    const connectSrc = ["'self'", supabaseOrigin, wsOrigin].filter(Boolean).join(' ')

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval}`,
      "style-src 'self' 'unsafe-inline'",
      // next/image proxies remote images through /_next/image, so they are
      // same-origin by the time a browser sees them; the Supabase host is
      // listed for the unoptimised fallback path.
      "img-src 'self' data: https://ptluekkhiopowuyvkgnd.supabase.co",
      "font-src 'self'",
      `connect-src ${connectSrc}`,
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
