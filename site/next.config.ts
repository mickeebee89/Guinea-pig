import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this Next walks up looking for a lockfile
  // and picks C:\Users\micky\package-lock.json (a stray file in the home dir),
  // which misplaces output file tracing and breaks the Vercel build.
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
