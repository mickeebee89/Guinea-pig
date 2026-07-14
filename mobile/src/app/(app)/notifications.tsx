import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { routeForNotification } from '@/lib/notificationRouting'
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
  session_accepted: { icon: 'checkmark-circle',  color: Colors.rose,     bg: Colors.softPink,        filter: 'Sessions' },
  session_declined: { icon: 'close-circle',       color: Colors.error,   bg: '#FEF2F2',              filter: 'Sessions' },
  session_completed:{ icon: 'checkmark-done-circle',color: Colors.roseDark,bg: Colors.softPink,       filter: 'Sessions' },
  session_cancelled:{ icon: 'close-circle',       color: Colors.muted,   bg: Colors.inputBg,         filter: 'Sessions' },
  session_applied:  { icon: 'person-add',         color: Colors.roseDark,bg: Colors.softPink + '40', filter: 'Sessions' },
  new_message:      { icon: 'chatbubble',         color: Colors.rose,    bg: Colors.softPink + '30', filter: 'Activity' },
  review_reminder:  { icon: 'star',               color: '#F59E0B',      bg: '#FFFBEB',              filter: 'Activity' },
  verification:     { icon: 'shield-checkmark',   color: Colors.rose,    bg: Colors.softPink,        filter: 'Activity' },
  new_availability: { icon: 'calendar',           color: Colors.roseDark,bg: Colors.softPink + '40', filter: 'Activity' },
  stylist_invite:   { icon: 'sparkles',           color: Colors.rose,    bg: Colors.softPink + '40', filter: 'Activity' },
  system:           { icon: 'information-circle', color: Colors.muted,   bg: Colors.inputBg,         filter: 'Activity' },
  admin_warning:    { icon: 'warning',            color: Colors.error,   bg: '#FEF2F2',              filter: 'Activity' },
  admin_message:    { icon: 'mail',               color: Colors.roseDark,bg: Colors.softPink + '30', filter: 'Activity' },
}

const DEFAULT_CFG: IconCfg = {
  icon: 'ellipse-outline', color: Colors.muted, bg: Colors.inputBg, filter: 'Activity',
}

