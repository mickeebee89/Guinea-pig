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
          {/* ── SAY LESS THAN IS TRUE ─────────────────────────────────────
              This read "Identity verified", on pages served to logged-out
              visitors and indexed by search engines. Nothing of the sort
              happens: a person compares a selfie holding a handwritten note
              against the profile photo. No document is requested, seen or kept.

              A model weighs this when deciding whether to be alone with a
              stranger. Someone who believes a passport was checked accepts a
              risk they would not otherwise accept, on the strength of our
              wording — which makes it a safety claim, not marketing copy. The
              rule is stated in full at app/(app)/verify/page.tsx; this was the
              last place still breaking it, and the most public. */}
          {stylist.is_verified && (
            <span
              className="ml-1.5 text-sm text-rose"
              title="Photo checked — a person compared their selfie to their profile photo. Not an ID document check."
              aria-label="Photo checked"
              role="img"
            >
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
