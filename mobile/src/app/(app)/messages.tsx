import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { getBlockedIds } from '@/lib/blocks'
import { useProfileNav } from '@/lib/profileNav'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'

// ── Types ─────────────────────────────────────────────────────────────────────

type ConvItem = {
  sessionId: string
  sessionDate: string
  treatmentName: string | null
  treatmentCategory: string | null
  status: string
  otherPartyName: string
  otherPartyPic: string | null
  // Id for opening the other party's profile from their avatar. Which route it
  // belongs to depends on `isModel`: when I'm the model the other party is a
  // stylist (providers.id), otherwise they're a model (auth user_id).
  otherPartyId: string | null
  lastContent: string | null
  lastTime: string | null
  lastSenderId: string | null
  unreadCount: number
  isModel: boolean
}

type ConvSection = {
  title: string | null
  collapsible: boolean
  data: ConvItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Nails:       CategoryColors.nails,
  Lashes:      CategoryColors.lashes,
  Brows:       CategoryColors.brows,
  Hair:        CategoryColors.hair,
  Makeup:      CategoryColors.makeup,
  'Spray Tan': CategoryColors.sprayTan,
}

function formatConvTime(iso: string): string {
  const d    = new Date(iso)
  const now  = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0)  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (days === 1)  return 'Yesterday'
  if (days < 7)   return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatSessionDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  })
}

