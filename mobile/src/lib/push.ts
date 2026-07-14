import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { supabase } from '@/lib/supabase'
import { routeForNotification } from '@/lib/notificationRouting'

// EAS project id (from app.json → extra.eas.projectId) — required by getExpoPushTokenAsync.
const PROJECT_ID = '2552e7c0-8cc8-4dfe-ac8b-80b577e835a0'

// Foreground display behaviour. SDK 56 uses shouldShowBanner/shouldShowList (NOT shouldShowAlert).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

// The Expo push token registered for THIS device this session — kept so we can remove
// exactly it on sign-out (before the session/RLS context is gone).
let currentToken: string | null = null

async function registerToken(userId: string) {
  if (!Device.isDevice) return   // emulators can't get a real remote push token

  let { granted } = await Notifications.getPermissionsAsync()
  if (!granted) {
    ;({ granted } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    }))
  }
  if (!granted) return

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
    })
  }

  let token: string
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data
  } catch {
    return
  }
  currentToken = token
  // One row per device token; re-registering the same token refreshes it (and moves it to
  // the current user if the device was previously signed in as someone else).
  await supabase.from('push_tokens').upsert(
    { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  )
}

// Remove this device's token. Call on sign-out BEFORE clearing the session (RLS needs it).
export async function clearPushToken() {
  if (!currentToken) return
  try { await supabase.from('push_tokens').delete().eq('token', currentToken) } catch {}
  currentToken = null
}

// Registers the token for the signed-in user and wires tap-to-route (cold + warm start).
// Safe to call with undefined (no-op) so it can live at the top of a component.
export function usePushRegistration(userId: string | undefined) {
  const handledColdStart = useRef(false)
  useEffect(() => {
    if (!userId) return
    registerToken(userId).catch(() => {})

    // Cold start: app was launched by tapping a notification.
    if (!handledColdStart.current) {
      handledColdStart.current = true
      Notifications.getLastNotificationResponseAsync()
        .then(resp => { if (resp) routeForNotification(resp.notification.request.content.data as any) })
        .catch(() => {})
    }

    // Warm: notification tapped while the app is running/backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      routeForNotification(resp.notification.request.content.data as any)
    })
    return () => sub.remove()
  }, [userId])
}
