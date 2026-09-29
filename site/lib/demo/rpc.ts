/**
 * DEMO MODE — the three database functions the web site calls. Audit item 69.
 * Enough to keep the buttons from erroring; not a copy of the real rules.
 */
import type { DemoStore, DemoUser, Row } from './engine'

export function demoRpc(name: string, args: Row, store: DemoStore, user: DemoUser | null): unknown {
  switch (name) {
    // Nobody is suspended in the demo.
    case 'my_suspension':
      return []

    // Every demo stylist has a real bio, so nothing is held back. Returning
    // null here is the "nothing wrong" answer, not a stub that skips the check.
    case 'bio_publish_problem':
      return null

    case 'cancel_booking': {
      const s = store.tables.sessions.find(r => r.id === args.p_session_id)
      if (!s) throw new Error('cancel_booking: booking not found')
      Object.assign(s, { status: 'cancelled', cancelled_by: user?.id ?? null, cancelled_at: new Date().toISOString(),
        cancellation_reason: (args.p_reason as string | null) ?? null })
      return { ok: true, session_id: s.id, notified: false }
    }

    /**
     * ⚠️ WITHOUT THIS THE WIZARD ENDS ON AN ERROR. It reached the default
     * below and threw "not available in demo mode", so the last frame of a
     * recorded walkthrough was a failure — the same class of fault as the
     * missing consent document (item 129).
     *
     * It writes the booking the way the real function does, in the sense that
     * matters for a demo: a pending session against the chosen slot, with the
     * slot marked taken so the availability screens agree with it afterwards.
     * It does NOT write a consent row, because nothing in demo mode reads one;
     * the wizard's own consent step is what the video is there to show.
     *
     * The real function is one transaction in the database (0010), and this is
     * a stand-in for a recording. It is not a second implementation of the
     * rule — nothing here is authoritative about anything.
     */
    case 'create_session_with_consent': {
      const slot = store.tables.availability.find(a => a.id === args.p_availability_id)
      if (slot) slot.is_taken = true
      const id = 'd0000000-0000-4000-8000-' + String(9000 + store.tables.sessions.length).padStart(12, '0')
      store.tables.sessions.push({
        id,
        provider_id: args.p_provider_id,
        model_user_id: user?.id ?? null,
        model_id: user?.id ?? null,
        availability_id: args.p_availability_id,
        treatment_id: args.p_treatment_id ?? null,
        date: args.p_date,
        start_time: args.p_start_time,
        end_time: args.p_end_time,
        scheduled_at: args.p_scheduled_at,
        duration_minutes: args.p_duration_minutes,
        location_type: args.p_location_type ?? 'provider',
        note: (args.p_note as string | null) ?? null,
        photo_urls: (args.p_photo_urls as string[] | null) ?? [],
        status: 'pending',
        created_at: new Date().toISOString(),
        cancelled_by: null, cancelled_at: null, cancellation_reason: null,
        price_pence: (slot?.price_pence as number | null) ?? null,
      })
      return id
    }

    case 'cancel_sessions_for_block':
      return { ok: true, cancelled: 0 }

    default:
      throw new Error(`${name} is not available in demo mode`)
  }
}
