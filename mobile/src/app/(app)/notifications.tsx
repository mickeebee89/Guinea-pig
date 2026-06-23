import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import ScreenDecor from '@/components/ScreenDecor'

// ── Types ─────────────────────────────────────────────────────────────────────

type NotifType = string

type Notification = {
  id: string
  type: NotifType
  title: string
  body: string
  session_id: string | null
  data: Record<string, any> | null
  read_at: string | null
  created_at: string
}

type Filter = 'All' | 'Sessions' | 'Activity'

// ── Config ────────────────────────────────────────────────────────────────────

type IconCfg = { icon: string; color: string; bg: string; filter: 'Sessions' | 'Activity' }

const TYPE_CFG: Record<string, IconCfg> = {
  session_accepted: { icon: 'checkmark-circle',  color: '#1D9E75',      bg: '#ECFDF5',              filter: 'Sessions' },
  session_declined: { icon: 'close-circle',       color: Colors.error,   bg: '#FEF2F2',              filter: 'Sessions' },
  session_applied:  { icon: 'person-add',         color: Colors.roseDark,bg: Colors.softPink + '40', filter: 'Sessions' },
  new_message:      { icon: 'chatbubble',         color: Colors.rose,    bg: Colors.softPink + '30', filter: 'Activity' },
  review_reminder:  { icon: 'star',               color: '#F59E0B',      bg: '#FFFBEB',              filter: 'Activity' },
  verification:     { icon: 'shield-checkmark',   color: '#1D9E75',      bg: '#ECFDF5',              filter: 'Activity' },
  new_availability: { icon: 'calendar',           color: Colors.roseDark,bg: Colors.softPink + '40', filter: 'Activity' },
  stylist_invite:   { icon: 'sparkles',           color: '#7B5EA7',      bg: '#7B5EA720',            filter: 'Activity' },
  system:           { icon: 'information-circle', color: Colors.muted,   bg: Colors.inputBg,         filter: 'Activity' },
}

const DEFAULT_CFG: IconCfg = {
  icon: 'ellipse-outline', color: Colors.muted, bg: Colors.inputBg, filter: 'Activity',
}

function cfg(type: string): IconCfg {
  return TYPE_CFG[type] ?? DEFAULT_CFG
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const n = new Date()
  return d.getDate() === n.getDate() &&
    d.getMonth() === n.getMonth() &&
    d.getFullYear() === n.getFullYear()
}

