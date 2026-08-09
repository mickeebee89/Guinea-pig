/** Small shared pieces for the member area. Server-safe — no client hooks. */

const STATUS_STYLE: Record<string, string> = {
  pending:   'bg-input-bg text-muted',
  accepted:  'bg-soft-pink text-rose',
  completed: 'bg-soft-pink text-warm-dark',
  cancelled: 'bg-input-bg text-muted',
  declined:  'bg-input-bg text-muted',
}

/** Says what the status MEANS, not just what it is called. */
const STATUS_LABEL: Record<string, string> = {
  pending:   'Awaiting acceptance',
  accepted:  'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  declined:  'Declined',
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[999px] px-2.5 py-0.5 text-xs font-bold ${
        STATUS_STYLE[status] ?? 'bg-input-bg text-muted'
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-white p-10 text-center">
      <p className="font-display text-lg text-warm-dark">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{children}</p>}
    </div>
  )
}

/**
 * An error the user can see. Used where a failed query would otherwise render
 * as an empty list — "you have no messages" and "we could not load your
 * messages" must never look the same.
 */
export function LoadError({ what }: { what: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-white p-6 text-center">
      <p className="font-bold text-warm-dark">We couldn’t load your {what}.</p>
      <p className="mt-1 text-sm text-muted">
        This is a problem at our end, not something you’ve done. Try reloading the page.
      </p>
    </div>
  )
}

/** Avatar, or initials when there's no picture. */
export function Avatar({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  if (!src) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[999px] bg-soft-pink font-bold text-rose"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {initial}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from
    // Supabase Storage at unknown sizes; next/image buys nothing here and adds
    // a remotePatterns entry per bucket.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[999px] object-cover"
      style={{ width: size, height: size }}
    />
  )
}
