import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { mustWrite, tryWrite } from '@/lib/db'
import { getBlockedIds } from '@/lib/blocks'
import { signModelPhotos } from '@/lib/photoUrls'
import LoadErrorState from '@/components/LoadErrorState'
import ApplicationPhotos from '@/components/ApplicationPhotos'
import PhotoViewerModal from '@/components/PhotoViewerModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionDetail = {
  id: string
  provider_id: string
  model_user_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
  status: string
  photo_urls: string[] | null
}

type OtherParty = {
  name: string
  picUrl: string | null
  userId: string | null
}

type Treatment = {
  id: string
  category: string
}

type Message = {
  id: string
  session_id: string
  sender_id: string
  body: string
  type: 'text' | 'system'
  created_at: string
  read_at: string | null
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  const d         = new Date(iso)
  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString())     return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatSessionDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const router         = useRouter()
  const { session }    = useAuth()
  const insets         = useSafeAreaInsets()
  const userId         = session?.user?.id
  const listRef        = useRef<FlatList>(null)

  // ── State ──────────────────────────────────────────────────────────────────

  const [chat,       setChat]       = useState<SessionDetail | null>(null)
  const [treatment,  setTreatment]  = useState<Treatment | null>(null)
  const [otherParty, setOtherParty] = useState<OtherParty | null>(null)
  const [isBlocked,  setIsBlocked]  = useState(false)   // mutual block either direction
  // Signed urls of the model's application photos (stylist side only), and the one
  // currently open full-screen.
  const [applicationPhotos, setApplicationPhotos] = useState<string[]>([])
  const [enlargedPhoto,     setEnlargedPhoto]     = useState<string | null>(null)
  const [messages,   setMessages]   = useState<Message[]>([])
  const [inputText,  setInputText]  = useState('')
  const [sending,    setSending]    = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)
  const [menuOpen,        setMenuOpen]        = useState(false)
  const [alreadyReviewed, setAlreadyReviewed] = useState(false)
  const [markingComplete, setMarkingComplete] = useState(false)
  const [reportOpen,       setReportOpen]       = useState(false)
  const [reportReason,     setReportReason]     = useState('')
  const [reportSubmitting, setReportSubmitting]  = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!sessionId || !userId) return
    setLoadError(false)
    try {
      // Session
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('id, provider_id, model_user_id, date, start_time, end_time, treatment_id, status, photo_urls')
        .eq('id', sessionId)
        .single()
      if (!sessionData) return

      const s        = sessionData as SessionDetail
      const isModel  = s.model_user_id === userId
      setChat(s)

      // Photos the model attached when applying. Shown to the STYLIST here because
      // this is where they come to prepare for an accepted booking. Private bucket,
      // so the stored paths must be signed before they'll render.
      const paths = (s.photo_urls ?? []) as string[]
      if (!isModel && paths.length > 0) {
        try {
          const signed = await signModelPhotos(paths)
          setApplicationPhotos(paths.map(p => signed.get(p) ?? p))
        } catch (e) {
          console.warn('chat: signing application photos failed', e)
        }
      } else {
        setApplicationPhotos([])
      }

      // Treatment + other party in parallel
      const [{ data: treatData, error: treatErr }, otherData] = await Promise.all([
        s.treatment_id
          ? supabase
              .from('provider_treatments')
              // Category is all there is: edit-shop writes the category into `name`
              // too, and never writes duration or price. (This query previously
              // asked for a `materials_cost` column that doesn't exist, which
              // failed the WHOLE query — hence no treatment shown in chat at all.)
              .select('id, category')
              .eq('id', s.treatment_id)
              .maybeSingle()
          // Shape must match the query branch now that `error` is read.
          : Promise.resolve({ data: null, error: null }),
        isModel
          ? supabase
              .from('providers')
              .select('id, name, profile_pic_url, user_id')
              .eq('id', s.provider_id)
              .single()
          : supabase
              .from('public_profiles')
              .select('id, first_name, last_initial, profile_pic_url')
              .eq('id', s.model_user_id)
              .single(),
      ])

      if (treatErr) console.warn('chat treatment →', treatErr.message)
      if (treatData) setTreatment(treatData as Treatment)

      const od = (otherData as any).data
      if (od) {
        const otherUserId = isModel ? (od.user_id ?? null) : s.model_user_id
        setOtherParty(
          isModel
            ? { name: od.name ?? 'Provider', picUrl: od.profile_pic_url ?? null, userId: otherUserId }
            : { name: od.first_name ? `${od.first_name} ${od.last_initial ?? ''}.`.trim() : 'Model', picUrl: od.profile_pic_url ?? null, userId: otherUserId }
        )
        // Mutual block: if blocked either direction, the chat becomes read-only.
        if (otherUserId && userId) {
          const blocked = await getBlockedIds(userId).catch(() => new Set<string>())
          setIsBlocked(blocked.has(otherUserId))
        }
      }

      // Messages (accepted or completed)
      if (s.status === 'accepted' || s.status === 'completed') {
        const { data: msgData, error: msgFetchErr } = await supabase
          .from('messages')
          .select('id, session_id, sender_id, body, created_at, read_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })  // newest first → inverted FlatList

        setMessages((msgData ?? []) as Message[])

        // Mark incoming messages as read
        await supabase
          .from('messages')
          .update({ read_at: new Date().toISOString() })
          .eq('session_id', sessionId)
          .neq('sender_id', userId)
          .is('read_at', null)
          .then(() => {})

        if (s.status === 'completed') {
          const { data: existRev } = await supabase
            .from('reviews')
            .select('id')
            .eq('session_id', sessionId)
            .eq('reviewer_id', userId)
            .maybeSingle()
          setAlreadyReviewed(!!existRev)
        }
      }
    } catch (e) {
      console.error('chat load failed:', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [sessionId, userId])

  useEffect(() => { loadData() }, [loadData])

  // ── Realtime ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || !userId || chat?.status !== 'accepted') return

    const channel = supabase
      .channel(`chat-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        async (payload) => {
          const newMsg = payload.new as Message
          setMessages(prev => [newMsg, ...prev])
          if (newMsg.sender_id !== userId) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            supabase
              .from('messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', newMsg.id)
              .then(() => {})
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const updated = payload.new as Message
          setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [sessionId, userId, chat?.status])

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = inputText.trim()
    if (!text || !userId || !sessionId || sending) return
    setSending(true)
    setInputText('')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const { error } = await supabase.from('messages').insert({
      session_id: sessionId,
      sender_id:  userId,
      body:       text,
    })
    if (error) {
      setInputText(text)  // restore on failure
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }
    setSending(false)
  }

  // ── Block / Report ─────────────────────────────────────────────────────────

  const handleBlock = async () => {
    setMenuOpen(false)
    const name = otherParty?.name ?? 'this user'
    Alert.alert(
      `Block ${name}?`,
      "They won't be able to message you. You can unblock from settings.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
            if (otherParty?.userId && userId) {
              const { error } = await supabase.from('blocks')
                .insert({ blocker_id: userId, blocked_id: otherParty.userId })
              // 23505 = unique_violation → already blocked; treat as success.
              if (error && (error as any).code !== '23505') {
                Alert.alert('Couldn’t block', error.message ?? 'Please try again.')
                return
              }

              // Best-effort: cancel any live bookings between the pair and notify the
              // other party. If this fails, the block still stands (log, don't fail).
              try {
                const me = userId
                const them = otherParty.userId
                // Resolve provider ownership for both sides (blocker/blocked).
                const { data: provRows } = await supabase.from('providers')
                  .select('id, user_id').in('user_id', [me, them])
                const myProviderId    = (provRows ?? []).find((p: any) => p.user_id === me)?.id
                const theirProviderId = (provRows ?? []).find((p: any) => p.user_id === them)?.id

                // Sessions between the pair, either direction (I'm provider / I'm model).
                const orParts: string[] = []
                if (myProviderId)    orParts.push(`and(model_user_id.eq.${them},provider_id.eq.${myProviderId})`)
                if (theirProviderId) orParts.push(`and(model_user_id.eq.${me},provider_id.eq.${theirProviderId})`)

                if (orParts.length > 0) {
                  const { data: pairSessions } = await supabase.from('sessions')
                    .select('id')
                    .in('status', ['pending', 'accepted'])
                    .or(orParts.join(','))
                  const ids = (pairSessions ?? []).map((r: any) => r.id as string)
                  if (ids.length > 0) {
                    // If this is refused the bookings stay live between two people
                    // who can no longer message each other — the one outcome the
                    // block is meant to prevent.
                    await mustWrite(
                      supabase.from('sessions').update({ status: 'cancelled' }).in('id', ids),
                      'cancel sessions on block')
                    // Notify the OTHER party per cancelled session — never mention blocking.
                    await supabase.from('notifications').insert(
                      ids.map(sid => ({
                        user_id:    them,
                        type:       'session_cancelled',
                        title:      'Booking cancelled',
                        body:       'Your upcoming treatment has been cancelled.',
                        session_id: sid,
                      }))
                    )
                  }
                }
              } catch (e) {
                console.warn('block: cancel/notify bookings failed (non-blocking):', e)
              }
            }
            Alert.alert('Blocked', `${name} has been blocked.`)
          },
        },
      ]
    )
  }

  const handleReport = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setMenuOpen(false)
    setReportReason('')
    setReportOpen(true)
  }

  const submitReport = async () => {
    const reason = reportReason.trim()
    if (!reason || reportSubmitting) return
    if (!otherParty?.userId || !userId) { setReportOpen(false); return }
    setReportSubmitting(true)
    // `reason` is a required column — the old fire-and-forget insert omitted it and
    // silently failed the NOT NULL constraint, so nothing reached the admin. Surface
    // errors now instead of swallowing them. (status defaults to 'open'.)
    const { error } = await supabase.from('reports').insert({
      reporter_id: userId,
      reported_id: otherParty.userId,
      session_id:  sessionId,
      reason,
    })
    setReportSubmitting(false)
    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn’t send report', error.message ?? 'Please try again.')
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setReportOpen(false)
    setReportReason('')
    Alert.alert('Reported', 'Thank you. Our team will review this.')
  }

  const handleLeaveReview = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const isModel = chat?.model_user_id === userId
    router.push({
      pathname: '/(app)/leave-review' as any,
      params: { sessionId, revieweeType: isModel ? 'provider' : 'model' },
    })
  }

  const handleMarkComplete = () => {
    Alert.alert(
      'Mark as complete?',
      'This confirms the treatment is done. The model will be notified and can leave a review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark complete',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setMarkingComplete(true)
            try {
              // Completing is what unlocks the model's ability to review, so a
              // silent refusal here leaves them permanently unable to leave one.
              await mustWrite(
                supabase.from('sessions').update({ status: 'completed' }).eq('id', sessionId),
                'mark session complete')
              if (chat?.model_user_id) {
                tryWrite(supabase.from('notifications').insert({
                  user_id:    chat.model_user_id,
                  type:       'session_completed',
                  title:      'Treatment completed ✓',
                  body:       'Your stylist has marked the treatment as complete.',
                  session_id: sessionId,
                }), 'complete notification')
              }
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              setChat(prev => prev ? { ...prev, status: 'completed' } : prev)
            } catch {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
              Alert.alert('Error', 'Could not mark treatment as complete. Please try again.')
            }
            setMarkingComplete(false)
          },
        },
      ]
    )
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  // Open the OTHER party's profile. Provider profiles are keyed by providers.id
  // (= chat.provider_id), model profiles by the model's user id — different
  // id-spaces, so this lives in one place and every avatar in the screen uses it.
  const openOtherProfile = async () => {
    const targetId = isModel ? chat?.provider_id : otherParty?.userId
    if (!targetId) return // missing id → do nothing rather than push a broken route
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push(
      isModel
        ? { pathname: '/(app)/provider/[id]' as any, params: { id: targetId } }
        : { pathname: '/(app)/model/[id]' as any, params: { id: targetId } }
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const isAccepted      = chat?.status === 'accepted'
  const isCompleted     = chat?.status === 'completed'
  const showChat        = isAccepted || isCompleted
  const isModel         = chat?.model_user_id === userId
  const initials       = (otherParty?.name ?? '')
    .split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()

  // Find the last message sent by the current user (for read receipt)
  const lastSentIndex = messages.findIndex(m => m.sender_id === userId)
  const lastSentIsRead = lastSentIndex >= 0 && messages[lastSentIndex].read_at !== null

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <View style={{ paddingTop: insets.top }} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.centred]}>
        <LoadErrorState onRetry={() => loadData()} />
      </View>
    )
  }

  // ── Locked state ───────────────────────────────────────────────────────────

  if (!showChat) {
    const statusLabel =
      chat?.status === 'pending'  ? 'Awaiting acceptance' :
      chat?.status === 'declined' ? 'Application not accepted' :
      'Chat unavailable'

    return (
      <View style={styles.container}>
        <View style={[styles.chatHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.headerBackBtn} onPress={goBack} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1}>
              {otherParty?.name ?? 'Chat'}
            </Text>
            {chat?.date && (
              <Text style={styles.headerSub}>{formatSessionDate(chat.date)}</Text>
            )}
          </View>
          <View style={styles.headerRight} />
        </View>

        <View style={[styles.lockedWrap, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.lockedIconCircle}>
            <Ionicons name="lock-closed" size={36} color={Colors.muted} />
          </View>
          <Text style={styles.lockedTitle}>Chat locked</Text>
          <Text style={styles.lockedSub}>
            {chat?.status === 'pending'
              ? `Your chat will unlock once ${otherParty?.name ?? 'the provider'} accepts your application.`
              : 'This chat is no longer available.'}
          </Text>
          {chat?.date && treatment && (
            <View style={styles.lockedMeta}>
              <View style={[
                styles.lockedMetaStripe,
                { backgroundColor: CATEGORY_COLOR[treatment.category] ?? Colors.muted },
              ]} />
              <Text style={styles.lockedMetaText}>
                {formatSessionDate(chat.date)} · {treatment.category}
              </Text>
            </View>
          )}
          <View style={styles.lockedStatusPill}>
            <Text style={styles.lockedStatusText}>{statusLabel}</Text>
          </View>
        </View>
      </View>
    )
  }

  // ── Chat render ────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── Header ── */}
      <View style={[styles.chatHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBackBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerInfo}
          activeOpacity={0.8}
          onPress={openOtherProfile}
        >
          {otherParty?.picUrl ? (
            <Image source={{ uri: otherParty.picUrl }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarPlaceholder}>
              <Text style={styles.headerAvatarInitials}>{initials}</Text>
            </View>
          )}
          <View>
            <Text style={styles.headerName} numberOfLines={1}>{otherParty?.name ?? 'Chat'}</Text>
            {chat?.date && (
              <Text style={styles.headerSub}>{formatSessionDate(chat.date)}</Text>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuBtn}
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            setMenuOpen(true)
          }}
          activeOpacity={0.75}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={Colors.warmDark} />
        </TouchableOpacity>
      </View>

      {/* ── Safety pill ── */}
      <View style={styles.safetyPill}>
        <Ionicons name="shield-checkmark-outline" size={14} color={Colors.roseDark} />
        <Text style={styles.safetyText}>
          Keep chats in Guinea Pig — it protects you both
        </Text>
      </View>

      {/* ── The model's application photos (stylist only) ── */}
      {/* They were shared "to help the stylist prepare", and this is where the
         stylist comes once a booking is accepted — so surface them here too. */}
      {applicationPhotos.length > 0 && (
        <View style={styles.applicationPhotos}>
          <ApplicationPhotos photos={applicationPhotos} onPress={setEnlargedPhoto} />
        </View>
      )}

      {/* ── Mark complete banner (accepted, stylist only) ── */}
      {isAccepted && !isModel && (
        <TouchableOpacity
          style={[styles.completeBanner, markingComplete && { opacity: 0.7 }]}
          onPress={handleMarkComplete}
          disabled={markingComplete}
          activeOpacity={0.85}
        >
          {markingComplete ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
              <Text style={styles.completeBannerText}>Mark treatment as complete</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* ── Review banner (completed sessions) ── */}
      {isCompleted && (
        <TouchableOpacity
          style={[styles.reviewBanner, alreadyReviewed && styles.reviewBannerDone]}
          onPress={alreadyReviewed ? undefined : handleLeaveReview}
          activeOpacity={alreadyReviewed ? 1 : 0.85}
          disabled={alreadyReviewed}
        >
          <Ionicons
            name={alreadyReviewed ? 'checkmark-circle' : 'star-outline'}
            size={18}
            color={alreadyReviewed ? '#059669' : Colors.white}
          />
          <Text style={[styles.reviewBannerText, alreadyReviewed && styles.reviewBannerTextDone]}>
            {alreadyReviewed ? 'Review submitted ✓' : 'Leave a review'}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Messages ── */}
      {/* The list is `inverted`, which flips its whole subtree — anything rendered inside
         it (including ListEmptyComponent) comes out mirrored. Rather than counter-
         transform, render the empty state as a normal sibling and only mount the list
         when there's something to show. */}
      {messages.length === 0 ? (
        <View style={styles.emptyThread}>
          <Ionicons name="chatbubble-ellipses-outline" size={34} color={Colors.muted} />
          <Text style={styles.emptyThreadTitle}>No messages yet</Text>
          <Text style={styles.emptyThreadSub}>
            {isAccepted
              ? 'Say hello and share any details about the look you have in mind.'
              : 'Messages will appear here.'}
          </Text>
        </View>
      ) : (
      <FlatList
        ref={listRef}
        inverted
        data={messages}
        keyExtractor={m => m.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => {
          const isMine  = item.sender_id === userId
          const isFirst = index === messages.length - 1  // oldest visible = top
          const prevMsg = index < messages.length - 1 ? messages[index + 1] : null
          const showDate =
            !prevMsg ||
            new Date(prevMsg.created_at).toDateString() !== new Date(item.created_at).toDateString()
          const showReadReceipt = isMine && index === lastSentIndex && lastSentIsRead

          // Group: don't show avatar if same sender as next message (visually below in inverted)
          const nextMsg      = index > 0 ? messages[index - 1] : null
          const isGroupedTop = nextMsg?.sender_id === item.sender_id && item.type === 'text'

          if (item.type === 'system') {
            return (
              <View style={styles.systemMsgWrap}>
                <Text style={styles.systemMsgText}>{item.body}</Text>
              </View>
            )
          }

          return (
            <>
              {showDate && (
                <View style={styles.dateSeparator}>
                  <View style={styles.dateLine} />
                  <Text style={styles.dateLabel}>{formatDate(item.created_at)}</Text>
                  <View style={styles.dateLine} />
                </View>
              )}
              <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
                {/* Received: show avatar placeholder when not grouped */}
                {!isMine && !isGroupedTop ? (
                  <TouchableOpacity
                    style={styles.bubbleSenderAvatar}
                    onPress={openOtherProfile}
                    activeOpacity={0.8}
                  >
                    {otherParty?.picUrl ? (
                      <Image source={{ uri: otherParty.picUrl }} style={styles.miniAvatar} />
                    ) : (
                      <View style={styles.miniAvatarPlaceholder}>
                        <Text style={styles.miniAvatarInitials}>{initials[0] ?? '?'}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ) : !isMine ? (
                  <View style={styles.avatarSpacer} />
                ) : null}

                <View style={styles.bubbleGroup}>
                  <View style={[
                    styles.bubble,
                    isMine ? styles.bubbleMine : styles.bubbleTheirs,
                    isGroupedTop && (isMine ? styles.bubbleMineGrouped : styles.bubbleTheirsGrouped),
                  ]}>
                    <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
                      {item.body}
                    </Text>
                  </View>
                  <View style={[styles.bubbleMeta, isMine && styles.bubbleMetaMine]}>
                    <Text style={styles.bubbleTime}>{formatTime(item.created_at)}</Text>
                    {showReadReceipt && (
                      <Text style={styles.readReceipt}> · Read</Text>
                    )}
                  </View>
                </View>
              </View>
            </>
          )
        }}
        ListFooterComponent={
          // The chat is where cost is settled, so the reminder belongs here and
          // shows for every booking — not only ones with a price on file.
          showChat ? (
            <View style={styles.costNotice}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.roseDark} />
              {/* Both sides read this, so it's worded for either — it doubles as the
                 reminder to a stylist that portfolio photos need asking for. */}
              <Text style={styles.costNoticeText}>
                Agree any cost{treatment ? ` for your ${treatment.category.toLowerCase()} appointment` : ''} here
                beforehand and settle it in person. Guinea Pig doesn't take payment for treatments
                or handle disputes about them.
                {'\n\n'}
                Portfolio photos are common — often the reason a treatment is free or discounted.
                Agree here whether photos can be taken and where they'll be shared.
              </Text>
            </View>
          ) : null
        }
      />
      )}

      {/* ── Input bar (accepted only) — blocked users can't message ── */}
      {isBlocked ? (
        <View style={[styles.blockedBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Ionicons name="ban-outline" size={16} color={Colors.muted} />
          <Text style={styles.blockedBarText}>You can’t message this user.</Text>
        </View>
      ) : isAccepted ? (
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message…"
            placeholderTextColor={Colors.muted}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            disabled={!inputText.trim() || sending}
            onPress={sendMessage}
            activeOpacity={0.85}
          >
            <Ionicons name="send" size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>
      ) : isCompleted ? (
        // Read-only: say WHY there's no composer rather than just omitting it.
        <View style={[styles.readOnlyBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Ionicons name="lock-closed" size={13} color={Colors.muted} />
          <Text style={styles.readOnlyText}>
            This treatment is complete — the chat is now read-only.
          </Text>
        </View>
      ) : (
        // Other states have no bottom bar — pad for the safe area so the last message
        // isn't obscured by the system nav bar.
        <View style={{ height: Math.max(insets.bottom, 8) }} />
      )}

      {/* ── Block / Report modal ── */}
      <Modal
        visible={menuOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.menuOuter}>
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setMenuOpen(false)}
            activeOpacity={1}
          />
          <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>{otherParty?.name ?? 'User'}</Text>

            <TouchableOpacity style={styles.menuItem} onPress={handleBlock} activeOpacity={0.8}>
              <View style={[styles.menuItemIcon, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="ban-outline" size={20} color="#DC2626" />
              </View>
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemLabel}>Block {otherParty?.name}</Text>
                <Text style={styles.menuItemSub}>They won't be able to message you</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={handleReport} activeOpacity={0.8}>
              <View style={[styles.menuItemIcon, { backgroundColor: '#FFF7ED' }]}>
                <Ionicons name="flag-outline" size={20} color="#EA580C" />
              </View>
              <View style={styles.menuItemText}>
                <Text style={styles.menuItemLabel}>Report {otherParty?.name}</Text>
                <Text style={styles.menuItemSub}>Report a safety or conduct concern</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuCancel}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setMenuOpen(false)
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Report modal (free-text reason) ── */}
      <Modal
        visible={reportOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReportOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.menuOuter}
        >
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setReportOpen(false)}
            activeOpacity={1}
          />
          <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>Report {otherParty?.name ?? 'user'}</Text>
            <Text style={styles.reportHelp}>
              Tell us why you're reporting. Our team will review this conversation.
            </Text>
            <TextInput
              style={styles.reportInput}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="Why are you reporting?"
              placeholderTextColor={Colors.muted}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.reportSubmit, (!reportReason.trim() || reportSubmitting) && styles.reportSubmitDisabled]}
              disabled={!reportReason.trim() || reportSubmitting}
              onPress={submitReport}
              activeOpacity={0.85}
            >
              <Text style={styles.reportSubmitText}>{reportSubmitting ? 'Sending…' : 'Send report'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCancel} onPress={() => setReportOpen(false)} activeOpacity={0.8}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PhotoViewerModal uri={enlargedPhoto} onClose={() => setEnlargedPhoto(null)} />
    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centred:   { alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 15, color: Colors.muted },

  // Header
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
    gap: 8,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  headerAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitials: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },
  headerName: {
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  headerRight: { width: 36 },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Safety pill
  applicationPhotos: {
    marginHorizontal: 12,
    marginTop: 2,
  },
  safetyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.softPink + '35',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.softPink,
  },
  safetyText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Fonts.body,
    color: Colors.roseDark,
    lineHeight: 16,
  },

  // Message list
  messageList:    { flex: 1 },
  messageContent: { paddingHorizontal: 12, paddingVertical: 8 },

  // Empty thread (a brand-new accepted booking) + read-only notice
  // flex:1 so it fills the same space the (flexed) message list would, keeping the
  // input bar pinned to the bottom.
  emptyThread: { flex: 1, alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, gap: 8 },
  emptyThreadTitle: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.warmDark },
  emptyThreadSub: {
    fontFamily: Fonts.body, fontSize: 13, color: Colors.muted,
    textAlign: 'center', lineHeight: 19,
  },
  readOnlyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  readOnlyText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted },

  // Date separator
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dateLabel: {
    fontSize: 11,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 4,
    gap: 6,
  },
  bubbleRowMine: {
    flexDirection: 'row-reverse',
  },
  bubbleSenderAvatar: {},
  avatarSpacer: { width: 28 },
  miniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  miniAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarInitials: {
    fontSize: 10,
    fontFamily: Fonts.bodyBold,
    color: Colors.roseDark,
  },
  bubbleGroup: { maxWidth: '72%' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleMine: {
    backgroundColor: Colors.roseDark,
    borderBottomRightRadius: 6,
  },
  bubbleMineGrouped: {
    borderBottomRightRadius: 18,
    borderTopRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleTheirsGrouped: {
    borderBottomLeftRadius: 18,
    borderTopLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    color: Colors.warmDark,
    lineHeight: 21,
  },
  bubbleTextMine: {
    color: Colors.white,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    paddingHorizontal: 2,
  },
  bubbleMetaMine: { justifyContent: 'flex-end' },
  bubbleTime: {
    fontSize: 10,
    color: Colors.muted,
  },
  readReceipt: {
    fontSize: 10,
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
  },

  // System message
  systemMsgWrap: {
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 20,
  },
  systemMsgText: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 16,
    fontStyle: 'italic',
  },

  // Off-platform cost notice (FlatList footer = visual top of inverted list)
  costNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.softPink + '30',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.softPink,
  },
  costNoticeText: {
    flex: 1,
    fontSize: 12,
    color: Colors.roseDark,
    lineHeight: 17,
    fontFamily: Fonts.body,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  blockedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  blockedBarText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.muted },
  input: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'android' ? 8 : 10,
    fontSize: 15,
    color: Colors.warmDark,
    maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
    flexShrink: 0,
  },
  sendBtnDisabled: {
    backgroundColor: Colors.muted,
    shadowOpacity: 0,
    elevation: 0,
  },

  // Mark complete banner
  completeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.rose,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: Colors.rose,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  completeBannerText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
    letterSpacing: -0.2,
  },

  // Review banner
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: Colors.roseDark,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  reviewBannerDone: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    shadowOpacity: 0,
    elevation: 0,
  },
  reviewBannerText: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
    letterSpacing: -0.2,
  },
  reviewBannerTextDone: {
    color: '#059669',
  },

  // Locked state
  lockedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  lockedIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  lockedTitle: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.warmDark,
    letterSpacing: -0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  lockedSub: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  lockedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  lockedMetaStripe: {
    width: 3,
    height: 16,
    borderRadius: 1.5,
  },
  lockedMetaText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    color: Colors.warmDark,
  },
  lockedStatusPill: {
    backgroundColor: Colors.inputBg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  lockedStatusText: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
  },

  // Block / Report modal
  menuOuter: { flex: 1, justifyContent: 'flex-end' },
  menuBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  menuSheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 16,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  menuTitle: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.warmDark,
    letterSpacing: -0.2,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  menuItemText: { flex: 1 },
  menuItemLabel: {
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    marginBottom: 2,
  },
  menuItemSub: {
    fontSize: 12,
    color: Colors.muted,
  },
  menuCancel: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuCancelText: {
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
  },
  reportHelp: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  reportInput: {
    minHeight: 90,
    maxHeight: 160,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: Colors.inputBg,
    padding: 12,
    fontSize: 15,
    color: Colors.warmDark,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  reportSubmit: {
    backgroundColor: Colors.rose,
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportSubmitDisabled: { opacity: 0.45 },
  reportSubmitText: {
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },
})
