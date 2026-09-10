/**
 * Who reviewed a moderation decision, and HOW WE KNOW.
 *
 * ── THE CONDITION THIS COMPONENT EXISTS TO MEET ───────────────────────────
 * 25 verification decisions made before 10 Sep 2026 had no reviewer recorded.
 * Migration 0037 reconstructed all 25 from admin_audit_log and marked them
 * reviewed_by_source = 'reconstructed'. Micky approved that on one condition:
 * a reconstructed reviewer must be visibly distinguishable from a recorded one
 * WHEREVER A REVIEWER APPEARS, not only where it happened to be built first.
 * Otherwise in six months "inferred from a log" reads as "an admin approved
 * this".
 *
 * So there is exactly one way to render a reviewer, and it is this. The word
 * "reconstructed" sits on the same line as the name, so it cannot be read
 * without it.
 *
 * Three states, because absence has to read as absence:
 *   recorded       Reviewed by Micky B. · 10 Sep 2026
 *   reconstructed  Reviewer reconstructed from the audit log: Micky B. · 26 Jul 2026  [inferred]
 *   neither        Reviewed 26 Jul 2026 · reviewer not recorded
 */
export function ReviewerLine({
  reviewerId, source, reviewedAt, names,
}: {
  reviewerId: string | null
  source: 'recorded' | 'reconstructed' | null
  reviewedAt: string | null
  names: Record<string, string>
}) {
  if (!reviewedAt) return null
  const date = new Date(reviewedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const name = reviewerId ? (names[reviewerId] ?? `admin ${reviewerId.slice(0, 8)}`) : null

  if (!name || !source) {
    return (
      <p className="text-xs text-amber-800">
        Reviewed {date} · <span className="font-medium">reviewer not recorded</span>
      </p>
    )
  }

  if (source === 'reconstructed') {
    return (
      <p className="text-xs text-[#3D2E2E]/50" title="Inferred on 10 Sep 2026 from admin_audit_log (migration 0037). Not recorded at the time of the decision.">
        Reviewer reconstructed from the audit log: <span className="font-medium">{name}</span> · {date}
        <span className="ml-2 rounded-full border border-[#3D2E2E]/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">inferred</span>
      </p>
    )
  }

  return (
    <p className="text-xs text-[#3D2E2E]/70">
      Reviewed by <span className="font-medium">{name}</span> · {date}
    </p>
  )
}
