import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Cavy Admin',
}

/**
 * ── ⚠️ THE PADDING IS THE OTHER HALF OF THE PHONE FIX ──────────────────────
 * `p-8` is 64px of horizontal padding, which on a 360px phone was eating a
 * fifth of the screen on top of the 224px sidebar. `p-4` below md, and
 * `md:p-8` restores today's desktop spacing exactly.
 *
 * ⚠️ `pt-16` IS NOT DECORATION. The drawer trigger is `fixed top-3 left-3`
 * with a 40px box, so without it every page's <h1> renders underneath the
 * hamburger. 16 (64px) clears 12px + 40px with room to spare.
 *
 * ⚠️ AND `md:p-8` RESETS ALL FOUR SIDES, so the top padding goes back to 8 at
 * desktop width rather than keeping a 64px gap nothing needs — the hamburger
 * is `md:hidden`, so there is nothing up there to clear.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex">
        <Sidebar />
        <main className="flex-1 p-4 pt-16 md:p-8 overflow-auto">{children}</main>
      </body>
    </html>
  )
}