function previewText(item: ConvItem, userId: string): string {
  if (item.status === 'pending')  return 'Awaiting acceptance…'
  if (item.status === 'declined') return 'Application not accepted'
  if (!item.lastContent)          return 'No messages yet — say hello!'
  const prefix = item.lastSenderId === userId ? 'You: ' : ''
  const text   = item.lastContent.length > 46
    ? item.lastContent.slice(0, 46) + '…'
    : item.lastContent
  return prefix + text
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id

  const [convs,      setConvs]      = useState<ConvItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showPast,   setShowPast]   = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoadError(false)
    try {
      // 1. Get user's provider ID if applicable
      const { data: provRow } = await supabase
        .from('providers')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      const myProviderId = (provRow as any)?.id as string | undefined

      // 2. Query sessions for this user (as model or provider)
      const orClause = myProviderId
        ? `model_user_id.eq.${userId},provider_id.eq.${myProviderId}`
        : `model_user_id.eq.${userId}`

      const { data: sessionsRaw } = await supabase
        .from('sessions')
        .select('id, provider_id, model_user_id, date, treatment_id, status, created_at')
        .or(orClause)
        // Hide only dead conversations: cancelled and declined bookings drop off the list.
        // Keeps pending ("Awaiting acceptance…"), accepted, and completed — completed shows
        // read-only under "Past treatments" so history stays reachable.
        .not('status', 'in', '(cancelled,declined)')
        .order('created_at', { ascending: false })

      const sessions = (sessionsRaw ?? []) as {
        id: string
        provider_id: string
        model_user_id: string
        date: string
        treatment_id: string | null
        status: string
        created_at: string
      }[]

      if (sessions.length === 0) { setConvs([]); return }

      const sessionIds     = sessions.map(s => s.id)
      const providerIds    = [...new Set(sessions.map(s => s.provider_id))]
      const modelUserIds   = [...new Set(sessions.map(s => s.model_user_id))]
      const treatmentIds   = [...new Set(sessions.map(s => s.treatment_id).filter(Boolean) as string[])]

      // 3. Parallel: provider info, model info, treatments, messages
      const [
        { data: provInfos },
        { data: modelInfos },
        { data: treatInfos },
        { data: msgsRaw, error: msgsErr },
        blocked,
      ] = await Promise.all([
        supabase
          .from('providers')
          .select('id, user_id, name, profile_pic_url')
          .in('id', providerIds),
        supabase
          .from('public_profiles')
          .select('id, first_name, last_initial, profile_pic_url')
          .in('id', modelUserIds),
        treatmentIds.length > 0
          ? supabase
              .from('provider_treatments')
              .select('id, name, category')
              .in('id', treatmentIds)
          : Promise.resolve({ data: [] }),
        supabase
          .from('messages')
          .select('id, session_id, sender_id, body, created_at, read_at')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: false })
          .limit(300),
        getBlockedIds(userId).catch(() => new Set<string>()),
      ])

      // Surface real query errors (e.g. schema mismatch) instead of silently rendering
      // "no messages yet" — a swallowed 42703 here is exactly what hid this bug before.
      if (msgsErr) console.error('conversations preview: messages query failed:', msgsErr)

      // 4. Index data
      const provMap    = Object.fromEntries((provInfos  ?? []).map((p: any) => [p.id, p]))
      const modelMap   = Object.fromEntries((modelInfos ?? []).map((u: any) => [u.id, u]))
      const treatMap   = Object.fromEntries((treatInfos ?? []).map((t: any) => [t.id, t]))
      const msgs       = (msgsRaw ?? []) as {
        id: string
        session_id: string
        sender_id: string
        body: string
        created_at: string
        read_at: string | null
      }[]

      // Group messages per session
      const lastMsgBySession: Record<string, typeof msgs[0]> = {}
      const unreadBySession:  Record<string, number>          = {}

      // Only openable chats run the mark-as-read step, so only they may show an unread
      // badge — otherwise it sticks forever. 'accepted' AND 'completed' are both openable
      // (completed is read-only but still runs mark-as-read on open); locked sessions
      // (cancelled/pending/declined) never clear, so they're excluded. Mirrors HeaderIcons.
      const openableSessionIds = new Set(
        sessions
          .filter(s => s.status === 'accepted' || s.status === 'completed')
          .map(s => s.id)
      )

      for (const m of msgs) {
        if (!lastMsgBySession[m.session_id]) {
          lastMsgBySession[m.session_id] = m
        }
        if (!m.read_at && m.sender_id !== userId && openableSessionIds.has(m.session_id)) {
          unreadBySession[m.session_id] = (unreadBySession[m.session_id] ?? 0) + 1
        }
      }

      // 5. Build ConvItem list — mutual block: drop conversations whose other party
      //    is blocked either direction. Other party = the provider's owning user
      //    (when I'm the model) or the model_user_id (when I'm the provider).
      const items: ConvItem[] = sessions
        .filter(s => {
          const otherUserId = s.model_user_id === userId
            ? (provMap[s.provider_id] as any)?.user_id
            : s.model_user_id
          return !(otherUserId && blocked.has(otherUserId))
        })
        .map(s => {
        const isModel    = s.model_user_id === userId
        const prov       = provMap[s.provider_id]
        const model      = modelMap[s.model_user_id]
        const treat      = s.treatment_id ? treatMap[s.treatment_id] : null
        const lastMsg    = lastMsgBySession[s.id]

        const otherPartyName = isModel
          ? (prov?.name ?? 'Provider')
          : model ? `${model.first_name} ${model.last_initial}.` : 'Model'
        const otherPartyPic = isModel
          ? (prov?.profile_pic_url ?? null)
          : (model?.profile_pic_url ?? null)
        // providers.id for a stylist (what /provider/[id] wants), the auth user
        // id for a model — NOT interchangeable.
        const otherPartyId = isModel
          ? (s.provider_id ?? null)
          : (s.model_user_id ?? null)

        return {
          sessionId:        s.id,
          sessionDate:      s.date,
          treatmentName:    treat?.name ?? null,
          treatmentCategory:treat?.category ?? null,
          status:           s.status,
          otherPartyName,
          otherPartyPic,
          otherPartyId,
          lastContent:      lastMsg?.body ?? null,
          lastTime:         lastMsg?.created_at ?? s.created_at,
          lastSenderId:     lastMsg?.sender_id ?? null,
          unreadCount:      unreadBySession[s.id] ?? 0,
          isModel,
        }
      })

      // Sort by most recent activity
      items.sort((a, b) =>
        new Date(b.lastTime ?? 0).getTime() - new Date(a.lastTime ?? 0).getTime()
      )

      setConvs(items)
    } catch (e) {
      console.error('messages load failed:', e)
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  // Reload on every focus (not just mount) so unread badges clear when returning
  // from a chat — matches HeaderIcons / provider-dashboard focus-refresh pattern.
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Live updates: bump the list when any message in my sessions changes (RLS-scoped),
  // so rows + unread badges update in realtime, not just on focus.
  useEffect(() => {
    if (!userId) return
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => { load() }, 300) }
    const channel = supabase
      .channel(`messages-list-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, bump)
      .subscribe()
    return () => { if (t) clearTimeout(t); supabase.removeChannel(channel) }
  }, [userId, load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
  }, [load])

  const { openModel, openProvider } = useProfileNav()

  const openChat = async (sessionId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId } })
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const togglePast = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setShowPast(v => !v)
  }, [])

  // Active (pending/accepted) on top; completed grouped into a collapsible "Past
  // treatments" section so history stays reachable read-only without cluttering the top.
  const sections = useMemo<ConvSection[]>(() => {
    const active = convs.filter(c => c.status !== 'completed')
    const past   = convs.filter(c => c.status === 'completed')
    const out: ConvSection[] = [{ title: null, collapsible: false, data: active }]
    if (past.length > 0) {
      out.push({ title: 'Past chats', collapsible: true, data: showPast ? past : [] })
    }
    return out
  }, [convs, showPast])

  return (
    <View style={styles.container}>
      <ScreenDecor />
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerRight} />
      </View>

      {/* ── List ── */}
      <SectionList
        sections={sections}
        keyExtractor={c => c.sessionId}
        renderItem={({ item }) => (
          <ConvRow
            item={item}
            userId={userId ?? ''}
            onPress={() => openChat(item.sessionId)}
            onPressAvatar={() =>
              // isModel = I'm the model, so the other party is a stylist.
              item.isModel ? openProvider(item.otherPartyId) : openModel(item.otherPartyId)}
          />
        )}
        renderSectionHeader={({ section }) =>
          (section as ConvSection).collapsible ? (
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={togglePast}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionHeaderText}>Past chats</Text>
              <Ionicons
                name={showPast ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={Colors.muted}
              />
            </TouchableOpacity>
          ) : null
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={convs.length === 0 ? styles.emptyContainer : styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.rose}
            colors={[Colors.rose]}
          />
        }
        ListEmptyComponent={
          loading || convs.length > 0 ? null : loadError ? (
            <LoadErrorState onRetry={() => load()} fill={false} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>
                Once a provider accepts your application, your chat will appear here.
              </Text>
            </View>
          )
        }
      />
    </View>
  )
}

// ── Conversation row ──────────────────────────────────────────────────────────

function ConvRow({
  item,
  userId,
  onPress,
  onPressAvatar,
}: {
  item: ConvItem
  userId: string
  onPress: () => void
  onPressAvatar: () => void
}) {
  const isCompleted = item.status === 'completed'
  // 'locked' = pending/declined/cancelled (chat not open). Completed is NOT locked — it's
  // read-only history, shown with a softer "Completed" affordance instead of the lock.
  const isLocked  = item.status !== 'accepted' && !isCompleted
  const catColor  = item.treatmentCategory ? (CATEGORY_COLOR[item.treatmentCategory] ?? Colors.muted) : Colors.muted
  const preview   = previewText(item, userId)
  const hasUnread = item.unreadCount > 0

  const initials = item.otherPartyName
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
      {/* Avatar opens the other party's profile; the rest of the row opens the
         chat. The inner touchable becomes the responder, so it doesn't bubble. */}
      <TouchableOpacity style={styles.avatarWrap} onPress={onPressAvatar} activeOpacity={0.8}>
        {item.otherPartyPic ? (
          <Image source={{ uri: item.otherPartyPic }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        {isLocked && (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={9} color={Colors.white} />
          </View>
        )}
        {isCompleted && (
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={10} color={Colors.white} />
          </View>
        )}
      </TouchableOpacity>

      {/* Content */}
      <View style={styles.rowContent}>
        <View style={styles.rowTopLine}>
          <Text style={[styles.rowName, hasUnread && styles.rowNameBold]} numberOfLines={1}>
            {item.otherPartyName}
          </Text>
          {item.lastTime && (
            <Text style={[styles.rowTime, hasUnread && styles.rowTimeBold]}>
              {formatConvTime(item.lastTime)}
            </Text>
          )}
        </View>
        <View style={styles.rowBottomLine}>
          <Text
            style={[styles.rowPreview, isLocked && styles.rowPreviewMuted, hasUnread && styles.rowPreviewBold]}
            numberOfLines={1}
          >
            {isLocked && '🔒 '}{preview}
          </Text>
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {item.unreadCount > 9 ? '9+' : String(item.unreadCount)}
              </Text>
            </View>
          )}
        </View>
        {/* Session meta pill */}
        <View style={styles.rowMeta}>
          <Ionicons name="calendar-outline" size={11} color={Colors.muted} />
          <Text style={styles.rowMetaText}>{formatSessionDate(item.sessionDate)}</Text>
          {item.treatmentName && (
            <>
              <Text style={styles.rowMetaDot}>·</Text>
              <View style={[styles.rowMetaStripe, { backgroundColor: catColor }]} />
              <Text style={[styles.rowMetaTreat, { color: catColor }]}>{item.treatmentName}</Text>
            </>
          )}
          {isCompleted && (
            <>
              <Text style={styles.rowMetaDot}>·</Text>
              <Text style={styles.completedTag}>Completed</Text>
            </>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
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
  headerTitle: {
    fontFamily: Fonts.display,
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    color: Colors.rose,
    letterSpacing: -0.3,
  },
  headerRight: { width: 36 },

  list:           { paddingTop: 4, paddingBottom: 24 },
  emptyContainer: { flex: 1 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 2,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: 26,
    color: Colors.rose,
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 12,
    marginTop: 8,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    ...Shadow.soft,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 18,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },
  lockBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },
  doneBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.white,
  },

  rowContent: { flex: 1, gap: 3 },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  rowNameBold: { fontFamily: Fonts.bodyBold },
  rowTime: {
    fontSize: 12,
    color: Colors.muted,
    flexShrink: 0,
  },
  rowTimeBold: { color: Colors.rose, fontFamily: Fonts.bodyBold },
  rowBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowPreview: {
    flex: 1,
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },
  rowPreviewMuted: { fontStyle: 'italic' },
  rowPreviewBold:  { color: Colors.warmDark, fontFamily: Fonts.bodyBold },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  unreadText: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  rowMetaText: {
    fontSize: 11,
    color: Colors.muted,
  },
  completedTag: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },
  rowMetaDot: {
    fontSize: 11,
    color: Colors.muted,
  },
  rowMetaStripe: {
    width: 3,
    height: 10,
    borderRadius: 1.5,
  },
  rowMetaTreat: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
  },
})
