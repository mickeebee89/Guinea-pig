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
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import LoadErrorState from '@/components/LoadErrorState'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_TAGS = [
  'So friendly',
  'Great results',
  'Lovely space',
  'Patient with me',
  'Pro-level work',
  'Made me feel welcome',
] as const

const MODEL_TAGS = [
  'On time',
  'Easy to communicate with',
  'Well-prepared',
  'Receptive to direction',
  'Professional attitude',
  'Great to work with',
] as const

const PROVIDER_SUB_RATINGS = [
  { key: 'quality',      label: 'Quality',      icon: 'sparkles-outline' },
  { key: 'friendliness', label: 'Friendliness', icon: 'heart-outline'   },
  { key: 'comfort',      label: 'Comfort',      icon: 'home-outline'    },
  { key: 'punctuality',  label: 'Punctuality',  icon: 'time-outline'    },
] as const

const MODEL_SUB_RATINGS = [
  { key: 'punctuality',    label: 'Punctuality',    icon: 'time-outline'          },
  { key: 'communication',  label: 'Communication',  icon: 'chatbubble-outline'    },
  { key: 'suitability',    label: 'Suitability',    icon: 'person-outline'        },
  { key: 'receptiveness',  label: 'Receptiveness',  icon: 'sparkles-outline'      },
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
  nails: CategoryColors.nails, lashes: CategoryColors.lashes, brows: CategoryColors.brows,
  hair: CategoryColors.hair, makeup: CategoryColors.makeup, 'spray tan': CategoryColors.sprayTan,
}

