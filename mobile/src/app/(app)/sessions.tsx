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
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { mustWrite, tryWrite } from '@/lib/db'
import { signModelPhotos } from '@/lib/photoUrls'
import { useProfileNav } from '@/lib/profileNav'
import LoadErrorState from '@/components/LoadErrorState'
import ApplicationPhotos from '@/components/ApplicationPhotos'
import PhotoViewerModal from '@/components/PhotoViewerModal'

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionStatus = 'pending' | 'accepted' | 'completed'

type Sess = {
  id: string
  model_user_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
  note: string | null
  // Signed urls for the photos the model attached when applying (private bucket).
  photoUrls: string[]
  created_at: string
  status: SessionStatus
  modelName: string
  modelPicUrl: string | null
  treatmentName: string | null
  treatmentCategory: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cc(_cat: string | null | undefined) {
  return Colors.rose
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function fmtTime(t: string): string {
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SessionsScreen() {
  const router    = useRouter()
  const { session } = useAuth()
  const insets    = useSafeAreaInsets()
  const userId    = session?.user?.id

  const [pending,       setPending]       = useState<Sess[]>([])
  const [confirmed,     setConfirmed]     = useState<Sess[]>([])
  const [completed,     setCompleted]     = useState<Sess[]>([])
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  // Signed url of the application photo being viewed full-screen, if any.
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) return
    if (!isRefresh) setLoading(true)
    setLoadError(false)
    try {
      const { data: provRow } = await supabase
        .from('providers').select('id').eq('user_id', userId).maybeSingle()
      const providerId = (provRow as any)?.id
      if (!providerId) { setLoading(false); setRefreshing(false); return }

      const { data: rawSessions } = await supabase
        .from('sessions')
        .select('id, model_user_id, date, start_time, end_time, treatment_id, note, photo_urls, created_at, status')
        .eq('provider_id', providerId)
        .in('status', ['pending', 'accepted', 'completed'])
        .order('date', { ascending: false })

      const rows = (rawSessions ?? []) as any[]
      if (rows.length === 0) {
        setPending([]); setConfirmed([]); setCompleted([])
        setLoading(false); setRefreshing(false)
        return
      }

      const modelIds = [...new Set(rows.map((s: any) => s.model_user_id as string))]
      const treatIds = [...new Set(rows.map((s: any) => s.treatment_id as string | null).filter(Boolean))] as string[]

      const [{ data: modelsData }, { data: treatsData }] = await Promise.all([
        supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').in('id', modelIds),
        treatIds.length > 0
          ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
          : Promise.resolve({ data: [] as any[] }),
      ])

      const modelMap: Record<string, any> = {}
      const treatMap: Record<string, any> = {}
      ;(modelsData ?? []).forEach((m: any) => { modelMap[m.id] = m })
      ;(treatsData ?? []).forEach((t: any) => { treatMap[t.id] = t })

      // The model's attached photos live in a PRIVATE bucket, so the stored paths
      // must be swapped for signed urls or they render blank. One batched call.
      const allPhotoPaths = rows.flatMap((s: any) => (s.photo_urls ?? []) as string[])
      const signedPhotos = allPhotoPaths.length > 0
        ? await signModelPhotos(allPhotoPaths)
        : new Map<string, string>()

      const enrich = (s: any): Sess => {
        const m = modelMap[s.model_user_id]
        const t = s.treatment_id ? treatMap[s.treatment_id] : null
        return {
          id:               s.id,
          model_user_id:    s.model_user_id,
          date:             s.date,
          start_time:       s.start_time,
          end_time:         s.end_time,
          treatment_id:     s.treatment_id ?? null,
          note:             s.note ?? null,
          photoUrls:        ((s.photo_urls ?? []) as string[]).map(p => signedPhotos.get(p) ?? p),
          created_at:       s.created_at,
          status:           s.status as SessionStatus,
          modelName:        m ? `${m.first_name ?? ''}${m.last_initial ? ' ' + m.last_initial + '.' : ''}`.trim() || 'Model' : 'Model',
          modelPicUrl:      m?.profile_pic_url ?? null,
          treatmentName:    t?.name ?? null,
          treatmentCategory: t?.category ?? null,
        }
      }

      const enriched = rows.map(enrich)
      const today = todayKey()

      setPending(enriched.filter(s => s.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)))
      setConfirmed(enriched.filter(s => s.status === 'accepted').sort((a, b) => a.date.localeCompare(b.date)))
      setCompleted(enriched.filter(s => s.status === 'completed').sort((a, b) => b.date.localeCompare(a.date)))
    } catch (e) {
      console.error('sessions load failed:', e)
      setLoadError(true)
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load(true) }

  // ── Actions ────────────────────────────────────────────────────────────────

  const setProcessing = (id: string, on: boolean) =>
    setProcessingIds(prev => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n })

  const acceptSession = async (s: Sess) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setProcessing(s.id, true)
    try {
      // Must come first and must throw on refusal: the status guard rejects an
      // accept on a session that's already cancelled, and without this the model
      // would be pushed "Treatment accepted! 🎉" for a booking that never moved.
      await mustWrite(
        supabase.from('sessions').update({ status: 'accepted' }).eq('id', s.id),
        'accept session')
      tryWrite(supabase.from('notifications').insert({
        user_id: s.model_user_id, type: 'session_accepted',
        title: 'Treatment accepted! 🎉',
        body: `Your booking for ${fmtDate(s.date)} has been confirmed.`,
        session_id: s.id,
      }), 'accept notification')
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPending(prev => prev.filter(x => x.id !== s.id))
      setConfirmed(prev => [...prev, { ...s, status: 'accepted' }].sort((a, b) => a.date.localeCompare(b.date)))
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', 'Could not accept treatment.')
    }
    setProcessing(s.id, false)
  }

  const declineSession = (s: Sess) => {
    Alert.alert(
      'Decline treatment?',
      `This will decline ${s.modelName}'s application for ${fmtDate(s.date)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline', style: 'destructive',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setProcessing(s.id, true)
            try {
              await mustWrite(
                supabase.from('sessions').update({ status: 'declined' }).eq('id', s.id),
                'decline session')
              tryWrite(supabase.from('notifications').insert({
                user_id: s.model_user_id, type: 'session_declined',
                title: 'Treatment update',
                body: `Your booking for ${fmtDate(s.date)} was not confirmed.`,
                session_id: s.id,
              }), 'decline notification')
              setPending(prev => prev.filter(x => x.id !== s.id))
            } catch {
              Alert.alert('Error', 'Could not decline treatment.')
            }
            setProcessing(s.id, false)
          },
        },
      ]
    )
  }

  const markComplete = (s: Sess) => {
    Alert.alert(
      'Mark as complete?',
      `Confirm the treatment with ${s.modelName} on ${fmtDate(s.date)} is done. They'll be invited to leave a review.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark complete',
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
            setProcessing(s.id, true)
            try {
              await mustWrite(
                supabase.from('sessions').update({ status: 'completed' }).eq('id', s.id),
                'complete session')
              tryWrite(supabase.from('notifications').insert({
                user_id: s.model_user_id, type: 'session_completed',
                title: 'Treatment completed ✓',
                body: `Your treatment on ${fmtDate(s.date)} has been marked as completed.`,
                session_id: s.id,
              }), 'complete notification')
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              setConfirmed(prev => prev.filter(x => x.id !== s.id))
              setCompleted(prev => [{ ...s, status: 'completed' }, ...prev])
            } catch {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
              Alert.alert('Error', 'Could not mark treatment as complete.')
            }
            setProcessing(s.id, false)
          },
        },
      ]
    )
  }

  const goChat = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId: id } })
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <LoadErrorState onRetry={() => load()} />
      </View>
    )
  }

  const today = todayKey()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>All bookings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.roseDark} colors={[Colors.roseDark]} />}
      >
        {/* ── Applications ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Applications</Text>
          {pending.length > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{pending.length}</Text></View>
          )}
        </View>
        {pending.length === 0 ? (
          <EmptyCard icon="checkmark-circle-outline" text="No pending applications" />
        ) : (
          pending.map(s => (
            <PendingCard
              key={s.id}
              s={s}
              processing={processingIds.has(s.id)}
              onAccept={() => acceptSession(s)}
              onDecline={() => declineSession(s)}
              onPhotoPress={setEnlargedPhoto}
            />
          ))
        )}

        {/* ── Confirmed ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Confirmed</Text>
          {confirmed.length > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{confirmed.length}</Text></View>
          )}
        </View>
        {confirmed.length === 0 ? (
          <EmptyCard icon="calendar-outline" text="No confirmed treatments" />
        ) : (
          confirmed.map(s => (
            <ConfirmedCard
              key={s.id}
              s={s}
              isPast={s.date < today}
              processing={processingIds.has(s.id)}
              onChat={() => goChat(s.id)}
              onComplete={() => markComplete(s)}
              onPhotoPress={setEnlargedPhoto}
            />
          ))
        )}

        {/* ── Completed ── */}
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Completed</Text>
        </View>
        {completed.length === 0 ? (
          <EmptyCard icon="ribbon-outline" text="No completed treatments yet" />
        ) : (
          completed.map(s => (
            <CompletedCard
              key={s.id}
              s={s}
              onChat={() => goChat(s.id)}
            />
          ))
        )}
      </ScrollView>

      <PhotoViewerModal uri={enlargedPhoto} onClose={() => setEnlargedPhoto(null)} />
    </View>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyCard({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name={icon as any} size={28} color={Colors.muted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

function SessionBase({ s }: { s: Sess }) {
  const color = cc(s.treatmentCategory)
  const initials = s.modelName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  const { openModel } = useProfileNav()
  return (
    <View style={styles.cardRow}>
      {/* Tap the model to see their profile before deciding. */}
      <TouchableOpacity onPress={() => openModel(s.model_user_id)} activeOpacity={0.8}>
        {s.modelPicUrl ? (
          <Image source={{ uri: s.modelPicUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </TouchableOpacity>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.modelName}>{s.modelName}</Text>
        <View style={styles.metaRow}>
          {s.treatmentName && (
            <View style={[styles.treatPill, { backgroundColor: color + '22' }]}>
              <View style={[styles.treatDot, { backgroundColor: color }]} />
              <Text style={[styles.treatPillText, { color }]}>{s.treatmentName}</Text>
            </View>
          )}
          <Text style={styles.metaText}>{fmtDate(s.date)} · {fmtTime(s.start_time)}</Text>
        </View>
        {s.note ? <Text style={styles.note} numberOfLines={1}>"{s.note}"</Text> : null}
      </View>
    </View>
  )
}

function PendingCard({
  s, processing, onAccept, onDecline, onPhotoPress,
}: {
  s: Sess; processing: boolean
  onAccept: () => void; onDecline: () => void; onPhotoPress: (uri: string) => void
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <SessionBase s={s} />
        <Text style={styles.agoText}>{timeAgo(s.created_at)}</Text>
      </View>
      {/* What the model shared, so the stylist can judge the job before accepting. */}
      <ApplicationPhotos photos={s.photoUrls} onPress={onPhotoPress} />
      <View style={styles.actions}>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline} disabled={processing} activeOpacity={0.85}>
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.acceptBtn, processing && { opacity: 0.6 }]}
          onPress={onAccept} disabled={processing} activeOpacity={0.9}
        >
          {processing
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <><Ionicons name="checkmark" size={15} color={Colors.white} /><Text style={styles.acceptBtnText}>Accept</Text></>
          }
        </TouchableOpacity>
      </View>
    </View>
  )
}

function ConfirmedCard({
  s, isPast, processing, onChat, onComplete, onPhotoPress,
}: {
  s: Sess; isPast: boolean; processing: boolean
  onChat: () => void; onComplete: () => void; onPhotoPress: (uri: string) => void
}) {
  return (
    <View style={styles.card}>
      {isPast && (
        <View style={styles.pastBanner}>
          <Ionicons name="time-outline" size={13} color={Colors.roseDark} />
          <Text style={styles.pastBannerText}>Date passed — mark as complete when done</Text>
        </View>
      )}
      <SessionBase s={s} />
      {/* Still shown after accepting — the photos were shared to help the stylist prepare. */}
      <ApplicationPhotos photos={s.photoUrls} onPress={onPhotoPress} />
      <View style={styles.actions}>
        <TouchableOpacity style={styles.chatBtn} onPress={onChat} activeOpacity={0.85}>
          <Ionicons name="chatbubble-outline" size={15} color={Colors.roseDark} />
          <Text style={styles.chatBtnText}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.completeBtn, processing && { opacity: 0.6 }]}
          onPress={onComplete} disabled={processing} activeOpacity={0.9}
        >
          {processing
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <><Ionicons name="checkmark-circle-outline" size={15} color={Colors.white} /><Text style={styles.completeBtnText}>Mark complete</Text></>
          }
        </TouchableOpacity>
      </View>
    </View>
  )
}

function CompletedCard({ s, onChat }: { s: Sess; onChat: () => void }) {
  return (
    <View style={[styles.card, styles.cardCompleted]}>
      <SessionBase s={s} />
      <TouchableOpacity style={styles.chatBtn} onPress={onChat} activeOpacity={0.85}>
        <Ionicons name="chatbubble-outline" size={15} color={Colors.roseDark} />
        <Text style={styles.chatBtnText}>Chat / Review</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: {
    fontFamily: Fonts.display,
    flex: 1, textAlign: 'center', fontSize: 22,
    color: Colors.rose, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle:  { fontFamily: Fonts.heading, fontSize: 18, color: Colors.warmDark, letterSpacing: -0.2 },
  badge: {
    backgroundColor: Colors.rose, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 22, alignItems: 'center',
  },
  badgeText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.white },

  emptyCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 20,
    alignItems: 'center', gap: 8, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyText: { fontSize: 13, color: Colors.muted, fontFamily: Fonts.body },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft, gap: 12,
  },
  cardCompleted: { opacity: 0.85 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  agoText: { fontSize: 11, color: Colors.muted, marginTop: 2, flexShrink: 0 },

  cardRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: Colors.border, flexShrink: 0 },
  avatarPlaceholder: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarInitials: { fontSize: 15, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  modelName: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.warmDark },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  treatPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  treatDot: { width: 5, height: 5, borderRadius: 2.5 },
  treatPillText: { fontSize: 11, fontFamily: Fonts.bodyBold },
  metaText: { fontSize: 12, color: Colors.muted, fontFamily: Fonts.body },
  note: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },

  pastBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.softPink, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  pastBannerText: { fontSize: 12, fontFamily: Fonts.bodyBold, color: Colors.roseDark, flex: 1 },

  actions: { flexDirection: 'row', gap: 8 },

  declineBtn: {
    flex: 1, height: 40, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  declineBtnText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.warmDark },

  acceptBtn: {
    flex: 2, height: 40, borderRadius: Radius.md, backgroundColor: Colors.rose,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    ...Shadow.card,
  },
  acceptBtnText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.white },

  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.inputBg, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  chatBtnText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.roseDark },

  completeBtn: {
    flex: 1, height: 40, borderRadius: Radius.md, backgroundColor: Colors.rose,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    ...Shadow.card,
  },
  completeBtnText: { fontSize: 13, fontFamily: Fonts.bodyBold, color: Colors.white },
})
