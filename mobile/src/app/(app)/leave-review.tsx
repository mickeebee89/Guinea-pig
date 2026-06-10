import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const TAGS = [
  'So friendly',
  'Great results',
  'Lovely space',
  'Patient with me',
  'Pro-level work',
  'Made me feel welcome',
] as const

type Tag = typeof TAGS[number]

const SUB_RATINGS = [
  { key: 'quality',      label: 'Quality',      icon: 'sparkles-outline' },
  { key: 'friendliness', label: 'Friendliness',  icon: 'heart-outline'   },
  { key: 'comfort',      label: 'Comfort',       icon: 'home-outline'    },
  { key: 'punctuality',  label: 'Punctuality',   icon: 'time-outline'    },
] as const

const RATING_LABELS: Record<number, string> = {
  0: 'Tap to rate',
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Great',
  5: 'Excellent!',
}

const COMMENT_MAX = 300

const CATEGORY_COLORS: Record<string, string> = {
  nails: '#C8788A', lashes: '#1D9E75', brows: '#BA7517',
  hair: '#7B5EA7', makeup: '#E8845E', 'spray tan': '#C99A4E',
}

function categoryColor(cat: string | null | undefined) {
  return CATEGORY_COLORS[(cat ?? '').toLowerCase()] ?? Colors.roseDark
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionData = {
  id: string
  provider_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
}

type ProviderData = {
  id: string
  name: string
  profile_pic_url: string | null
}

type TreatmentData = {
  id: string
  name: string
  category: string
}

type SubRatings = { quality: number; friendliness: number; comfort: number; punctuality: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatTime(t: string): string {
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StarRow({
  rating,
  size,
  onRate,
  color = '#F59E0B',
}: {
  rating: number
  size: number
  onRate?: (r: number) => void
  color?: string
}) {
  return (
    <View style={{ flexDirection: 'row', gap: size > 24 ? 8 : 4 }}>
      {[1, 2, 3, 4, 5].map(star => (
        <TouchableOpacity
          key={star}
          onPress={onRate ? async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            onRate(star)
          } : undefined}
          disabled={!onRate}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
        >
          <Ionicons
            name={star <= rating ? 'star' : 'star-outline'}
            size={size}
            color={star <= rating ? color : Colors.border}
          />
        </TouchableOpacity>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LeaveReviewScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>()
  const router  = useRouter()
  const { session } = useAuth()
  const insets  = useSafeAreaInsets()
  const userId  = session?.user?.id

  const [sessionData,    setSessionData]    = useState<SessionData | null>(null)
  const [provider,       setProvider]       = useState<ProviderData | null>(null)
  const [treatment,      setTreatment]      = useState<TreatmentData | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [alreadyReviewed,setAlreadyReviewed]= useState(false)
  const [posting,        setPosting]        = useState(false)
  const [posted,         setPosted]         = useState(false)

  const [overallRating,  setOverallRating]  = useState(0)
  const [subRatings,     setSubRatings]     = useState<SubRatings>({
    quality: 0, friendliness: 0, comfort: 0, punctuality: 0,
  })
  const [selectedTags,   setSelectedTags]   = useState<Set<Tag>>(new Set())
  const [comment,        setComment]        = useState('')

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!sessionId || !userId) { setLoading(false); return }
    try {
      const { data: sd } = await supabase
        .from('sessions')
        .select('id, provider_id, date, start_time, end_time, treatment_id')
        .eq('id', sessionId)
        .single()

      if (!sd) { setLoading(false); return }
      setSessionData(sd as SessionData)

      const [
        { data: pd },
        { data: td },
        { data: existingReview },
      ] = await Promise.all([
        supabase
          .from('providers')
          .select('id, name, profile_pic_url')
          .eq('id', (sd as any).provider_id)
          .single(),
        (sd as any).treatment_id
          ? supabase
              .from('provider_treatments')
              .select('id, name, category')
              .eq('id', (sd as any).treatment_id)
              .single()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('reviews')
          .select('id')
          .eq('provider_id', (sd as any).provider_id)
          .eq('reviewer_id', userId)
          .maybeSingle(),
      ])

      setProvider(pd as ProviderData)
      setTreatment(td as TreatmentData | null)
      if (existingReview) setAlreadyReviewed(true)
    } catch {}
    setLoading(false)
  }, [sessionId, userId])

  useEffect(() => { load() }, [load])

  // ── Interactions ───────────────────────────────────────────────────────────

  const setOverall = async (rating: number) => {
    setOverallRating(rating)
    // Pre-fill sub-ratings only if they're still at 0
    setSubRatings(prev => ({
      quality:      prev.quality      || rating,
      friendliness: prev.friendliness || rating,
      comfort:      prev.comfort      || rating,
      punctuality:  prev.punctuality  || rating,
    }))
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const setSubRating = (key: keyof SubRatings) => async (rating: number) => {
    setSubRatings(prev => ({ ...prev, [key]: rating }))
  }

  const toggleTag = async (tag: Tag) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedTags(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  // ── Post ───────────────────────────────────────────────────────────────────

  const postReview = async () => {
    if (!sessionData || !userId || overallRating === 0) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setPosting(true)

    try {
      const reviewPayload = {
        provider_id: sessionData.provider_id,
        reviewer_id: userId,
        rating: overallRating,
        comment: comment.trim() || null,
        tags: [...selectedTags],
        sub_ratings: {
          quality:      subRatings.quality      || overallRating,
          friendliness: subRatings.friendliness || overallRating,
          comfort:      subRatings.comfort      || overallRating,
          punctuality:  subRatings.punctuality  || overallRating,
        },
      }

      const { error: insertErr } = await supabase.from('reviews').insert(reviewPayload)

      if (insertErr) {
        // Retry without sub_ratings if column doesn't exist
        const { sub_ratings: _, ...basePayload } = reviewPayload
        const { error: retryErr } = await supabase.from('reviews').insert(basePayload)
        if (retryErr) throw retryErr
      }

      // Mark session as completed
      try {
        await supabase
          .from('sessions')
          .update({ status: 'completed' })
          .eq('id', sessionData.id)
      } catch {}

      // Update provider rating average (best-effort)
      try {
        const { data: ratingData } = await supabase
          .from('reviews')
          .select('rating')
          .eq('provider_id', sessionData.provider_id)
        if (ratingData && ratingData.length > 0) {
          const avg = ratingData.reduce((sum: number, r: any) => sum + r.rating, 0) / ratingData.length
          await supabase
            .from('providers')
            .update({ rating: Math.round(avg * 10) / 10, review_count: ratingData.length })
            .eq('id', sessionData.provider_id)
        }
      } catch {}

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setPosted(true)
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Error', 'Could not post your review. Please try again.')
    }
    setPosting(false)
  }

  // ── Loading / special states ───────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (alreadyReviewed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={[styles.topBar, { paddingTop: 8 }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.75}
          >
            <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Leave a review</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={[styles.centred, { flex: 1 }]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={48} color={Colors.white} />
          </View>
          <Text style={styles.successTitle}>Already reviewed</Text>
          <Text style={styles.successSub}>You've already left a review for this session.</Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.9}
          >
            <Text style={styles.doneBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Success ────────────────────────────────────────────────────────────────

  if (posted) {
    return (
      <View style={[styles.container, styles.centred, { paddingHorizontal: 40 }]}>
        <View style={styles.successIconCircle}>
          <Ionicons name="star" size={40} color={Colors.white} />
        </View>
        <Text style={styles.successTitle}>Review posted!</Text>
        <Text style={styles.successSub}>
          Your review helps other models discover great providers. Thank you!
        </Text>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.9}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────

  const catColor    = categoryColor(treatment?.category)
  const provInitials = provider?.name
    .split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() ?? '?'
  const canPost = overallRating > 0

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Leave a review</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.bottom + 80}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Session recap card ── */}
          <View style={styles.recapCard}>
            <View style={styles.recapStrip} />
            <View style={styles.recapBody}>
              {provider?.profile_pic_url ? (
                <Image source={{ uri: provider.profile_pic_url }} style={styles.recapAvatar} />
              ) : (
                <View style={styles.recapAvatarPlaceholder}>
                  <Text style={styles.recapAvatarInitials}>{provInitials}</Text>
                </View>
              )}
              <View style={styles.recapInfo}>
                <Text style={styles.recapName}>{provider?.name ?? 'Provider'}</Text>
                {treatment && (
                  <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                    <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                    <Text style={[styles.treatPillText, { color: catColor }]}>{treatment.name}</Text>
                  </View>
                )}
                {sessionData && (
                  <Text style={styles.recapDate}>
                    {formatDate(sessionData.date)}
                    {' · '}{formatTime(sessionData.start_time)} – {formatTime(sessionData.end_time)}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* ── Overall rating ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Overall rating</Text>
            <View style={styles.starsLarge}>
              <StarRow rating={overallRating} size={44} onRate={setOverall} />
            </View>
            <Text style={[
              styles.ratingLabel,
              overallRating > 0 && { color: Colors.warmDark, fontWeight: '700' },
            ]}>
              {RATING_LABELS[overallRating]}
            </Text>
          </View>

          {/* ── Category ratings ── (shown after overall is set) */}
          {overallRating > 0 && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Category ratings</Text>
              <Text style={styles.sectionSub}>Optional — adjust any that felt different</Text>
              {SUB_RATINGS.map(({ key, label, icon }) => (
                <View key={key} style={styles.subRatingRow}>
                  <View style={styles.subRatingLeft}>
                    <Ionicons name={icon as any} size={16} color={Colors.muted} />
                    <Text style={styles.subRatingLabel}>{label}</Text>
                  </View>
                  <StarRow
                    rating={subRatings[key as keyof SubRatings]}
                    size={22}
                    onRate={setSubRating(key as keyof SubRatings)}
                  />
                </View>
              ))}
            </View>
          )}

          {/* ── Tags ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Highlights</Text>
            <Text style={styles.sectionSub}>Select all that apply</Text>
            <View style={styles.tagGrid}>
              {TAGS.map(tag => {
                const selected = selectedTags.has(tag)
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.tagChip, selected && styles.tagChipSelected]}
                    onPress={() => toggleTag(tag)}
                    activeOpacity={0.8}
                  >
                    {selected && (
                      <Ionicons name="checkmark" size={13} color={Colors.white} style={{ marginRight: 4 }} />
                    )}
                    <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* ── Comment ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Your thoughts</Text>
            <Text style={styles.sectionSub}>Optional — share anything else</Text>
            <TextInput
              style={styles.commentInput}
              multiline
              value={comment}
              onChangeText={t => setComment(t.slice(0, COMMENT_MAX))}
              placeholder="What made this session memorable? Any tips for other models?"
              placeholderTextColor={Colors.muted}
              textAlignVertical="top"
            />
            <Text style={styles.commentCounter}>
              {comment.length}/{COMMENT_MAX}
            </Text>
          </View>
        </ScrollView>

        {/* ── Bottom button bar ── */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!canPost && (
            <Text style={styles.rateHint}>Rate your experience to continue</Text>
          )}
          <TouchableOpacity
            style={[styles.postBtn, !canPost && styles.postBtnDisabled, posting && { opacity: 0.7 }]}
            onPress={postReview}
            disabled={!canPost || posting}
            activeOpacity={0.9}
          >
            {posting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Ionicons name="star" size={18} color={Colors.white} />
                <Text style={styles.postBtnText}>Post review</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  centred:   { alignItems: 'center', justifyContent: 'center', gap: 16 },

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
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // Recap card
  recapCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  recapStrip: {
    height: 6,
    backgroundColor: Colors.roseDark,
  },
  recapBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  recapAvatar: {
    width: 56,
    height: 56,
    borderRadius: 14,
    flexShrink: 0,
  },
  recapAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recapAvatarInitials: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.roseDark,
  },
  recapInfo: { flex: 1, gap: 6 },
  recapName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
  },
  treatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  treatDot: { width: 6, height: 6, borderRadius: 3 },
  treatPillText: { fontSize: 12, fontWeight: '700' },
  recapDate: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
  },

  // Section cards
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 14,
  },

  // Overall stars
  starsLarge: {
    alignItems: 'center',
    marginVertical: 16,
  },
  ratingLabel: {
    textAlign: 'center',
    fontSize: 14,
    color: Colors.muted,
    fontWeight: '500',
    marginTop: 4,
  },

  // Sub-ratings
  subRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subRatingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subRatingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
  },

  // Tag chips
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.softPink,
    backgroundColor: Colors.white,
  },
  tagChipSelected: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roseDark,
  },
  tagChipTextSelected: {
    color: Colors.white,
  },

  // Comment
  commentInput: {
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 14,
    fontSize: 14,
    color: Colors.warmDark,
    minHeight: 100,
    lineHeight: 20,
  },
  commentCounter: {
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 6,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
    gap: 8,
  },
  rateHint: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
  },
  postBtn: {
    height: 54,
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  postBtnDisabled: {
    backgroundColor: Colors.muted,
    shadowOpacity: 0,
    elevation: 0,
  },
  postBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: -0.2,
  },

  // Success / already reviewed
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneBtn: {
    marginTop: 8,
    height: 54,
    width: 180,
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
})
