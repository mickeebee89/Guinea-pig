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

    /**
     * ⚠⚠ WITHOUT THIS, EVERY STYLIST PAGE AND THE APPLY WIZARD THROW IN DEMO
     * MODE. 0090 added slot_contention and item 186's shared loader calls it on
     * both surfaces; demoRpc's default throws on an unknown name, deliberately,
     * so a missing mock is loud. Same class as transition_session below — found
     * the same way, by asking what the demo does with a newly added RPC rather
     * than by watching it break on camera.
     *
     * ⚠⚠ IT KEYS ON (provider_id, date, start_time), NOT availability_id, AND
     * THAT IS NOT A STYLISTIC CHOICE. `sessions_active_slot_uniq` collides on
     * that triple, two availability rows may share a start_time with different
     * end_times, and 0090's header explains at length why keying on
     * availability_id reintroduces item 192. **A demo that used the easier key
     * would disagree with the database about which slots are free** — which is
     * the one thing a walkthrough must not do.
     *
     * The statuses are 0090's list too. If a third occupying status is ever
     * added, the migration's guard catches the database side and nothing catches
     * this — so it is named here as the second place to change.
     */
    case 'slot_contention': {
      const providerId = args.p_provider_id as string
      const key = (r: Row) => `${r.date as string}T${r.start_time as string}`
      const occupied = new Set(
        store.tables.sessions
          .filter(r => r.provider_id === providerId
            && (r.status === 'pending' || r.status === 'accepted'))
          .map(key),
      )
      return store.tables.availability
        .filter(r => r.provider_id === providerId)
        .map(r => ({ availability_id: r.id as string, contested: occupied.has(key(r)) }))
    }

    /**
     * ⚠️ WITHOUT THIS, ACCEPT AND DECLINE BREAK ON CAMERA. Since 0078 the web
     * calls transition_session instead of updating sessions directly, and
     * demoRpc's default THROWS on an unknown name — so a recorded walkthrough
     * would end on an error at the moment the stylist accepts. Same class as
     * the wizard fault below.
     *
     * It absorbs the no-op the way the real function does, because the
     * recording clicks once and a stray second click should not look different.
     *
     * It writes NO notification, matching cancel_booking above and
     * report_not_held below: demo RPCs do not notify, and fixtures seed the
     * notifications a walkthrough needs. Not a second implementation of the
     * rule — nothing here is authoritative about anything.
     */
    /**
     * ⚠️ THE SALON FLOOR INVITE IS REACHABLE IN A WALKTHROUGH, and demoRpc's
     * default THROWS — so without this a recording ends on an error the moment
     * the stylist invites a model from the wall.
     *
     * Writes NO notification, matching every other case here: demo RPCs do not
     * notify, and fixtures seed what a walkthrough needs.
     */
    case 'invite_model':
      return null

    case 'transition_session': {
      const s = store.tables.sessions.find(r => r.id === args.p_session_id)
      if (!s) return { ok: false, changed: false, reason: 'not_found_or_not_yours' }
      const to = args.p_to as string
      if (s.status === to) return { ok: true, changed: false, status: s.status }
      s.status = to
      return { ok: true, changed: true, status: to }
    }

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

    /**
     * ⚠️ WITHOUT THIS THE DEMO THROWS WHEN SOMEBODY PRESSES "It didn't happen".
     * The control renders on any accepted booking whose time has passed, and
     * the demo has one, so the button is reachable in every walkthrough.
     *
     * It stamps the CALLER'S OWN column, as the real function does — that is
     * the part worth mirroring, because a demo that let the caller choose
     * which party said so would misrepresent the one rule this feature is
     * built around. It writes no notification: nothing in demo mode reads one.
     */
    case 'report_not_held': {
      const sess = store.tables.sessions.find(s => s.id === args.p_session_id)
      if (!sess) return null
      const isModel = sess.model_user_id === user?.id
      const now = new Date().toISOString()
      if (isModel) sess.not_held_model_at = sess.not_held_model_at ?? now
      else sess.not_held_provider_at = sess.not_held_provider_at ?? now
      sess.status = 'not_held'
      return null
    }

    case 'cancel_sessions_for_block':
      return { ok: true, cancelled: 0 }

    default:
      throw new Error(`${name} is not available in demo mode`)
  }
}
