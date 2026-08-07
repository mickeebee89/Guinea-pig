import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Same reason as site/next.config.ts: a stray C:\Users\micky\package-lock.json
  // makes Next walk up and infer the home directory as the workspace root.
  // Pinning it here keeps this app's build scoped to admin/.
  turbopack: { root: __dirname },
}

export default nextConfig
