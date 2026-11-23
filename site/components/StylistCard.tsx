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
        {/* ── ⚠️ SAY LESS THAN IS TRUE, AND THEN SAY NOTHING ───────────────
            A rose ✓ stood here, titled "Photo checked — a person compared
            their selfie to their profile photo", on pages served to
            logged-out visitors and indexed by search engines.

            It was fixed once, in September, by SOFTENING it: the tooltip had
            said "Identity verified", which invited a reader to think a
            passport had been checked. That fix was aimed at the wrong thing.
            The wording was never the fault — the SENTENCE WAS UNTRUE ABOUT
            THE PERSON IT WAS PINNED TO.

            Measured on production 23 Nov 2026, counting rendered instances in
            the served HTML: NINE badges across /hair-models, /makeup-models,
            /lash-models and /brow-models, covering all seven published
            stylists. EIGHT of the nine sat on a stylist who had never
            submitted a verification request, so no person had compared
            anything. `is_verified` is an admin flag; across the platform 14
            users carry it and 3 earned it.

            A model weighs this when deciding whether to be alone with a
            stranger. That is what makes it a safety claim rather than
            marketing copy, and it is why a mostly-wrong one is worse than
            none: she cannot tell which seventh she is looking at.

            ⚠️ DO NOT REPLACE IT WITH A BADGE DRIVEN OFF
            `verification_requests` EITHER. Three approved rows exist in all.
            A mark almost nobody carries reads as a mark against everyone
            else. See lib/verification.ts, above isIdentityVerified. */}
        <p className="truncate font-display text-lg text-warm-dark">{stylist.name}</p>
        {stylist.location && <p className="truncate text-sm text-muted">{stylist.location}</p>}
        {stylist.categories.length > 0 && (
          <p className="mt-1 truncate text-xs text-rose">{stylist.categories.join(' · ')}</p>
        )}
      </div>
    </li>
  )
}
