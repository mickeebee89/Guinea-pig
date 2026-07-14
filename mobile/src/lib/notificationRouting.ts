import { router } from 'expo-router'

// Single source of truth for where a notification (in-app card OR a tapped push)
// should navigate. Kept free of expo-notifications so the notifications screen
// doesn't pull the native push module.
//
// `data` shape: { type, session_id?, provider_id? } — matches both the in-app
// notification row and the `data` payload the push carries.
export function routeForNotification(data: Record<string, any> | null | undefined) {
  if (!data) return
  const sessionId = data.session_id
  switch (data.type) {
    case 'session_accepted':
    case 'new_message':
      if (sessionId) router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId } })
      break
    case 'session_applied':
      router.push('/provider-dashboard')
      break
    case 'review_reminder':
      if (sessionId) router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId } })
      break
    case 'new_availability':
    case 'stylist_invite':
      if (data.provider_id) router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: data.provider_id } })
      break
    case 'verification':
      router.push('/(app)/verify-payment' as any)
      break
    default:
      // Unknown / session_completed etc. — no navigation (app just opens).
      break
  }
}
