import { supabase } from './supabase'

/**
 * Resolve moderation reviewer ids to display names.
 *
 * ── WHY THIS IS ONE HELPER AND NOT A LOOKUP PER PAGE ──────────────────────
 * Reviewer ids are auth.users ids (verification_requests.reviewed_by since
 * 0036, reports.reviewed_by and status_posts.reviewed_by from the start). The
 * console cannot read auth.users, so a name comes from public.users where a row
 * exists — and a reviewer with no app account falls back to an id prefix rather
 * than to a blank that reads as "nobody".
 *
 * Every display of a reviewer goes through here and through ReviewerLine, so
 * the reconstructed marker cannot be forgotten by the next screen that shows
 * one. Audit item 34.
 */
export async function reviewerNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return {}

  const { data, error } = await supabase
    .from('users')
    .select('id, first_name, last_initial')
    .in('id', unique)
  if (error) console.error('[reviewers] name lookup failed', error)

  const out: Record<string, string> = {}
  for (const id of unique) out[id] = `admin ${id.slice(0, 8)}`
  for (const u of (data ?? []) as { id: string; first_name: string; last_initial: string | null }[]) {
    out[u.id] = `${u.first_name}${u.last_initial ? ` ${u.last_initial}.` : ''}`
  }
  return out
}
