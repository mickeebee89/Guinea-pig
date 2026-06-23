import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, CategoryColors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ScreenDecor from '@/components/ScreenDecor'

// ── Types ─────────────────────────────────────────────────────────────────────

type ConvItem = {
  sessionId: string
  sessionDate: string
  treatmentName: string | null
  treatmentCategory: string | null
  status: string
  otherPartyName: string
  otherPartyPic: string | null
  lastContent: string | null
  lastTime: string | null
  lastSenderId: string | null
  unreadCount: number
  isModel: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Nails:       CategoryColors.nails,
  Lashes:      '#1D9E75',
  Brows:       '#BA7517',
  Hair:        '#7B5EA7',
  Makeup:      '#E8845E',
  'Spray Tan': '#C99A4E',
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
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
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
        .not('status', 'eq', 'completed')
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
        { data: msgsRaw },
      ] = await Promise.all([
        supabase
          .from('providers')
          .select('id, name, profile_pic_url')
          .in('id', providerIds),
        supabase
          .from('users')
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
          .select('id, session_id, sender_id, content, created_at, type, read_at')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: false })
          .limit(300),
      ])

      // 4. Index data
      const provMap    = Object.fromEntries((provInfos  ?? []).map((p: any) => [p.id, p]))
      const modelMap   = Object.fromEntries((modelInfos ?? []).map((u: any) => [u.id, u]))
      const treatMap   = Object.fromEntries((treatInfos ?? []).map((t: any) => [t.id, t]))
      const msgs       = (msgsRaw ?? []) as {
        id: string
        session_id: string
        sender_id: string
        content: string
        created_at: string
        type: string
        read_at: string | null
      }[]

      // Group messages per session
      const lastMsgBySession: Record<string, typeof msgs[0]> = {}
      const unreadBySession:  Record<string, number>          = {}

      for (const m of msgs) {
        if (!lastMsgBySession[m.session_id]) {
          lastMsgBySession[m.session_id] = m
        }
        if (!m.read_at && m.sender_id !== userId) {
          unreadBySession[m.session_id] = (unreadBySession[m.session_id] ?? 0) + 1
        }
      }

      // 5. Build ConvItem list
      const items: ConvItem[] = sessions.map(s => {
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

        return {
          sessionId:        s.id,
          sessionDate:      s.date,
          treatmentName:    treat?.name ?? null,
          treatmentCategory:treat?.category ?? null,
          status:           s.status,
          otherPartyName,
          otherPartyPic,
          lastContent:      lastMsg?.content ?? null,
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
    } catch {
      // leave empty
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
  }, [load])

  const openChat = async (sessionId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId } })
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

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
      <FlatList
        data={convs}
        keyExtractor={c => c.sessionId}
        renderItem={({ item }) => (
          <ConvRow
            item={item}
            userId={userId ?? ''}
            onPress={() => openChat(item.sessionId)}
          />
        )}
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
          loading ? null : (
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
}: {
  item: ConvItem
  userId: string
  onPress: () => void
}) {
  const isLocked  = item.status !== 'accepted'
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
      {/* Avatar */}
      <View style={styles.avatarWrap}>
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
      </View>

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
    fontFamily: 'DancingScript_700Bold',
    flex: 1,
    textAlign: 'center',
    fontSize: 25,
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  headerRight: { width: 36 },

  list:           { paddingTop: 4 },
  emptyContainer: { flex: 1 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 80,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 30,
    color: Colors.warmDark,
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
    backgroundColor: Colors.cream,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
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
    fontWeight: '700',
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
    borderColor: Colors.cream,
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
    fontWeight: '600',
    color: Colors.warmDark,
  },
  rowNameBold: { fontWeight: '800' },
  rowTime: {
    fontSize: 12,
    color: Colors.muted,
    flexShrink: 0,
  },
  rowTimeBold: { color: Colors.roseDark, fontWeight: '700' },
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
  rowPreviewBold:  { color: Colors.warmDark, fontWeight: '600' },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
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
    fontWeight: '600',
  },
})
