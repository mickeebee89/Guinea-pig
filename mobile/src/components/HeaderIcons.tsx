import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

/**
 * Shared header icons (messages + notifications) used on the model home and the
 * provider dashboard. Single source of truth for the unread badge/dot logic.
 * Renders two buttons as a fragment so it drops straight into an existing header row.
 */
export default function HeaderIcons() {
  const router      = useRouter()
  const { session } = useAuth()
  const userId      = session?.user?.id

  const [unreadNotifs,  setUnreadNotifs]  = useState(0)
  const [hasUnreadMsgs, setHasUnreadMsgs] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) { setUnreadNotifs(0); setHasUnreadMsgs(false); return }
    const [{ count: notifCount }, { count: msgCount }] = await Promise.all([
      // Unread notifications addressed to me.
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
      // Unread messages NOT sent by me. messages is participant-scoped by RLS, so this
      // only counts messages in my own sessions — no manual session join needed. read_at
      // is set on chat open, so the dot clears once the conversation is viewed.
      // Only count messages in READABLE sessions (accepted/completed): a cancelled
      // session's chat is locked and never runs the mark-as-read step, so its unread
      // messages are unreachable and must not keep the dot lit (e.g. after a block
      // auto-cancels the booking).
      supabase
        .from('messages')
        .select('id, sessions!inner(status)', { count: 'exact', head: true })
        .neq('sender_id', userId)
        .is('read_at', null)
        .in('sessions.status', ['accepted', 'completed']),
    ])
    setUnreadNotifs(notifCount ?? 0)
    setHasUnreadMsgs((msgCount ?? 0) > 0)
  }, [userId])

  // Refresh both indicators whenever the screen regains focus (after reading msgs/notifs).
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  return (
    <>
      <TouchableOpacity
        style={styles.bellBtn}
        activeOpacity={0.75}
        onPress={async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          router.push('/(app)/messages' as any)
        }}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={Colors.warmDark} />
        {hasUnreadMsgs && <View style={styles.msgDot} />}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.bellBtn}
        activeOpacity={0.75}
        onPress={async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          router.push('/(app)/notifications' as any)
        }}
      >
        <Ionicons name="notifications-outline" size={22} color={Colors.warmDark} />
        {unreadNotifs > 0 && (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{unreadNotifs > 9 ? '9+' : String(unreadNotifs)}</Text>
          </View>
        )}
      </TouchableOpacity>
    </>
  )
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: -0.2,
  },
  msgDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.rose,
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
})
