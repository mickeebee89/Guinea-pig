'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
    </aside>
  )
}
