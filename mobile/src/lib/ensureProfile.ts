import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface EnsureProfileResult {
  /** Resolved role for the app — from the existing/created users row or metadata. */
  role: string
  /** Set when a heal step failed; caller should surface it (not swallow). */
  error?: { message: string; code?: string }
}

// Self-heal half-created accounts. If signUp() succeeded (so the auth user exists)
// but the follow-up profile inserts failed — or were blocked by RLS before email
// confirmation — the user can authenticate yet has no users/providers row, leaving
// a silently broken account. On the first resolve after login we recreate ONLY the
// missing rows. Healthy accounts hit one SELECT (two for providers) and are never
// overwritten — no UPDATE/UPSERT is issued for rows that already exist.
export async function ensureProfile(session: Session): Promise<EnsureProfileResult> {
  const uid      = session.user.id
  const meta     = session.user.user_metadata ?? {}
  const metaRole = (meta.role as string | undefined) ?? 'model'

  // 1. Does the users row exist? (existence check doubles as the role lookup)
  const { data: existingUser, error: userSelErr } = await supabase
    .from('users')
    .select('role')
    .eq('id', uid)
    .maybeSingle()

  if (userSelErr) {
    console.error('ensureProfile: users lookup failed:', userSelErr)
    return { role: metaRole, error: userSelErr }
  }

  let role = (existingUser?.role as string | undefined) ?? metaRole

  // Only a MISSING users row signals a genuine half-created account. This flag gates
  // providers creation below — a healthy/fresh-signup provider already has its row
  // created by its own signup flow, so we must not touch providers in that case.
  const userWasMissing = !existingUser

  // 2. Recreate the users row ONLY if missing — healthy profiles are left untouched.
  //    Reuse the same placeholder/constant fallbacks ConfirmEmailScreen uses. Newer
  //    signups now persist first_name/last_initial into user_metadata, so those heal
  //    with real names; older half-created accounts fall back to placeholders.
  if (!existingUser) {
    // Race-safe write: a concurrent signup insert can land between the SELECT above
    // and this write, so upsert with ignoreDuplicates — an existing row becomes a
    // harmless no-op (never overwritten) instead of a unique-violation crash.
    const { error: userUpsertErr } = await supabase.from('users').upsert({
      id:           uid,
      email:        session.user.email ?? '',
      role:         metaRole,
      first_name:   (meta.first_name as string | undefined) || '',
      last_initial: (meta.last_initial as string | undefined) || null,
      region:       'UK',
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (userUpsertErr) {
      console.error('ensureProfile: users recreate failed:', userUpsertErr)
      return { role: metaRole, error: userUpsertErr }
    }
    role = metaRole
  }

  // 3. Providers row — ONLY for a genuinely orphaned account (users row was missing
  //    and we just recreated it). providers has no user_id unique constraint to
  //    upsert against, so we can't dedupe via onConflict; instead we gate on
  //    userWasMissing. A healthy/fresh-signup provider already gets its providers row
  //    from its own signup flow — touching it here would race that insert and collide
  //    on the providers pkey (23505). In the orphan case that race doesn't exist, so
  //    a plain check-then-insert is safe.
  if (role === 'provider' && userWasMissing) {
    const { data: existingProv, error: provSelErr } = await supabase
      .from('providers')
      .select('id')
      .eq('user_id', uid)
      .maybeSingle()
    if (provSelErr) {
      console.error('ensureProfile: providers lookup failed:', provSelErr)
      return { role, error: provSelErr }
    }

    if (!existingProv) {
      const { error: provInsErr } = await supabase.from('providers').insert({ user_id: uid })
      if (provInsErr) {
        console.error('ensureProfile: providers recreate failed:', provInsErr)
        return { role, error: provInsErr }
      }
    }
  }

  return { role }
}
