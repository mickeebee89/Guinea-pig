'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const nav = [
  { href: '/',               label: 'Dashboard',        icon: '📊' },
  { href: '/users',          label: 'Users',            icon: '👤' },
  { href: '/waitlist',       label: 'Waitlist',         icon: '📝' },
  { href: '/verification',   label: 'Verification',     icon: '🛡️' },
  { href: '/reports',        label: 'Reports',          icon: '🚩' },
  { href: '/moderation',     label: 'Moderation Queue', icon: '🖼️' },
  { href: '/providers',      label: 'Providers',        icon: '✂️' },
  { href: '/revenue',        label: 'Revenue',          icon: '💷' },
  { href: '/categories',     label: 'Categories',       icon: '🏷️' },
  { href: '/settings',       label: 'Settings',         icon: '⚙️' },
  { href: '/messages',       label: 'Messages',         icon: '💬' },
  { href: '/audit-log',      label: 'Audit Log',        icon: '📋' },
]

/**
 * The admin shell's navigation. Permanent column on desktop, off-canvas drawer
 * on a phone.
 *
 * ── ⚠️⚠️ THE DESKTOP PATH MUST NOT CHANGE, AND THAT IS A CONSTRAINT ON HOW
 * ── THE MOBILE CLASSES ARE WRITTEN, NOT A HOPE ─────────────────────────────
 * The console is used on a desktop every day and on a phone occasionally, so
 * the phone work must not cost the desktop anything. Every class added below
 * for the drawer is cancelled at `md`, deliberately and individually:
 *
 *   fixed inset-y-0 left-0  →  md:static   (and inset has no effect when static)
 *   z-40                    →  left as-is; z-index does nothing on a STATIC box,
 *                              so there is no desktop stacking context to leak
 *   -translate-x-full       →  md:translate-none — see the correction below
 *   transition-transform    →  md:transition-none, or the column would animate
 *                              on first paint at desktop width
 *
 * ⚠⚠⚠ CORRECTED 21 Oct 2026 — THIS BLOCK USED TO SAY `md:transform-none`, AND
 * THAT MADE THE SIDEBAR INVISIBLE ON EVERY DESKTOP BROWSER FOR A WEEK.
 *
 * **Tailwind v4 implements translate utilities with the standalone `translate`
 * property, not `transform`:**
 *
 *     .-translate-x-full  { --tw-translate-x: -100%;
 *                           translate: var(--tw-translate-x) var(--tw-translate-y); }
 *     .transform-none     { transform: none; }
 *
 * So `md:transform-none` cancelled a property this element never set. At
 * >=768px the aside was still `translate: -100%` — rendered, laid out, and
 * entirely outside the left edge of the viewport.
 *
 * ⚠⚠ AND THE VERIFICATION THAT PASSED IT IS THE REAL LESSON. The original
 * change was reported as "verified from the compiled CSS, not from intent",
 * on the strength of grepping that `.md\:transform-none` had been EMITTED. It
 * had been. **What was never checked is whether it cancelled anything**, which
 * it could not, because it names a different property from the one that was
 * set. "The rule is emitted" and "the rule takes effect" are separate claims
 * and only the second one matters. Micky compiled both rules and read them.
 *
 * ✅ `md:translate-none` emits `translate: none`, which removes the property —
 * the same property `-translate-x-full` sets.
 *
 * ⚠️ DO NOT "SIMPLIFY" THIS TO md:translate-x-0. That emits
 * `translate: 0px 0px`, and a zero translate creates a containing block and a
 * stacking context exactly as a zero transform would — which would quietly
 * change how a `fixed` child inside any admin page behaves. The original
 * instinct here was right; only the property name was wrong.
 *
 * What is left at `md` and above is exactly today's box:
 * `w-56 min-h-screen flex flex-col shrink-0` with the same inline background.
 *
 * ── THE BREAKPOINT IS md (768px), matching the stat grids ─────────────────
 * The page content already uses `md:grid-cols-*`, so the drawer appearing and
 * the grids collapsing happen at the same width. One breakpoint, not two.
 */
