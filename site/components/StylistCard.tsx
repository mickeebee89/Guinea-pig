import Image from 'next/image'
import type { PublicStylist } from '@/lib/supabase-public'

export function StylistCard({ stylist }: { stylist: PublicStylist }) {
  return (
    <li className="flex items-center gap-4 rounded-lg border border-hairline bg-white p-4 shadow-[var(--shadow-soft)]">
      {stylist.profile_pic_url ? (
        <Image
          src={stylist.profile_pic_url}
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-soft-pink font-display text-xl text-rose"
        >
          {stylist.name.charAt(0)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-lg text-warm-dark">
          {stylist.name}
          {stylist.is_verified && (
            <span className="ml-1.5 text-sm text-rose" title="Identity verified">
              ✓
            </span>
          )}
        </p>
        {stylist.location && <p className="truncate text-sm text-muted">{stylist.location}</p>}
        {stylist.categories.length > 0 && (
          <p className="mt-1 truncate text-xs text-rose">{stylist.categories.join(' · ')}</p>
        )}
      </div>
    </li>
  )
}