// Display-only labels for the filter tabs. The internal Filter value 'Sessions'
// is unchanged (used for state comparison + ICON_CFG keys); only the rendered
// text maps to "Treatments".
const FILTER_LABELS: Record<Filter, string> = { All: 'All', Sessions: 'Treatments', Activity: 'Activity' }

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
  // The admin-warning notification whose explanation modal is open (null = closed).
  const [warningNotif,  setWarningNotif]  = useState<Notification | null>(null)

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
    // Admin warnings don't deep-link anywhere — open an explanation instead.
    if (n.type === 'admin_warning') { setWarningNotif(n); return }
    // Shared with push-notification taps (lib/notificationRouting).
    routeForNotification({ type: n.type, session_id: n.session_id, provider_id: n.data?.provider_id })
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
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{FILTER_LABELS[f]}</Text>
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
                  ? "We'll notify you about treatments, messages, and updates."
                  : `No ${filter === 'Sessions' ? 'treatment' : filter.toLowerCase()} notifications.`}
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

      {/* Admin-warning explanation ("what a warning means") */}
      <Modal
        visible={warningNotif !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setWarningNotif(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setWarningNotif(null)}
        >
          <TouchableOpacity style={styles.modalCard} activeOpacity={1}>
            <View style={[styles.iconCircle, { backgroundColor: '#FEF2F2', alignSelf: 'center' }]}>
              <Ionicons name="warning" size={24} color={Colors.error} />
            </View>
            <Text style={styles.modalTitle}>About this warning</Text>
            <Text style={styles.modalText}>
              This is a formal notice from the Guinea Pig team. It means your account was flagged
              for content or behaviour that breached our community guidelines.
            </Text>
            {!!warningNotif?.body && (
              <View style={styles.modalReasonBox}>
                <Text style={styles.modalReasonLabel}>Note from the team</Text>
                <Text style={styles.modalReasonText}>{warningNotif.body}</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              activeOpacity={0.85}
              onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWarningNotif(null) }}
            >
              <Text style={styles.modalCloseText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

// ── Review CTA (session_completed rows) ─────────────────────────────────────────
// Reuses the existing review launch (mirrors chat/[sessionId].tsx) and the existing
// session_id + reviewer_id duplicate-guard lookup — no review logic is duplicated.
function ReviewCTA({ sessionId }: { sessionId: string }) {
  const router      = useRouter()
  const { session } = useAuth()
  const userId      = session?.user?.id
  // loading → resolving; review → show CTA; done → already reviewed; hidden → not a participant
  const [state, setState]               = useState<'loading' | 'review' | 'done' | 'hidden'>('loading')
  const [revieweeType, setRevieweeType] = useState<'provider' | 'model'>('provider')

  useEffect(() => {
    if (!userId) { setState('hidden'); return }
    let cancelled = false
    ;(async () => {
      // Derive direction from the session (mirror chat launcher: isModel = model_user_id === uid)
      const { data: s } = await supabase
        .from('sessions')
        .select('model_user_id')
        .eq('id', sessionId)
        .maybeSingle()
      if (cancelled) return
      if (!s) { setState('hidden'); return }
      const isModel = (s as any).model_user_id === userId
      setRevieweeType(isModel ? 'provider' : 'model')

      // Duplicate guard: same lookup as chat/[sessionId].tsx:189 / leave-review.tsx:194
      const { data: existRev } = await supabase
        .from('reviews')
        .select('id')
        .eq('session_id', sessionId)
        .eq('reviewer_id', userId)
        .maybeSingle()
      if (cancelled) return
      setState(existRev ? 'done' : 'review')
    })()
    return () => { cancelled = true }
  }, [sessionId, userId])

  if (state === 'loading' || state === 'hidden') return null

  if (state === 'done') {
    return (
      <View style={styles.reviewedPill}>
        <Ionicons name="checkmark-circle" size={13} color={Colors.roseDark} />
        <Text style={styles.reviewedText}>Reviewed</Text>
      </View>
    )
  }

  return (
    <TouchableOpacity
      style={styles.reviewCta}
      activeOpacity={0.85}
      onPress={async () => {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        // Same launch as chat/[sessionId].tsx:319 — screen + revieweeType support both directions.
        router.push({ pathname: '/(app)/leave-review' as any, params: { sessionId, revieweeType } })
      }}
    >
      <Text style={styles.reviewCtaText}>⭐ Leave a review</Text>
    </TouchableOpacity>
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
  ) || n.type === 'verification' || n.type === 'admin_warning'

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
        {n.type === 'admin_warning' && (
          <Text style={styles.warningHint} numberOfLines={3}>
            A formal notice that your account was flagged for breaching our community guidelines. Tap for details.
          </Text>
        )}
        {n.type === 'session_completed' && n.session_id && (
          <ReviewCTA sessionId={n.session_id} />
        )}
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

  // Review CTA on session_completed rows (pink, prominent)
  reviewCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.rose,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    marginTop: 10,
    ...Shadow.card,
  },
  reviewCtaText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 13, letterSpacing: 0.2 },

  // Short explanatory line under an admin-warning row
  warningHint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.error,
    fontStyle: 'italic',
  },

  // Admin-warning explanation modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 22,
    gap: 12,
    ...Shadow.card,
  },
  modalTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.warmDark,
    textAlign: 'center',
  },
  modalText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: 'center',
  },
  modalReasonBox: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  modalReasonLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  modalReasonText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.warmDark,
  },
  modalCloseBtn: {
    marginTop: 4,
    backgroundColor: Colors.rose,
    borderRadius: Radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCloseText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 15 },
  reviewedPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
    backgroundColor: Colors.softPink,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewedText: { color: Colors.roseDark, fontFamily: Fonts.bodyBold, fontSize: 12 },

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
    fontFamily: Fonts.display,
    flex: 1,
    textAlign: 'center',
    fontSize: 23,
    color: Colors.rose,
    letterSpacing: -0.3,
  },
  topBarRight: { width: 80 },

  markAllBtn: {
    width: 80,
    alignItems: 'flex-end',
    paddingRight: 2,
  },
  markAllText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
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
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  tabActive: {
    backgroundColor: Colors.rose,
    borderColor: Colors.rose,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
  },
  tabTextActive: {
    color: Colors.white,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Group label
  groupLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
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
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.soft,
  },
  notifCardUnread: {
    backgroundColor: Colors.softPink,
    borderColor: Colors.rose + '55',
  },
  unreadAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: Colors.pinkVibrant,
    borderTopLeftRadius: Radius.lg,
    borderBottomLeftRadius: Radius.lg,
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
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.warmDark,
    letterSpacing: -0.1,
  },
  notifTitleUnread: {
    color: Colors.roseDark,
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
    borderRadius: Radius.md,
    padding: 12,
    margin: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.error,
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
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
})
