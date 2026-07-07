'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const nav = [
  { href: '/',               label: 'Dashboard',        icon: '📊' },
  { href: '/users',          label: 'Users',            icon: '👤' },
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

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  // No route gating yet — just don't render the admin shell on the login screen.
  if (pathname === '/login') return null

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <aside className="w-56 min-h-screen flex flex-col shrink-0" style={{ backgroundColor: '#3D2E2E' }}>
      <div className="px-5 py-6 border-b border-white/10">
        <div className="text-white font-bold text-lg leading-tight">Guinea Pig</div>
        <div className="text-xs mt-0.5" style={{ color: '#C8788A' }}>Admin Console</div>
      </div>
      <nav className="flex-1 py-4">
        {nav.map(({ href, label, icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
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
  )
}