function matchesFilter(n: Notification, filter: Filter): boolean {
  if (filter === 'All') return true
  const c = cfg(n.type)
  if (filter === 'Sessions') return c.filter === 'Sessions'
  return c.filter === 'Activity'
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const router = useRouter()
  const { session } = useAuth()
  const insets = useSafeAreaInsets()
  const userId = session?.user?.id

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [filter,        setFilter]        = useState<Filter>('All')
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [markingAll,    setMarkingAll]    = useState(false)
  const [fetchError,    setFetchError]    = useState<string | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) { setLoading(false); return }
    if (!isRefresh) setLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, session_id, data, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('[notifications] fetch error:', error.message)
      setFetchError(error.message)
    } else {
      setFetchError(null)
      setNotifications((data ?? []) as Notification[])
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load(true) }

  // ── Mark as read ───────────────────────────────────────────────────────────

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString()
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: now } : n))
    try {
      await supabase.from('notifications').update({ read_at: now }).eq('id', id)
    } catch {}
  }, [])

  const markAllRead = async () => {
    const hasUnread = notifications.some(n => !n.read_at)
    if (!hasUnread) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setMarkingAll(true)
    const now = new Date().toISOString()
    setNotifications(prev => prev.map(n => ({ ...n, read_at: now })))
    try {
      await supabase
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', userId)
        .is('read_at', null)
    } catch {}
    setMarkingAll(false)
  }

  // ── Tap notification ───────────────────────────────────────────────────────

  const handleTap = async (n: Notification) => {
    await Haptics.selectionAsync()
    if (!n.read_at) await markRead(n.id)

    const sessionId = n.session_id

    switch (n.type) {
      case 'session_accepted':
      case 'new_message':
        if (sessionId) {
          router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId } })
        }
        break
      case 'session_applied':
        router.push('/provider-dashboard')
        break
      case 'review_reminder':
        if (sessionId) {
          router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId } })
        }
        break
      case 'new_availability':
      case 'stylist_invite': {
        const providerId = n.data?.provider_id
        if (providerId) {
          router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: providerId } })
        }
        break
      }
      case 'verification':
        router.push('/(app)/verify-payment' as any)
        break
      default:
        break
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered    = notifications.filter(n => matchesFilter(n, filter))
  const todayItems  = filtered.filter(n => isToday(n.created_at))
  const earlierItems = filtered.filter(n => !isToday(n.created_at))
  const hasUnread   = notifications.some(n => !n.read_at)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenDecor />
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Notifications</Text>
        {hasUnread ? (
          <TouchableOpacity
            style={styles.markAllBtn}
            onPress={markAllRead}
            disabled={markingAll}
            activeOpacity={0.8}
          >
            {markingAll
              ? <ActivityIndicator size="small" color={Colors.roseDark} />
              : <Text style={styles.markAllText}>Mark all read</Text>
            }
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarRight} />
        )}
      </View>

      {/* ── Filter tabs ── */}
      <View style={styles.tabRow}>
        {(['All', 'Sessions', 'Activity'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setFilter(f)
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {fetchError && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color={Colors.error} />
          <Text style={styles.errorBannerText}>{fetchError}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.roseDark} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.roseDark}
              colors={[Colors.roseDark]}
            />
          }
        >
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="notifications-off-outline" size={32} color={Colors.muted} />
              </View>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptySub}>
                {filter === 'All'
                  ? "We'll notify you about sessions, messages, and updates."
                  : `No ${filter.toLowerCase()} notifications.`}
              </Text>
            </View>
          ) : (
            <>
              {/* Today */}
              {todayItems.length > 0 && (
                <>
                  <Text style={styles.groupLabel}>Today</Text>
                  {todayItems.map(n => (
                    <NotifItem key={n.id} notif={n} onPress={() => handleTap(n)} />
                  ))}
                </>
              )}

              {/* Earlier */}
              {earlierItems.length > 0 && (
                <>
                  <Text style={[styles.groupLabel, todayItems.length > 0 && { marginTop: 20 }]}>
                    Earlier
                  </Text>
                  {earlierItems.map(n => (
                    <NotifItem key={n.id} notif={n} onPress={() => handleTap(n)} />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  )
}

// ── Notification item ─────────────────────────────────────────────────────────

function NotifItem({ notif: n, onPress }: { notif: Notification; onPress: () => void }) {
  const c = cfg(n.type)
  const isNavigable = (
    ['session_accepted', 'new_message', 'session_applied', 'review_reminder'].includes(n.type) &&
    (n.session_id || n.type === 'session_applied')
  ) || (
    ['new_availability', 'stylist_invite'].includes(n.type) && !!n.data?.provider_id
  ) || n.type === 'verification'

  return (
    <TouchableOpacity
      style={[styles.notifCard, !n.read_at && styles.notifCardUnread]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {!n.read_at && <View style={styles.unreadAccent} />}
      <View style={[styles.iconCircle, { backgroundColor: c.bg }]}>
        <Ionicons name={c.icon as any} size={22} color={c.color} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifTopRow}>
          <Text style={[styles.notifTitle, !n.read_at && styles.notifTitleUnread]} numberOfLines={1}>
            {n.title}
          </Text>
          <Text style={styles.notifTime}>{formatTime(n.created_at)}</Text>
        </View>
        <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text>
      </View>
      {isNavigable && (
        <Ionicons name="chevron-forward" size={16} color={Colors.muted} style={styles.chevron} />
      )}
    </TouchableOpacity>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topBarTitle: {
    fontFamily: 'DancingScript_700Bold',
    flex: 1,
    textAlign: 'center',
    fontSize: 25,
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  topBarRight: { width: 80 },

  markAllBtn: {
    width: 80,
    alignItems: 'flex-end',
    paddingRight: 2,
  },
  markAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roseDark,
  },

  // Filter tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  tabActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
  },
  tabTextActive: {
    color: Colors.white,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Group label
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },

  // Notification card
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  notifCardUnread: {
    backgroundColor: Colors.rose + '0D',
    borderColor: Colors.softPink,
  },
  unreadAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.roseDark,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 12,
  },
  notifContent: { flex: 1, gap: 3 },
  notifTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  notifTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
    letterSpacing: -0.1,
  },
  notifTitleUnread: {
    fontWeight: '800',
  },
  notifTime: {
    fontSize: 11,
    color: Colors.muted,
    flexShrink: 0,
  },
  notifBody: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },
  chevron: {
    marginLeft: 6,
    flexShrink: 0,
  },

  // Fetch error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    margin: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    fontWeight: '500',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 25,
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
})
