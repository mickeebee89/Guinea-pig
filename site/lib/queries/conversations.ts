import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { indexById, displayName, type ProviderRef, type ProfileRef, type TreatmentRef } from './util'

/**
 * The conversation list. Ported from mobile/src/app/(app)/messages.tsx:104-268.
 *
 * Every rule below exists on mobile for a stated reason, so it is reproduced
 * rather than reinvented — a web list that shows a different set of
 * conversations to the same account is a bug that is very hard to see and very
 * easy to argue about.
 *
 * Takes the client as an argument rather than importing one, so the module is
 * usable from a Server Component or the browser without dragging either client
 * into the import graph of the other half. See scripts/check-client-boundary.mjs.
 */

export interface ConversationSummary {
  sessionId: string
  sessionDate: string
  treatmentName: string | null
  treatmentCategory: string | null
  status: string
  otherPartyName: string
  otherPartyPic: string | null
  /**
   * providers.id when the other party is a stylist, the auth user id when they
   * are a model. NOT interchangeable — the two profile routes take different
   * kinds of id, and swapping them silently 404s.
   */
  otherPartyId: string | null
  otherPartyKind: 'stylist' | 'model'
  lastContent: string | null
  lastTime: string
  lastSenderId: string | null
  unreadCount: number
  /** True when the signed-in user is the model in this session. */
  isModel: boolean
}

export async function getConversations(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConversationSummary[]> {
  const { data: provRow } = await supabase
    .from('providers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  const myProviderId = (provRow as { id?: string } | null)?.id

  const orClause = myProviderId
    ? `model_user_id.eq.${userId},provider_id.eq.${myProviderId}`
    : `model_user_id.eq.${userId}`

  const { data: sessionsRaw, error: sessErr } = await supabase
    .from('sessions')
    .select('id, provider_id, model_user_id, date, treatment_id, status, created_at')
    .or(orClause)
    // Hide only dead conversations. cancelled and declined drop off; pending,
    // accepted and completed stay, so history remains reachable.
    .not('status', 'in', '(cancelled,declined)')
    .order('created_at', { ascending: false })
  if (sessErr) throw sessErr

  const sessions = (sessionsRaw ?? []) as {
    id: string
    provider_id: string
    model_user_id: string
    date: string
    treatment_id: string | null
    status: string
    created_at: string
  }[]
  if (sessions.length === 0) return []

  const sessionIds   = sessions.map(s => s.id)
  const providerIds  = [...new Set(sessions.map(s => s.provider_id))]
  const modelUserIds = [...new Set(sessions.map(s => s.model_user_id))]
  const treatmentIds = [...new Set(sessions.map(s => s.treatment_id).filter(Boolean) as string[])]

  const [provInfos, modelInfos, treatInfos, msgsRes, blocked] = await Promise.all([
    supabase.from('providers').select('id, user_id, name, profile_pic_url').in('id', providerIds),
    // public_profiles, not users: users RLS blocks reading other people's rows.
    supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').in('id', modelUserIds),
    treatmentIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatmentIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('messages')
      .select('id, session_id, sender_id, body, created_at, read_at')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false })
      .limit(300),
    getBlockedIds(supabase, userId).catch(() => new Set<string>()),
  ])

  // Surface a real query failure rather than rendering "no messages yet" over
  // it. A swallowed 42703 is what hid this exact bug on mobile before.
  if (msgsRes.error) {
    console.error('[conversations] messages query failed', msgsRes.error)
  }

  const provMap  = indexById<ProviderRef>(provInfos.data)
  const modelMap = indexById<ProfileRef>(modelInfos.data)
  const treatMap = indexById<TreatmentRef>(treatInfos.data)

  const msgs = (msgsRes.data ?? []) as {
    id: string; session_id: string; sender_id: string
    body: string; created_at: string; read_at: string | null
  }[]

  // Only openable chats run mark-as-read, so only they may show an unread
  // badge — otherwise it sticks forever. Locked sessions (pending, cancelled,
  // declined) never clear. Mirrors the mobile header badge.
  const openable = new Set(
    sessions.filter(s => s.status === 'accepted' || s.status === 'completed').map(s => s.id),
  )

  const lastBySession: Record<string, typeof msgs[number]> = {}
  const unreadBySession: Record<string, number> = {}
  for (const m of msgs) {
    if (!lastBySession[m.session_id]) lastBySession[m.session_id] = m
    if (!m.read_at && m.sender_id !== userId && openable.has(m.session_id)) {
      unreadBySession[m.session_id] = (unreadBySession[m.session_id] ?? 0) + 1
    }
  }

  return sessions
    .filter(s => {
      // Other party = the provider's OWNING USER when I'm the model, or the
      // model's user id when I'm the provider. Blocking is by user, not by
      // provider row.
      const otherUserId = s.model_user_id === userId
        ? provMap[s.provider_id]?.user_id
        : s.model_user_id
      return !(otherUserId && blocked.has(otherUserId))
    })
    .map((s): ConversationSummary => {
      const isModel = s.model_user_id === userId
      const prov    = provMap[s.provider_id]
      const model   = modelMap[s.model_user_id]
      const treat   = s.treatment_id ? treatMap[s.treatment_id] : null
      const last    = lastBySession[s.id]

      return {
        sessionId:         s.id,
        sessionDate:       s.date,
        treatmentName:     treat?.name ?? null,
        treatmentCategory: treat?.category ?? null,
        status:            s.status,
        otherPartyName: isModel ? (prov?.name ?? 'Stylist') : displayName(model),
        otherPartyPic: isModel ? (prov?.profile_pic_url ?? null) : (model?.profile_pic_url ?? null),
        otherPartyId:  isModel ? (s.provider_id ?? null) : (s.model_user_id ?? null),
        otherPartyKind: isModel ? 'stylist' : 'model',
        lastContent:   last?.body ?? null,
        lastTime:      last?.created_at ?? s.created_at,
        lastSenderId:  last?.sender_id ?? null,
        unreadCount:   unreadBySession[s.id] ?? 0,
        isModel,
      }
    })
    .sort((a, b) => new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime())
}
