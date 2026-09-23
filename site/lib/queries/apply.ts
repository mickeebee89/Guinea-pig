import type { SupabaseClient } from '@supabase/supabase-js'
import { getGateState } from '@/lib/verification'
import { getIdCheck, type IdCheck } from '@/lib/queries/idCheck'
import { loadActiveConsentDocument, type ConsentDocument } from '@/lib/queries/consent'

/**
 * Everything the apply wizard needs, in one read. Audit item 83.
 *
 * ── THE ORDER OF THE GATES IS THE PRODUCT DECISION ────────────────────────
 * Membership, then ID check, then the booking. Mobile routes the same way
 * (apply-session.tsx:200-224) and the database now refuses anything else
 * (0049). This function reports both so the wizard can say which one is in
 * the way, rather than letting her fill in seven screens and be refused at
 * the end.
 */

export interface ApplySlot {
  id: string
  date: string
  startTime: string
  endTime: string
  treatmentIds: string[]
  pricePence: number | null
  isTaken: boolean
}

export interface ApplyTreatment {
  id: string
  name: string
  category: string | null
}

export interface ApplyPhoto {
  id: string
  path: string
  /** Short-lived signed URL — the bucket is private. */
  url: string
}

export interface ApplyContext {
  provider: { id: string; name: string; userId: string | null; isPublished: boolean }
  subscribed: boolean
  verified: boolean
  idCheck: IdCheck
  slots: ApplySlot[]
  treatments: ApplyTreatment[]
  photos: ApplyPhoto[]
  consent: ConsentDocument | null
  /** Why consent could not be shown. Applying is blocked while this is set. */
  consentProblem: string | null
}

const hhmm = (t: string) => t.substring(0, 5)

export async function getApplyContext(
  supabase: SupabaseClient,
  providerId: string,
  userId: string,
): Promise<ApplyContext | null> {
  const { data: prov } = await supabase
    .from('providers')
    .select('id, name, user_id, is_published')
    .eq('id', providerId)
    .maybeSingle()
  const p = prov as { id: string; name: string | null; user_id: string | null; is_published: boolean | null } | null
  if (!p) return null

  const today = new Date().toISOString().slice(0, 10)

  const [gate, idCheck, slotRes, treatRes, photoRes, consentLoad] = await Promise.all([
    getGateState(supabase, userId),
    getIdCheck(supabase, userId),
    supabase
      .from('availability')
      .select('id, date, start_time, end_time, active_treatments, is_taken, price_pence')
      .eq('provider_id', providerId)
      .gte('date', today)
      .order('date')
      .order('start_time'),
    supabase.from('provider_treatments').select('id, name, category').eq('provider_id', providerId),
    supabase
      .from('model_photos')
      .select('id, photo_url')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(12),
    loadActiveConsentDocument(supabase),
  ])

  const rawSlots = (slotRes.data ?? []) as {
    id: string; date: string; start_time: string; end_time: string
    active_treatments: string[] | null; is_taken: boolean | null; price_pence: number | null
  }[]

  // Which of these already have a pending or accepted booking. `is_taken` is
  // the stylist's own flag and does not know about applications, so both are
  // read — and a failure here treats everything as taken rather than risk
  // offering a slot that is gone. Mobile takes the same line.
  let booked = new Set<string>()
  if (rawSlots.length > 0) {
    const { data: sess, error } = await supabase
      .from('sessions')
      .select('availability_id')
      .in('availability_id', rawSlots.map(s => s.id))
      .in('status', ['pending', 'accepted'])
    booked = error
      ? new Set(rawSlots.map(s => s.id))
      : new Set(((sess ?? []) as { availability_id: string }[]).map(r => r.availability_id))
  }

  const photoRows = (photoRes.data ?? []) as { id: string; photo_url: string }[]
  const photos: ApplyPhoto[] = []
  if (photoRows.length > 0) {
    const { data: signed } = await supabase.storage
      .from('model-photos')
      .createSignedUrls(photoRows.map(r => r.photo_url), 60 * 30)
    const byPath = new Map(
      ((signed ?? []) as { path: string | null; signedUrl: string }[])
        .filter(s => s.path)
        .map(s => [s.path as string, s.signedUrl]),
    )
    for (const r of photoRows) {
      const url = byPath.get(r.photo_url)
      // A photo whose URL would not sign is left out rather than rendered as a
      // broken tile she might still tick.
      if (url) photos.push({ id: r.id, path: r.photo_url, url })
    }
  }

  return {
    provider: {
      id: p.id,
      name: p.name?.trim() || 'This stylist',
      userId: p.user_id,
      isPublished: !!p.is_published,
    },
    subscribed: gate.subscribed,
    verified: gate.verified,
    idCheck,
    slots: rawSlots.map(s => ({
      id: s.id,
      date: s.date,
      startTime: hhmm(s.start_time),
      endTime: hhmm(s.end_time),
      treatmentIds: s.active_treatments ?? [],
      pricePence: s.price_pence,
      isTaken: !!s.is_taken || booked.has(s.id),
    })),
    treatments: ((treatRes.data ?? []) as ApplyTreatment[]),
    photos,
    consent: consentLoad.ok ? consentLoad.doc : null,
    consentProblem: consentLoad.ok ? null : consentLoad.reason,
  }
}
