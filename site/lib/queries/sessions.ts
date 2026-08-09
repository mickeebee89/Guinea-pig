import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { indexById, displayName, type ProviderRef, type ProfileRef, type TreatmentRef } from './util'

/**
 * The signed-in user's bookings, in BOTH roles.
 *
 * ── WHERE THIS DEPARTS FROM MOBILE, AND WHY ────────────────────────────────
 * mobile/src/app/(app)/sessions.tsx is provider-only: it looks up the user's
 * providers row and returns early if there isn't one (line 110), so a model
 * opening it sees nothing. Models reach their bookings by other routes there.
 *
 * On web a single /sessions page that is blank for every model would read as
 * broken, so this returns both roles. That is a gap being filled rather than a
 * divergence being created — there is no mobile behaviour here to disagree
 * with. If a model-side sessions screen is ever built on mobile, the two should
 * be reconciled.
 *
 * Read-only. Accept and decline are slice 4 (provider side).
 */

export interface SessionRow {
  id: string
  role: 'model' | 'provider'
  date: string
  startTime: string | null
  endTime: string | null
  status: string
  note: string | null
  treatmentName: string | null
  treatmentCategory: string | null
  otherPartyName: string
  otherPartyPic: string | null
}

export async function getSessions(
  supabase: SupabaseClient,
  userId: string,
): Promise<SessionRow[]> {
  const { data: provRow } = await supabase
    .from('providers').select('id').eq('user_id', userId).maybeSingle()
  const myProviderId = (provRow as { id?: string } | null)?.id

  const orClause = myProviderId
    ? `model_user_id.eq.${userId},provider_id.eq.${myProviderId}`
    : `model_user_id.eq.${userId}`

  const { data: raw, error } = await supabase
    .from('sessions')
    .select('id, provider_id, model_user_id, date, start_time, end_time, treatment_id, note, status')
    .or(orClause)
    .in('status', ['pending', 'accepted', 'completed'])
    .order('date', { ascending: false })
  if (error) throw error

  const rows = (raw ?? []) as {
    id: string; provider_id: string; model_user_id: string
    date: string; start_time: string | null; end_time: string | null
    treatment_id: string | null; note: string | null; status: string
  }[]
  if (rows.length === 0) return []

  const providerIds = [...new Set(rows.map(r => r.provider_id))]
  const modelIds    = [...new Set(rows.map(r => r.model_user_id))]
  const treatIds    = [...new Set(rows.map(r => r.treatment_id).filter(Boolean) as string[])]

  const [provRes, modelRes, treatRes, blocked] = await Promise.all([
    supabase.from('providers').select('id, user_id, name, profile_pic_url').in('id', providerIds),
    supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').in('id', modelIds),
    treatIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
      : Promise.resolve({ data: [], error: null }),
    getBlockedIds(supabase, userId).catch(() => new Set<string>()),
  ])

  const provMap  = indexById<ProviderRef>(provRes.data)
  const modelMap = indexById<ProfileRef>(modelRes.data)
  const treatMap = indexById<TreatmentRef>(treatRes.data)

  return rows
    .filter(r => {
      const otherUserId = r.model_user_id === userId
        ? provMap[r.provider_id]?.user_id
        : r.model_user_id
      return !(otherUserId && blocked.has(otherUserId))
    })
    .map((r): SessionRow => {
      const isModel = r.model_user_id === userId
      const prov  = provMap[r.provider_id]
      const model = modelMap[r.model_user_id]
      const treat = r.treatment_id ? treatMap[r.treatment_id] : null
      return {
        id: r.id,
        role: isModel ? 'model' : 'provider',
        date: r.date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        note: r.note,
        treatmentName: treat?.name ?? null,
        treatmentCategory: treat?.category ?? null,
        otherPartyName: isModel ? (prov?.name ?? 'Stylist') : displayName(model),
        otherPartyPic: isModel ? (prov?.profile_pic_url ?? null) : (model?.profile_pic_url ?? null),
      }
    })
}
