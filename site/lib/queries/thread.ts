import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'

/**
 * One conversation. Ported from mobile/src/app/(app)/chat/[sessionId].tsx:133-224.
 *
 * The three state rules are mobile's, reproduced exactly:
 *   * messages load only when the session is `accepted` or `completed`
 *   * the composer appears only when `accepted` AND not blocked
 *   * `completed` is read-only, and says why rather than just omitting the box
 *
 * KNOWN PARITY GAP, DELIBERATE: mobile also shows the stylist the photos the
 * model attached when applying (chat/[sessionId].tsx:147-160). Those live in a
 * private bucket and need signed URLs, which is its own piece of work. Text
 * chat and the safety controls are what slice 2 promised; photos are noted here
 * so the omission is a decision rather than something nobody noticed.
 */

export interface ThreadMessage {
  id: string
  session_id: string
  sender_id: string
  body: string
  created_at: string
  read_at: string | null
}

export interface Thread {
  session: {
    id: string
    provider_id: string
    model_user_id: string
    date: string
    start_time: string | null
    end_time: string | null
    status: string
  }
  isModel: boolean
  otherParty: { name: string; picUrl: string | null; userId: string | null }
  treatmentCategory: string | null
  messages: ThreadMessage[]
  isBlocked: boolean
  /** Composer visible. Mirrors mobile: accepted only, and never when blocked. */
  canSend: boolean
  /** Realtime is worth subscribing to. Mobile subscribes on accepted only. */
  isLive: boolean
}

export async function getThread(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<Thread | null> {
  const { data: sessionData } = await supabase
    .from('sessions')
    .select('id, provider_id, model_user_id, date, start_time, end_time, treatment_id, status')
    .eq('id', sessionId)
    .maybeSingle()
  // Null covers both "no such session" and "RLS says this isn't yours" — the
  // caller must treat them the same and 404, or it becomes an existence oracle.
  if (!sessionData) return null

  const s = sessionData as Thread['session'] & { treatment_id: string | null }
  const isModel = s.model_user_id === userId

  const [treatRes, otherRes] = await Promise.all([
    s.treatment_id
      ? supabase.from('provider_treatments').select('id, category').eq('id', s.treatment_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    isModel
      ? supabase.from('providers').select('id, name, profile_pic_url, user_id').eq('id', s.provider_id).maybeSingle()
      : supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').eq('id', s.model_user_id).maybeSingle(),
  ])

  const od = otherRes.data as Record<string, string | null> | null
  const otherUserId = isModel ? (od?.user_id ?? null) : s.model_user_id
  const otherParty = isModel
    ? {
        name: (od?.name as string) ?? 'Stylist',
        picUrl: od?.profile_pic_url ?? null,
        userId: otherUserId,
      }
    : {
        name: od?.first_name ? `${od.first_name} ${od.last_initial ?? ''}.`.trim() : 'Model',
        picUrl: od?.profile_pic_url ?? null,
        userId: otherUserId,
      }

  let isBlocked = false
  if (otherUserId) {
    const blocked = await getBlockedIds(supabase, userId).catch(() => new Set<string>())
    isBlocked = blocked.has(otherUserId)
  }

  const readable = s.status === 'accepted' || s.status === 'completed'
  let messages: ThreadMessage[] = []

  if (readable) {
    const { data } = await supabase
      .from('messages')
      .select('id, session_id, sender_id, body, created_at, read_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
    messages = (data ?? []) as ThreadMessage[]
  }

  return {
    session: s,
    isModel,
    otherParty,
    treatmentCategory: (treatRes.data as { category?: string } | null)?.category ?? null,
    messages,
    isBlocked,
    canSend: s.status === 'accepted' && !isBlocked,
    isLive: s.status === 'accepted',
  }
}

/**
 * Mark everything the other person sent as read.
 *
 * Separate from getThread because it is a WRITE, and getThread runs during
 * render on the server — a Server Component that writes on render marks a
 * conversation read on a prefetch nobody looked at. Called from the client once
 * the thread is actually on screen.
 */
export async function markThreadRead(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .neq('sender_id', userId)
    .is('read_at', null)
}
