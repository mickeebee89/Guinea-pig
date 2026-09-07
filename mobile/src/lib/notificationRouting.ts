import { router } from 'expo-router'

// Single source of truth for where a notification (in-app card OR a tapped push)
// should navigate. Kept free of expo-notifications so the notifications screen
// doesn't pull the native push module.
//
// `data` shape: { type, session_id?, provider_id? } — matches both the in-app
// notification row and the `data` payload the push carries.
//
// ── RETURNS WHETHER IT NAVIGATED, AND THAT MATTERS ────────────────────────
// It used to return nothing, so a caller could not tell "I sent you somewhere"
// from "there was nowhere to send you". The notifications screen filled that
// gap with a hard-coded list of types allowed to open in a modal instead —
// admin_warning and admin_message — which is an allowlist a new type never
// joins. The cancellation messages landed straight into it: four paragraphs,
// clamped to two lines in the row, and tapping did nothing.
//
// Reporting the outcome lets the caller apply a RULE — if there is nowhere to
// go, open it in full — so nothing can be unreadable and a type added tomorrow
// inherits that without anyone remembering.
//
// A guard that fails (a session_accepted with no session_id) also returns
// false, which is correct: nothing happened, so the body should be shown.
export function routeForNotification(data: Record<string, any> | null | undefined): boolean {
  if (!data) return false
  const sessionId = data.session_id
  switch (data.type) {
    case 'session_accepted':
    case 'new_message':
      if (!sessionId) return false
      router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId } })
      return true
    case 'session_applied':
      router.push('/provider-dashboard')
      return true
    case 'review_reminder':
      if (!sessionId) return false
      router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId } })
      return true
    case 'new_availability':
    case 'stylist_invite':
      if (!data.provider_id) return false
      router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: data.provider_id } })
      return true
    case 'verification':
      router.push('/(app)/verify-payment' as any)
      return true
    default:
      // session_cancelled, session_completed, session_declined, payment_failed,
      // admin_warning, admin_message, system, and anything added later. No
      // destination, so the caller shows the body rather than doing nothing.
      return false
  }
}
