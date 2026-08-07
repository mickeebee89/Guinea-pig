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