function categoryColor(cat: string | null | undefined) {
  return CATEGORY_COLORS[(cat ?? '').toLowerCase()] ?? Colors.rose
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionData = {
  id: string
  provider_id: string
  model_user_id: string
  date: string
  start_time: string
  end_time: string
  treatment_id: string | null
}

type SubRatingKey = 'quality' | 'friendliness' | 'comfort' | 'punctuality' | 'communication' | 'suitability' | 'receptiveness'
type SubRatings = Partial<Record<SubRatingKey, number>>

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
}: {
  rating: number
  size: number
  onRate?: (r: number) => void
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
            color={star <= rating ? '#F59E0B' : Colors.border} // star amber kept intentionally (rule 2)
          />
        </TouchableOpacity>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LeaveReviewScreen() {
  const { sessionId, revieweeType = 'provider' } =
    useLocalSearchParams<{ sessionId: string; revieweeType?: string }>()
  const router      = useRouter()
  const { session } = useAuth()
  const insets      = useSafeAreaInsets()
  const userId      = session?.user?.id

  const isReviewingModel = revieweeType === 'model'

  // ── Reviewee info state ────────────────────────────────────────────────────
  const [sessionData,      setSessionData]      = useState<SessionData | null>(null)
  const [revieweeName,     setRevieweeName]     = useState<string>('')
  const [revieweePicUrl,   setRevieweePicUrl]   = useState<string | null>(null)
  const [revieweeUserId,   setRevieweeUserId]   = useState<string | null>(null)
  const [treatmentName,    setTreatmentName]    = useState<string | null>(null)
  const [treatmentCat,     setTreatmentCat]     = useState<string | null>(null)
  const [loading,          setLoading]          = useState(true)
  const [loadError,        setLoadError]        = useState(false)
  const [alreadyReviewed,  setAlreadyReviewed]  = useState(false)
  const [posting,          setPosting]          = useState(false)
  const [posted,           setPosted]           = useState(false)

  // ── Form state ─────────────────────────────────────────────────────────────
  const [overallRating, setOverallRating] = useState(0)
  const [subRatings,    setSubRatings]    = useState<SubRatings>({})
  const [selectedTags,  setSelectedTags]  = useState<Set<string>>(new Set())
  const [comment,       setComment]       = useState('')

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!sessionId || !userId) { setLoading(false); return }
    setLoadError(false)
    try {
      const { data: sd } = await supabase
        .from('sessions')
        .select('id, provider_id, model_user_id, date, start_time, end_time, treatment_id')
        .eq('id', sessionId)
        .single()

      if (!sd) { setLoading(false); return }
      const s = sd as SessionData
      setSessionData(s)

      // Fetch reviewee info + treatment + existing review in parallel
      const promises: Promise<any>[] = [
        // existing review check
        supabase
          .from('reviews')
          .select('id')
          .eq('session_id', sessionId)
          .eq('reviewer_id', userId)
          .maybeSingle(),
        // treatment (optional)
        s.treatment_id
          ? supabase
              .from('provider_treatments')
              .select('name, category')
              .eq('id', s.treatment_id)
              .single()
          : Promise.resolve({ data: null }),
      ]

      if (isReviewingModel) {
        promises.push(
          supabase
            .from('public_profiles')
            .select('first_name, last_initial, profile_pic_url')
            .eq('id', s.model_user_id)
            .single()
        )
      } else {
        promises.push(
          supabase
            .from('providers')
            .select('name, profile_pic_url, user_id')
            .eq('id', s.provider_id)
            .single()
        )
      }

      const [{ data: existRev }, { data: td }, { data: rd }] = await Promise.all(promises)

      if (existRev) { setAlreadyReviewed(true) }
      if (td) {
        setTreatmentName((td as any).name ?? null)
        setTreatmentCat((td as any).category ?? null)
      }
      if (rd) {
        if (isReviewingModel) {
          const u = rd as any
          const name = u.first_name
            ? `${u.first_name}${u.last_initial ? ` ${u.last_initial}.` : ''}`
            : 'Model'
          setRevieweeName(name)
          setRevieweePicUrl(u.profile_pic_url ?? null)
          setRevieweeUserId(s.model_user_id)
        } else {
          setRevieweeName((rd as any).name ?? 'Provider')
          setRevieweePicUrl((rd as any).profile_pic_url ?? null)
          setRevieweeUserId((rd as any).user_id ?? null)
        }
      }
    } catch (e) {
      console.error('leave-review load failed:', e)
      setLoadError(true)
    }
    setLoading(false)
  }, [sessionId, userId, isReviewingModel])

  useEffect(() => { load() }, [load])

  // ── Interactions ───────────────────────────────────────────────────────────

  const setOverall = async (rating: number) => {
    setOverallRating(rating)
    const subKeys = isReviewingModel
      ? ['punctuality', 'communication', 'suitability', 'receptiveness']
      : ['quality', 'friendliness', 'comfort', 'punctuality']
    setSubRatings(prev => {
      const next = { ...prev }
      for (const k of subKeys) {
        if (!prev[k as SubRatingKey]) next[k as SubRatingKey] = rating
      }
      return next
    })
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const setSubRating = (key: SubRatingKey) => async (rating: number) => {
    setSubRatings(prev => ({ ...prev, [key]: rating }))
  }

  const toggleTag = async (tag: string) => {
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
      const payload: Record<string, any> = {
        session_id:     sessionId,
        reviewer_id:    userId,
        reviewee_id:    revieweeUserId,
        overall_rating: overallRating,
        tags:           selectedTags.size > 0 ? [...selectedTags] : [],
        comment:        comment.trim() || null,
        ...(subRatings.quality      != null ? { quality_rating:      subRatings.quality      || overallRating } : {}),
        ...(subRatings.friendliness != null ? { friendliness_rating: subRatings.friendliness || overallRating } : {}),
        ...(subRatings.comfort      != null ? { comfort_rating:      subRatings.comfort      || overallRating } : {}),
        ...(subRatings.punctuality  != null ? { punctuality_rating:  subRatings.punctuality  || overallRating } : {}),
      }

      const { data, error: insertErr } = await supabase.from('reviews').insert(payload)

      if (insertErr) throw insertErr

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
        <ActivityIndicator color={Colors.rose} />
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

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  if (alreadyReviewed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={[styles.topBar, { paddingTop: 8 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.rose} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Leave a review</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={[styles.centred, { flex: 1 }]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={48} color={Colors.white} />
          </View>
          <Text style={styles.successTitle}>Already reviewed</Text>
          <Text style={styles.successSub}>You've already left a review for this treatment.</Text>
          <TouchableOpacity style={styles.doneBtn} onPress={goBack} activeOpacity={0.9}>
            <Text style={styles.doneBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (posted) {
    return (
      <View style={[styles.container, styles.centred, { paddingHorizontal: 40 }]}>
        <View style={styles.successIconCircle}>
          <Ionicons name="star" size={40} color={Colors.white} />
        </View>
        <Text style={styles.successTitle}>Review posted!</Text>
        <Text style={styles.successSub}>
          {isReviewingModel
            ? 'Your feedback helps keep our community great. Thank you!'
            : 'Your review helps other models discover great providers. Thank you!'}
        </Text>
        <TouchableOpacity style={styles.doneBtn} onPress={goBack} activeOpacity={0.9}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────

  const catColor     = categoryColor(treatmentCat)
  const revieweeInit = revieweeName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
  const canPost      = overallRating > 0
  const TAGS         = isReviewingModel ? MODEL_TAGS : PROVIDER_TAGS
  const SUB_RATINGS  = isReviewingModel ? MODEL_SUB_RATINGS : PROVIDER_SUB_RATINGS

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.rose} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          {isReviewingModel ? 'Review model' : 'Leave a review'}
        </Text>
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
            <View style={[styles.recapStrip, { backgroundColor: isReviewingModel ? Colors.rose : catColor }]} />
            <View style={styles.recapBody}>
              {revieweePicUrl ? (
                <Image source={{ uri: revieweePicUrl }} style={styles.recapAvatar} />
              ) : (
                <View style={styles.recapAvatarPlaceholder}>
                  <Text style={styles.recapAvatarInitials}>{revieweeInit}</Text>
                </View>
              )}
              <View style={styles.recapInfo}>
                <Text style={styles.recapName}>{revieweeName || (isReviewingModel ? 'Model' : 'Provider')}</Text>
                {!isReviewingModel && treatmentName && (
                  <View style={[styles.treatPill, { backgroundColor: catColor + '22' }]}>
                    <View style={[styles.treatDot, { backgroundColor: catColor }]} />
                    <Text style={[styles.treatPillText, { color: catColor }]}>{treatmentName}</Text>
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
            <Text style={[styles.ratingLabel, overallRating > 0 && { color: Colors.warmDark, fontWeight: '700' }]}>
              {RATING_LABELS[overallRating]}
            </Text>
          </View>

          {/* ── Sub-ratings ── */}
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
                    rating={subRatings[key as SubRatingKey] ?? 0}
                    size={22}
                    onRate={setSubRating(key as SubRatingKey)}
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
                    <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>{tag}</Text>
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
              placeholder={isReviewingModel
                ? 'What was it like working with them? Any tips for other stylists?'
                : 'What made this treatment memorable? Any tips for other models?'}
              placeholderTextColor={Colors.muted}
              textAlignVertical="top"
            />
            <Text style={styles.commentCounter}>{comment.length}/{COMMENT_MAX}</Text>
          </View>
        </ScrollView>

        {/* ── Bottom bar ── */}
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
  container: { flex: 1, backgroundColor: 'transparent' },
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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 17, fontWeight: '800',
    color: Colors.warmDark, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  recapCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, marginBottom: 14,
    overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft,
  },
  recapStrip: { height: 6 },
  recapBody: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  recapAvatar: { width: 56, height: 56, borderRadius: Radius.md, flexShrink: 0 },
  recapAvatarPlaceholder: {
    width: 56, height: 56, borderRadius: Radius.md,
    backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  recapAvatarInitials: { fontSize: 20, fontWeight: '700', color: Colors.rose },
  recapInfo: { flex: 1, gap: 6 },
  recapName: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.warmDark, letterSpacing: -0.3 },
  treatPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  treatDot: { width: 6, height: 6, borderRadius: 3 },
  treatPillText: { fontSize: 12, fontWeight: '700' },
  recapDate: { fontSize: 12, color: Colors.muted, fontWeight: '500' },

  sectionCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft,
  },
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.warmDark, letterSpacing: -0.3, marginBottom: 4 },
  sectionSub:   { fontSize: 12, color: Colors.muted, marginBottom: 14 },

  starsLarge: { alignItems: 'center', marginVertical: 16 },
  ratingLabel: { textAlign: 'center', fontSize: 14, color: Colors.muted, fontWeight: '500', marginTop: 4 },

  subRatingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  subRatingLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subRatingLabel: { fontSize: 14, fontWeight: '600', color: Colors.warmDark },

  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: Radius.pill, borderWidth: 1.5,
    borderColor: Colors.softPink, backgroundColor: Colors.inputBg,
  },
  tagChipSelected: { backgroundColor: Colors.rose, borderColor: Colors.rose },
  tagChipText:     { fontSize: 13, fontWeight: '600', color: Colors.rose },
  tagChipTextSelected: { color: Colors.white },

  commentInput: {
    backgroundColor: Colors.inputBg, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, padding: 14, fontSize: 14,
    color: Colors.warmDark, minHeight: 100, lineHeight: 20,
  },
  commentCounter: { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 6 },

  bottomBar: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.cream, gap: 8,
  },
  rateHint: { textAlign: 'center', fontSize: 12, color: Colors.muted, fontWeight: '500' },
  postBtn: {
    height: 54, backgroundColor: Colors.rose, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...Shadow.card,
  },
  postBtnDisabled: { backgroundColor: Colors.muted, shadowOpacity: 0, elevation: 0 },
  postBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.white, letterSpacing: -0.2 },

  successIconCircle: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },
  successTitle: { fontFamily: Fonts.display, fontSize: 32, color: Colors.rose, letterSpacing: -0.5, textAlign: 'center' },
  successSub:   { fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  doneBtn: {
    marginTop: 8, height: 54, width: 180, backgroundColor: Colors.rose,
    borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },
  doneBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.white },
})
