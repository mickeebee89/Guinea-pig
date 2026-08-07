import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Pin BOTH roots to this directory. They must hold the same value — if they
   * disagree Next warns and silently uses outputFileTracingRoot.
   *
   * This is load-bearing, not tidiness. The repo root is the admin console, and
   * it has a `proxy.ts` there: Next 16's renamed middleware convention, whose
   * matcher catches every path and redirects anyone without an is_admin()
   * session to /login. When the root resolves to the repo root instead of
   * site/, Turbopack finds that file and compiles it into THIS app. The first
   * Vercel deploy failed exactly that way ("Can't resolve '@supabase/ssr'",
   * which lives in the root package.json, not this one).
   *
   * The failure was lucky. Had the import resolved, the public marketing site
   * would have shipped with the admin auth gate attached, bouncing every
   * visitor and every crawler to a login page.
   *
   * NEVER "fix" that error by adding @supabase/ssr to this package.json.
   * The correct fix is to keep the build scoped to site/ — here, and via
   * "Include files outside of the Root Directory" being OFF on Vercel.
   *
   * Locally this also stops Next inferring a workspace root from the stray
   * C:\Users\micky\package-lock.json.
   */
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },

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
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // next/image proxies remote images through /_next/image, so they are
      // same-origin by the time a browser sees them; the Supabase host is
      // listed for the unoptimised fallback path.
      "img-src 'self' data: https://ptluekkhiopowuyvkgnd.supabase.co",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
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
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
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
