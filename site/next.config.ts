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
}

export default nextConfig
