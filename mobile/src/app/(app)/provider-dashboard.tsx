import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  nails:      '#C8788A',
  lashes:     '#1D9E75',
  brows:      '#BA7517',
  hair:       '#7B5EA7',
  makeup:     '#E8845E',
  'spray tan':'#C99A4E',
}

function categoryColor(cat: string | null | undefined) {
  return CATEGORY_COLORS[(cat ?? '').toLowerCase()] ?? Colors.roseDark
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = {
  id: string
  name: string
  profile_pic_url: string | null
  is_verified: boolean | null
  rating: number | null
  review_count: number | null
  is_published: boolean | null
}

type SessionCard = {
  id: string
  model_user_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
  note: string | null
  created_at: string
  status: 'pending' | 'accepted'
  modelName: string
  modelPicUrl: string | null
  treatmentName: string | null
  treatmentCategory: string | null
}

type Stats = {
  totalSessions: number
  portfolioCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatSessionDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function formatTime(t: string) {
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={statStyles.card}>
      <Ionicons name={icon as any} size={20} color={Colors.roseDark} />
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  )
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
})

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProviderDashboardScreen() {
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id

  const [provider,          setProvider]          = useState<Provider | null>(null)
  const [pendingSessions,   setPendingSessions]   = useState<SessionCard[]>([])
  const [upcomingSessions,  setUpcomingSessions]  = useState<SessionCard[]>([])
  const [stats,             setStats]             = useState<Stats>({ totalSessions: 0, portfolioCount: 0 })
  const [loading,           setLoading]           = useState(true)
  const [refreshing,        setRefreshing]        = useState(false)
  const [publishLoading,    setPublishLoading]    = useState(false)
  const [processingIds,     setProcessingIds]     = useState<Set<string>>(new Set())

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) return
    if (!isRefresh) setLoading(true)

    try {
      // Phase 1: get provider record
      const { data: provData, error: provErr } = await supabase
        .from('providers')
        .select('id, name, profile_pic_url, is_verified, rating, review_count, is_published')
        .eq('user_id', userId)
        .single()

      if (provErr || !provData) {
        setLoading(false)
        setRefreshing(false)
        return
      }
      setProvider(provData as Provider)
      const providerId = (provData as any).id

      // Phase 2: parallel fetches
      const today = todayKey()
      const [
        { data: pendingData },
        { data: upcomingData },
        { count: totalCount },
        { count: portfolioCount },
      ] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, model_user_id, date, start_time, end_time, treatment_id, note, created_at')
          .eq('provider_id', providerId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase
          .from('sessions')
          .select('id, model_user_id, date, start_time, end_time, treatment_id, created_at')
          .eq('provider_id', providerId)
          .eq('status', 'accepted')
          .gte('date', today)
          .order('date', { ascending: true })
          .limit(10),
        supabase
          .from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerId)
          .in('status', ['accepted', 'completed']),
        supabase
          .from('provider_portfolio')
          .select('id', { count: 'exact', head: true })
          .eq('provider_id', providerId),
      ])

      setStats({
        totalSessions: totalCount ?? 0,
        portfolioCount: portfolioCount ?? 0,
      })

      // Phase 3: enrich sessions with model + treatment info
      const allSessions = [...(pendingData ?? []), ...(upcomingData ?? [])]
      if (allSessions.length === 0) {
        setPendingSessions([])
        setUpcomingSessions([])
        setLoading(false)
        setRefreshing(false)
        return
      }

      const modelIds = [...new Set(allSessions.map((s: any) => s.model_user_id))]
      const treatIds = [
        ...new Set(
          allSessions.map((s: any) => s.treatment_id).filter((id: any): id is string => !!id)
        ),
      ]

      const [{ data: modelsData }, { data: treatsData }] = await Promise.all([
        supabase
          .from('users')
          .select('id, first_name, last_initial, profile_pic_url')
          .in('id', modelIds),
        treatIds.length > 0
          ? supabase
              .from('provider_treatments')
              .select('id, name, category')
              .in('id', treatIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ])

      const modelMap: Record<string, any>  = {}
      const treatMap: Record<string, any>  = {}
      ;(modelsData ?? []).forEach((m: any) => { modelMap[m.id] = m })
      ;(treatsData ?? []).forEach((t: any) => { treatMap[t.id] = t })

      function enrich(s: any): SessionCard {
        const m = modelMap[s.model_user_id]
        const t = s.treatment_id ? treatMap[s.treatment_id] : null
        return {
          id: s.id,
          model_user_id: s.model_user_id,
          date: s.date,
          start_time: s.start_time,
          end_time: s.end_time,
          treatment_id: s.treatment_id ?? null,
          note: s.note ?? null,
          created_at: s.created_at,
          status: s.status,
          modelName: m ? `${m.first_name} ${m.last_initial ? m.last_initial + '.' : ''}`.trim() : 'Model',
          modelPicUrl: m?.profile_pic_url ?? null,
          treatmentName: t?.name ?? null,
          treatmentCategory: t?.category ?? null,
        }
      }

      setPendingSessions((pendingData ?? []).map(enrich))
      setUpcomingSessions((upcomingData ?? []).map(enrich))
    } catch {}

    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const onRefresh = () => {
    setRefreshing(true)
    load(true)
  }

  // ── Accept / Decline ───────────────────────────────────────────────────────

  const setProcessing = (id: string, on: boolean) => {
    setProcessingIds(prev => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  const acceptSession = async (s: SessionCard) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setProcessing(s.id, true)
    try {
      await supabase.from('sessions').update({ status: 'accepted' }).eq('id', s.id)
      try {
        await supabase.from('notifications').insert({
          user_id: s.model_user_id,
          type: 'session_accepted',
          title: 'Session accepted! 🎉',
          body: `Your booking for ${formatSessionDate(s.date)} has been confirmed.`,
          data: { session_id: s.id },
          read: false,
        })
      } catch {}
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPendingSessions(prev => prev.filter(x => x.id !== s.id))
      if (s.date >= todayKey()) {
        setUpcomingSessions(prev =>
          [...prev, { ...s, status: 'accepted' }].sort((a, b) => a.date.localeCompare(b.date))
        )
      }
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', 'Could not accept session. Please try again.')
    }
    setProcessing(s.id, false)
  }

  const declineSession = async (s: SessionCard) => {
    Alert.alert(
      'Decline session?',
      `This will decline ${s.modelName}'s application for ${formatSessionDate(s.date)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setProcessing(s.id, true)
            try {
              await supabase.from('sessions').update({ status: 'declined' }).eq('id', s.id)
              try {
                await supabase.from('notifications').insert({
                  user_id: s.model_user_id,
                  type: 'session_declined',
                  title: 'Session update',
                  body: `Your booking for ${formatSessionDate(s.date)} was not confirmed.`,
                  data: { session_id: s.id },
                  read: false,
                })
              } catch {}
              setPendingSessions(prev => prev.filter(x => x.id !== s.id))
            } catch {
              Alert.alert('Error', 'Could not decline session. Please try again.')
            }
            setProcessing(s.id, false)
          },
        },
      ]
    )
  }

  // ── Published toggle ───────────────────────────────────────────────────────

  const togglePublished = async (value: boolean) => {
    if (!provider) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPublishLoading(true)
    try {
      await supabase
        .from('providers')
        .update({ is_published: value })
        .eq('id', provider.id)
      setProvider(p => p ? { ...p, is_published: value } : p)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    setPublishLoading(false)
  }

  // ── Quick links ────────────────────────────────────────────────────────────

  const goAvailability = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(app)/availability' as any)
  }

  const goShop = async () => {
    if (!provider) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({
      pathname: '/(app)/provider/[id]' as any,
      params: { id: provider.id },
    })
  }

  const goChat = async (sessionId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({
      pathname: '/(app)/chat/[sessionId]' as any,
      params: { sessionId },
    })
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (!provider) {
    return (
      <View style={[styles.container, styles.centred]}>
        <Ionicons name="alert-circle-outline" size={40} color={Colors.muted} />
        <Text style={styles.emptyLabel}>Provider profile not found</Text>
      </View>
    )
  }

  const isPublished = !!provider.is_published
  const providerInitials = provider.name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Header bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBarLeft}>
          <Text style={styles.greeting}>Dashboard</Text>
          <Text style={styles.subGreeting}>Welcome back, {provider.name.split(' ')[0]}</Text>
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push('/(app)/settings' as any)
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="settings-outline" size={19} color={Colors.warmDark} />
          </TouchableOpacity>
          <View>
            {provider.profile_pic_url ? (
              <Image source={{ uri: provider.profile_pic_url }} style={styles.headerAvatar} />
            ) : (
              <View style={styles.headerAvatarPlaceholder}>
                <Text style={styles.headerAvatarInitials}>{providerInitials}</Text>
              </View>
            )}
            {provider.is_verified && (
              <View style={styles.verifiedDot}>
                <Ionicons name="checkmark" size={9} color={Colors.white} />
              </View>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.roseDark}
            colors={[Colors.roseDark]}
          />
        }
      >
        {/* ── Shop status card ── */}
        <View style={styles.shopCard}>
          <View style={styles.shopCardLeft}>
            <View style={[styles.shopStatusDot, { backgroundColor: isPublished ? '#1D9E75' : Colors.muted }]} />
            <View>
              <Text style={styles.shopCardTitle}>Shop status</Text>
              <Text style={[styles.shopCardStatus, { color: isPublished ? '#1D9E75' : Colors.muted }]}>
                {isPublished ? 'Live — models can find you' : 'Offline — hidden from search'}
              </Text>
            </View>
          </View>
          {publishLoading ? (
            <ActivityIndicator size="small" color={Colors.roseDark} />
          ) : (
            <Switch
              value={isPublished}
              onValueChange={togglePublished}
              trackColor={{ false: Colors.border, true: Colors.rose }}
              thumbColor={isPublished ? Colors.roseDark : Colors.muted}
              ios_backgroundColor={Colors.border}
            />
          )}
        </View>

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          <StatCard
            label="Sessions"
            value={stats.totalSessions.toString()}
            icon="calendar-outline"
          />
          <StatCard
            label="Rating"
            value={provider.rating != null ? provider.rating.toFixed(1) : '—'}
            icon="star-outline"
          />
          <StatCard
            label="Portfolio"
            value={stats.portfolioCount.toString()}
            icon="images-outline"
          />
        </View>

        {/* ── Pending applications ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Applications</Text>
          {pendingSessions.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pendingSessions.length}</Text>
            </View>
          )}
        </View>

        {pendingSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={32} color={Colors.muted} />
            <Text style={styles.emptyCardText}>All applications reviewed</Text>
          </View>
        ) : (
          pendingSessions.map(s => (
            <PendingCard
              key={s.id}
              session={s}
              processing={processingIds.has(s.id)}
              onAccept={() => acceptSession(s)}
              onDecline={() => declineSession(s)}
            />
          ))
        )}

        {/* ── Upcoming sessions ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Upcoming sessions</Text>
        </View>

        {upcomingSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={Colors.muted} />
            <Text style={styles.emptyCardText}>No confirmed sessions yet</Text>
          </View>
        ) : (
          upcomingSessions.map(s => (
            <UpcomingCard
              key={s.id}
              session={s}
              onChat={() => goChat(s.id)}
            />
          ))
        )}

        {/* ── Quick links ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Quick links</Text>
        </View>

        <View style={styles.quickLinks}>
          <TouchableOpacity style={styles.quickLinkBtn} onPress={goAvailability} activeOpacity={0.85}>
            <View style={[styles.quickLinkIcon, { backgroundColor: Colors.softPink + '40' }]}>
              <Ionicons name="calendar" size={22} color={Colors.roseDark} />
            </View>
            <View style={styles.quickLinkText}>
              <Text style={styles.quickLinkTitle}>Manage Availability</Text>
              <Text style={styles.quickLinkSub}>Set your open dates & times</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickLinkBtn} onPress={goShop} activeOpacity={0.85}>
            <View style={[styles.quickLinkIcon, { backgroundColor: Colors.inputBg }]}>
              <Ionicons name="storefront-outline" size={22} color={Colors.warmDark} />
            </View>
            <View style={styles.quickLinkText}>
              <Text style={styles.quickLinkTitle}>View Shop</Text>
              <Text style={styles.quickLinkSub}>See how models see your profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ── Pending card ──────────────────────────────────────────────────────────────

function PendingCard({
  session: s,
  processing,
  onAccept,
  onDecline,
}: {
  session: SessionCard
  processing: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  const catColor = categoryColor(s.treatmentCategory)
  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionCardRow}>
        {/* Avatar */}
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.sessionAvatar} />
        ) : (
          <View style={styles.sessionAvatarPlaceholder}>
            <Ionicons name="person" size={18} color={Colors.muted} />
          </View>
        )}
        {/* Info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.sessionModelName}>{s.modelName}</Text>
            <Text style={styles.sessionAgo}>{timeAgo(s.created_at)}</Text>
          </View>
          <View style={styles.sessionMeta}>
            {s.treatmentName && (
              <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                <Text style={[styles.treatPillText, { color: catColor }]}>{s.treatmentName}</Text>
              </View>
            )}
            <Text style={styles.sessionDateTime}>
              {formatSessionDate(s.date)} · {formatTime(s.start_time)} – {formatTime(s.end_time)}
            </Text>
          </View>
          {s.note ? (
            <Text style={styles.sessionNote} numberOfLines={2}>"{s.note}"</Text>
          ) : null}
        </View>
      </View>
      {/* Buttons */}
      <View style={styles.sessionActions}>
        <TouchableOpacity
          style={styles.declineBtn}
          onPress={onDecline}
          disabled={processing}
          activeOpacity={0.85}
        >
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.acceptBtn, processing && { opacity: 0.6 }]}
          onPress={onAccept}
          disabled={processing}
          activeOpacity={0.9}
        >
          {processing ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={Colors.white} />
              <Text style={styles.acceptBtnText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Upcoming card ─────────────────────────────────────────────────────────────

function UpcomingCard({
  session: s,
  onChat,
}: {
  session: SessionCard
  onChat: () => void
}) {
  const catColor = categoryColor(s.treatmentCategory)
  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionCardRow}>
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.sessionAvatar} />
        ) : (
          <View style={styles.sessionAvatarPlaceholder}>
            <Ionicons name="person" size={18} color={Colors.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionModelName}>{s.modelName}</Text>
          <View style={styles.sessionMeta}>
            {s.treatmentName && (
              <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                <Text style={[styles.treatPillText, { color: catColor }]}>{s.treatmentName}</Text>
              </View>
            )}
            <Text style={styles.sessionDateTime}>
              {formatSessionDate(s.date)} · {formatTime(s.start_time)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.chatBtn}
          onPress={onChat}
          activeOpacity={0.8}
        >
          <Ionicons name="chatbubble-outline" size={16} color={Colors.roseDark} />
          <Text style={styles.chatBtnText}>Chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  centred:   { alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyLabel: { fontSize: 15, color: Colors.muted, fontWeight: '600' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  topBarLeft: { gap: 2 },
  greeting:  { fontSize: 22, fontWeight: '800', color: Colors.warmDark, letterSpacing: -0.5 },
  subGreeting: { fontSize: 13, color: Colors.muted },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.white,
  },
  headerAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  headerAvatarInitials: { fontSize: 16, fontWeight: '700', color: Colors.roseDark },
  verifiedDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Shop card
  shopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  shopCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shopStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  shopCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.warmDark },
  shopCardStatus: { fontSize: 12, fontWeight: '500', marginTop: 2 },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  badge: {
    backgroundColor: Colors.roseDark,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontWeight: '700', color: Colors.white },

  // Empty card
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyCardText: { fontSize: 14, color: Colors.muted, fontWeight: '500' },

  // Session cards (shared)
  sessionCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  sessionCardRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 2,
  },
  sessionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.border,
    flexShrink: 0,
  },
  sessionAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  sessionModelName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  sessionAgo: {
    fontSize: 11,
    color: Colors.muted,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
  },
  treatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  treatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  treatPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sessionDateTime: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
  },
  sessionNote: {
    fontSize: 12,
    color: Colors.muted,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 18,
  },

  // Pending actions
  sessionActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  declineBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  acceptBtn: {
    flex: 2,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.roseDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  acceptBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },

  // Chat button (upcoming card)
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.softPink + '40',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'center',
    flexShrink: 0,
  },
  chatBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.roseDark,
  },

  // Quick links
  quickLinks: { gap: 10 },
  quickLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  quickLinkIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickLinkText: { flex: 1 },
  quickLinkTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  quickLinkSub: {
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
})
