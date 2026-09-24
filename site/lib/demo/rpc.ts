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

    case 'cancel_sessions_for_block':
      return { ok: true, cancelled: 0 }

    default:
      throw new Error(`${name} is not available in demo mode`)
  }
}
