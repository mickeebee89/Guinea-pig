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
    .select('role, date_of_birth')
    .eq('id', uid)
    .maybeSingle()

  if (userSelErr) {
    console.error('ensureProfile: users lookup failed:', userSelErr)
    return { role: metaRole, error: userSelErr }
  }

  let role = (existingUser?.role as string | undefined) ?? metaRole

  // 2. Recreate the users row ONLY if missing — healthy profiles are left untouched.
  //    Reuse the same placeholder/constant fallbacks ConfirmEmailScreen uses. Newer
  //    signups now persist first_name/last_initial into user_metadata, so those heal
  //    with real names; older half-created accounts fall back to placeholders.
  if (!existingUser) {
    // Race-safe write: the auth.users trigger (single source of truth) can create this
    // row between the SELECT above and this write, so upsert with ignoreDuplicates —
    // an existing row becomes a harmless no-op (never overwritten), not a 23505 crash.
    const { error: userUpsertErr } = await supabase.from('users').upsert({
      id:           uid,
      email:        session.user.email ?? '',
      role:         metaRole,
      first_name:   (meta.first_name as string | undefined) || '',
      last_name:    (meta.last_name as string | undefined) || null,
      last_initial: (meta.last_initial as string | undefined) || null,
      date_of_birth:(meta.date_of_birth as string | undefined) || null,
      region:       'UK',
    }, { onConflict: 'id', ignoreDuplicates: true })
    // ignoreDuplicates makes this ON CONFLICT DO NOTHING, so a row the auth.users
    // trigger created concurrently is a silent no-op. Guard 23505 too as defence in
    // depth — it's now expected/benign, never a failure. Surface any other error.
    if (userUpsertErr && userUpsertErr.code !== '23505') {
      console.error('ensureProfile: users recreate failed:', userUpsertErr)
      return { role: metaRole, error: userUpsertErr }
    }
    role = metaRole
  }

  // 2b. Backfill date_of_birth from signup metadata when the column is still null.
  //     The auth.users trigger creates the users row WITHOUT the DOB, so a normal
  //     signup lands here — this is what actually gets the DOB into public.users.
  //     Guarded on null, so a healthy row is written at most once and an existing
  //     value is never overwritten. Non-fatal: a failure here must not block login.
  const metaDob = meta.date_of_birth as string | undefined
  if (existingUser && !(existingUser as any).date_of_birth && metaDob) {
    const { error: dobErr } = await supabase
      .from('users')
      .update({ date_of_birth: metaDob })
      .eq('id', uid)
    if (dobErr) console.error('ensureProfile: date_of_birth backfill failed:', dobErr)
  }

  // 3. Providers row — self-heal only if genuinely missing. The auth.users trigger is
  //    the single source of truth and creates this row on signup; we only recreate it
  //    for a provider that somehow lacks one. providers has NO user_id UNIQUE constraint
  //    (only pkey on id), so we CANNOT dedupe via .upsert({ onConflict: 'user_id' }) —
  //    that would raise 42P10, not a benign no-op. Instead gate on an existence check.
  if (role === 'provider') {
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
      // The SELECT above is not atomic with this insert: the trigger can create the row
      // in between. A unique/pk violation (23505) therefore means "already created" —
      // treat as a benign no-op. Surface any other (genuine) error.
      const { error: provInsErr } = await supabase.from('providers').insert({ user_id: uid })
      if (provInsErr && provInsErr.code !== '23505') {
        console.error('ensureProfile: providers recreate failed:', provInsErr)
        return { role, error: provInsErr }
      }
    }
  }

  return { role }
}