export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // ⚠️ EVERY HOOK SITS ABOVE THE /login EARLY RETURN. React requires the same
  // hooks in the same order on every render, so a hook added below that return
  // would break the rules of hooks the moment the login page rendered.

  // ⚠⚠ THERE IS NO `useEffect(() => setOpen(false), [pathname])` HERE, AND ITS
  // ABSENCE IS CHECKED RATHER THAN ASSUMED. The obvious way to close the drawer
  // on navigation is a route-change effect, but eslint's
  // react-hooks/set-state-in-effect rightly refuses setState inside an effect.
  //
  // It is also unnecessary, which is why this is a removal and not a disabled
  // rule. While the drawer is open the backdrop covers the page, so the ONLY
  // reachable navigation is a nav <Link>, and each one closes it in onClick.
  // The whole admin app contains exactly two programmatic navigations (checked
  // 14 Oct 2026): login/page.tsx -> '/' and this file's sign-out -> '/login'.
  // Both land on /login or leave it, and this component returns null on /login,
  // so the drawer is unmounted either way. There is no onAuthStateChange
  // listener that could redirect from under it.
  //
  // ⚠️ IF A PAGE EVER ADDS ITS OWN router.push, re-check this: the drawer could
  // then be left open over a page it does not belong to.

  // Escape closes it. Bound only while open, so the console has no stray
  // key listener the rest of the time.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // No route gating yet — just don't render the admin shell on the login screen.
  // ⚠️ The hamburger and backdrop are inside this component precisely so that
  // this one return hides all three. A trigger rendered from the layout would
  // need its own copy of this condition, and the two would drift.
  if (pathname === '/login') return null

  async function handleSignOut() {
    // Navigating to /login on a failed signOut leaves a live admin session
    // behind a screen that says you are signed out — on the console that can
    // ban people. Say it instead.
    const { error } = await supabase.auth.signOut()
    if (error) {
      alert(`Couldn't sign out: ${error.message}\n\nYou are STILL SIGNED IN. Close the browser if you cannot retry.`)
      return
    }
    router.replace('/login')
  }

  return (
    <>
      {/* The trigger. A real <button>, so it is focusable and announced; the
          label says what it does rather than naming the icon. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="admin-nav"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        className="md:hidden fixed top-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-lg text-white shadow-lg"
        style={{ backgroundColor: '#3D2E2E' }}
      >
        {/* aria-hidden: the accessible name is on the button, so the glyph
            must not be read out after it. */}
        <span aria-hidden="true" className="text-lg leading-none">{open ? '✕' : '☰'}</span>
      </button>

      {/* The backdrop. Only mounted while open, and only below md. It is a
          button so a keyboard user can reach it too, rather than a div with a
          click handler that nothing can focus. */}
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation menu"
          tabIndex={-1}
          className="md:hidden fixed inset-0 z-30 bg-black/50"
        />
      )}

      <aside
        id="admin-nav"
        className={`fixed inset-y-0 left-0 z-40 w-56 min-h-screen flex flex-col shrink-0
                    transition-transform duration-200 ease-out
                    ${open ? 'translate-x-0' : '-translate-x-full'}
                    md:static md:translate-none md:transition-none`}
        style={{ backgroundColor: '#3D2E2E' }}
      >
        <div className="px-5 py-6 border-b border-white/10">
          <div className="text-white font-bold text-lg leading-tight">Cavy</div>
          <div className="text-xs mt-0.5" style={{ color: '#C8788A' }}>Admin Console</div>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {nav.map(({ href, label, icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                // ⚠️ Also closed here, not only by the route-change effect:
                // tapping the link for the page you are already on does not
                // change the pathname, so the effect would never fire and the
                // drawer would sit there looking stuck.
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  active
                    ? 'text-white font-medium'
                    : 'text-white/60 hover:text-white/90'
                }`}
                style={active ? { backgroundColor: '#8C4A58' } : {}}
              >
                <span className="text-base">{icon}</span>
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 py-2 text-sm text-white/60 hover:text-white/90 transition-colors"
          >
            <span className="text-base">🚪</span>
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
