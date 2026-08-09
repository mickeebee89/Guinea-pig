import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'

/**
 * Chrome for the PUBLIC site only.
 *
 * These used to live in the root layout, which meant every route got them —
 * including the member area, which has its own nav. A signed-in user saw two
 * headers stacked, the top one offering "For stylists / For models", which are
 * pitches to people who haven't joined.
 *
 * Nothing here reads cookies, so (public) stays statically rendered — the whole
 * point of the split. scripts/check-client-boundary.mjs walks this file too,
 * since it is now part of every public page's import graph.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  )
}
