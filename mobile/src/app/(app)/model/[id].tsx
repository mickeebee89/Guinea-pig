import { useState, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  Linking,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { isModelVerified } from '@/lib/verification'
import ScreenDecor from '@/components/ScreenDecor'

// ── Constants ─────────────────────────────────────────────────────────────────

const THUMB_SIZE = 100
const SCREEN_W   = Dimensions.get('window').width

// ── Types ─────────────────────────────────────────────────────────────────────

type ModelProfile = {
  first_name: string
  last_initial: string | null
  profile_pic_url: string | null
  instagram_handle: string | null
}

type ModelAttrs = {
  hair_colour: string | null
  hair_type: string | null
  hair_length: string | null
  hair_condition: string | null
  skin_tone: string | null
  skin_type: string | null
  eye_colour: string | null
  eye_shape: string | null
  nail_condition: string | null
  bio: string | null
}

type Category = {
  id: string
  name: string
  sort_order: number
}

type GalleryPhoto = {
  id: string
  photo_url: string
  caption: string | null
  category_id: string | null
}

// ── Helpers ── (local grouping, mirrors model-profile) ────────────────────────

function groupByCategory(
  photos: GalleryPhoto[],
  cats: Category[],
): { label: string; catId: string | null; items: GalleryPhoto[] }[] {
  const groups: { label: string; catId: string | null; items: GalleryPhoto[] }[] = []
  for (const cat of cats) {
    const items = photos.filter(p => p.category_id === cat.id)
    if (items.length > 0) groups.push({ label: cat.name, catId: cat.id, items })
  }
  const uncat = photos.filter(p => !p.category_id)
  if (uncat.length > 0) groups.push({ label: 'Uncategorised', catId: null, items: uncat })
  return groups
}

type ModelReview = {
  id: string
  rating: number
  comment: string | null
  tags: string[]
  created_at: string
  reviewer_id: string
  reviewer_name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type AttrGroup = {
  group: string
  color: string
  bg: string
  items: { key: keyof ModelAttrs; label: string }[]
}

const ATTR_GROUPS: AttrGroup[] = [
  {
    group: 'Hair',
    color: Colors.roseDark,
    bg: Colors.softPink + '40',
    items: [
      { key: 'hair_colour',    label: 'Colour'    },
      { key: 'hair_type',      label: 'Type'      },
      { key: 'hair_length',    label: 'Length'    },
      { key: 'hair_condition', label: 'Condition' },
    ],
  },
  {
    group: 'Skin',
    color: '#B5603A',
    bg: '#E8845E18',
    items: [
      { key: 'skin_tone', label: 'Tone' },
      { key: 'skin_type', label: 'Type' },
    ],
  },
  {
    group: 'Eyes',
    color: '#1D9E75',
    bg: '#ECFDF580',
    items: [
      { key: 'eye_colour', label: 'Colour' },
      { key: 'eye_shape',  label: 'Shape'  },
    ],
  },
  {
    group: 'Nails',
    color: CategoryColors.nails,
    bg: CategoryColors.nails + '18',
    items: [
      { key: 'nail_condition', label: 'Condition' },
    ],
  },
]

function StarRow({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star-outline'}
          size={13}
          color="#F59E0B"
        />
      ))}
    </View>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ModelProfileViewScreen() {
  const router   = useRouter()
  const insets   = useSafeAreaInsets()
  const { id: modelId } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const viewerUserId = session?.user?.id

  const [profile,          setProfile]          = useState<ModelProfile | null>(null)
  const [attrs,            setAttrs]            = useState<ModelAttrs | null>(null)
  const [photos,           setPhotos]           = useState<GalleryPhoto[]>([])
  const [categories,       setCategories]       = useState<Category[]>([])
  const [enlarged,         setEnlarged]         = useState<GalleryPhoto | null>(null)
  const [reviews,          setReviews]          = useState<ModelReview[]>([])
  const [canReview,        setCanReview]        = useState(false)
  const [hasReviewed,      setHasReviewed]      = useState(false)
  const [loading,          setLoading]          = useState(true)
  const [isVerified,       setIsVerified]       = useState(false)
  const [inviting,         setInviting]         = useState(false)

  useEffect(() => {
    if (!modelId) return
    ;(async () => {
      const [
        { data: userData,  error: userErr  },
        { data: attrData,  error: attrErr  },
        { data: photoData, error: photoErr },
        { data: catData,   error: catErr   },
      ] = await Promise.all([
        supabase
          .from('users')
          .select('first_name, last_initial, profile_pic_url, instagram_handle')
          .eq('id', modelId)
          .single(),
        supabase
          .from('model_attributes')
          .select('hair_colour, hair_type, hair_length, hair_condition, skin_tone, skin_type, eye_colour, eye_shape, nail_condition, bio')
          .eq('user_id', modelId)
          .maybeSingle(),
        supabase
          .from('model_photos')
          .select('id, photo_url, caption, category_id')
          .eq('user_id', modelId)
          .order('created_at', { ascending: true }),
        supabase
          .from('model_photo_categories')
          .select('id, name, sort_order')
          .eq('user_id', modelId)
          .order('sort_order'),
      ])
      if (userErr)  console.warn('model/[id] users →',      userErr.message)
      if (attrErr)  console.warn('model/[id] attrs →',      attrErr.message)
      if (photoErr) console.warn('model/[id] photos →',     photoErr.message)
      if (catErr)   console.warn('model/[id] categories →', catErr.message)
      setProfile(userData as any)
      setAttrs(attrData as any)
      setCategories((catData ?? []) as Category[])
      setPhotos((photoData as any[] ?? []).map((p: any) => ({
        id:          p.id,
        photo_url:   p.photo_url,
        caption:     p.caption ?? null,
        category_id: p.category_id ?? null,
      })))
      try { setIsVerified(await isModelVerified(modelId)) } catch {}

      // Fetch reviews about this model
      try {
        const { data: revData, error: revErr } = await supabase
          .from('reviews')
          .select('id, rating:overall_rating, comment, tags, created_at, reviewer_id')
          .eq('reviewee_id', modelId)
          .order('created_at', { ascending: false })

        if (revData) {
          // Fetch reviewer names
          const reviewerIds = [...new Set((revData as any[]).map((r: any) => r.reviewer_id))]
          const { data: reviewerUsers } = reviewerIds.length > 0
            ? await supabase.from('users').select('id, first_name, last_initial').in('id', reviewerIds)
            : { data: [] as any[] }
          const userMap: Record<string, string> = {}
          ;(reviewerUsers as any[] ?? []).forEach((u: any) => {
            userMap[u.id] = `${u.first_name ?? ''}${u.last_initial ? ' ' + u.last_initial + '.' : ''}`.trim() || 'Stylist'
          })
          setReviews((revData as any[]).map((r: any) => ({
            id:            r.id,
            rating:        r.rating,
            comment:       r.comment ?? null,
            tags:          Array.isArray(r.tags) ? r.tags : [],
            created_at:    r.created_at,
            reviewer_id:   r.reviewer_id,
            reviewer_name: userMap[r.reviewer_id] ?? 'Stylist',
          })))
        }
      } catch {}

      // Check if current viewer (stylist) can review this model
      if (viewerUserId && viewerUserId !== modelId) {
        try {
          const { data: provRow } = await supabase
            .from('providers')
            .select('id')
            .eq('user_id', viewerUserId)
            .maybeSingle()
          const providerId = (provRow as any)?.id

          if (providerId) {
            const { data: completedSession } = await supabase
              .from('sessions')
              .select('id')
              .eq('provider_id', providerId)
              .eq('model_user_id', modelId)
              .eq('status', 'completed')
              .limit(1)
              .maybeSingle()

            if (completedSession) {
              setCanReview(true)
              // Check if already reviewed
              const sessionId = (completedSession as any).id
              const { data: existingReview } = await supabase
                .from('reviews')
                .select('id')
                .eq('session_id', sessionId)
                .eq('reviewer_id', viewerUserId)
                .maybeSingle()
              setHasReviewed(!!existingReview)
            }
          }
        } catch {}
      }

      setLoading(false)
    })()
  }, [modelId, viewerUserId])

  const handleInvite = async () => {
    if (!profile || !modelId || !viewerUserId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setInviting(true)
    const { data: provRow } = await supabase
      .from('providers')
      .select('id, name, shop_handle')
      .eq('user_id', viewerUserId)
      .single()
    const prov = provRow as any
    const { error } = await supabase.from('notifications').insert({
      user_id:    modelId,
      type:       'stylist_invite',
      title:      `${prov?.name ?? 'A stylist'} wants you as their model`,
      body:       'Tap to view their shop',
      session_id: null,
      data:       { provider_id: prov?.id ?? null, shop_handle: prov?.shop_handle ?? null },
    })
    if (error) {
      console.error('[handleInvite] insert error:', error.message)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Invite failed', error.message)
      setInviting(false)
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Invite sent!', `We'll let ${profile.first_name} know you're available.`)
    setInviting(false)
  }

  const handleLeaveReview = async () => {
    if (!modelId || !viewerUserId) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    // Find the completed session to pass to leave-review
    try {
      const { data: provRow } = await supabase
        .from('providers')
        .select('id')
        .eq('user_id', viewerUserId)
        .maybeSingle()
      const providerId = (provRow as any)?.id
      if (!providerId) return

      const { data: completedSession } = await supabase
        .from('sessions')
        .select('id')
        .eq('provider_id', providerId)
        .eq('model_user_id', modelId)
        .eq('status', 'completed')
        .limit(1)
        .maybeSingle()

      if (completedSession) {
        const router2 = router
        router2.push({
          pathname: '/(app)/leave-review' as any,
          params: {
            sessionId:    (completedSession as any).id,
            revieweeType: 'model',
            revieweeId:   modelId,
          },
        })
      }
    } catch {}
  }

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  if (!profile) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: Colors.muted, fontSize: 15 }}>Model not found</Text>
      </View>
    )
  }

  const displayName  = `${profile.first_name}${profile.last_initial ? ' ' + profile.last_initial + '.' : ''}`.trim()
  const initials     = displayName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  const photoGroups  = groupByCategory(photos, categories)

  return (
    <View style={styles.container}>
      <ScreenDecor />

      {/* Header */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Model Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Avatar + name */}
        <View style={styles.heroCard}>
          {profile.profile_pic_url ? (
            <Image source={{ uri: profile.profile_pic_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{displayName}</Text>
            {isVerified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={11} color={Colors.white} />
              </View>
            )}
          </View>
          {isVerified && (
            <Text style={styles.verifiedLabel}>Verified model</Text>
          )}
          {attrs?.bio ? (
            <Text style={styles.bioText}>{attrs.bio}</Text>
          ) : null}
          {profile.instagram_handle ? (
            <TouchableOpacity
              style={styles.igLink}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                Linking.openURL(`https://instagram.com/${profile.instagram_handle}`)
              }}
              activeOpacity={0.75}
            >
              <Ionicons name="logo-instagram" size={16} color="#C13584" />
              <Text style={styles.igLinkText}>@{profile.instagram_handle}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Attributes — chips grouped by category */}
        {ATTR_GROUPS.map(group => {
          const filled = group.items.filter(a => attrs?.[a.key])
          if (filled.length === 0) return null
          return (
            <View key={group.group} style={{ marginBottom: 12 }}>
              <Text style={styles.sectionTitle}>{group.group}</Text>
              <View style={styles.chipsRow}>
                {filled.map(a => (
                  <View key={a.key} style={[styles.attrChip, { backgroundColor: group.bg }]}>
                    <Text style={styles.attrChipLabel}>{a.label}</Text>
                    <Text style={[styles.attrChipValue, { color: group.color }]}>{attrs![a.key]}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        })}

        {/* Gallery — grouped by category, horizontal scroll per group */}
        {photoGroups.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Gallery</Text>
            {photoGroups.map(group => (
              <View key={group.catId ?? '__uncat__'} style={styles.galleryCatSection}>
                <Text style={styles.galleryCatLabel}>{group.label}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {group.items.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.galleryThumb}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setEnlarged(p)
                      }}
                      activeOpacity={0.88}
                    >
                      <Image source={{ uri: p.photo_url }} style={styles.galleryThumbImg} resizeMode="cover" />
                      {p.caption ? (
                        <View style={styles.galleryCapBadge}>
                          <Text style={styles.galleryCapBadgeText} numberOfLines={1}>{p.caption}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>
        )}

        {/* Reviews */}
        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>
              Reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}
            </Text>
            {reviews.length > 0 && (() => {
              const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
              return (
                <View style={styles.avgRatingWrap}>
                  <Ionicons name="star" size={14} color="#F59E0B" />
                  <Text style={styles.avgRatingText}>{avg.toFixed(1)}</Text>
                </View>
              )
            })()}
          </View>
          {reviews.length === 0 ? (
            <Text style={styles.emptyReviews}>No reviews yet.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewerAvatarPlaceholder}>
                    <Text style={styles.reviewerInitials}>
                      {r.reviewer_name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.reviewerName}>{r.reviewer_name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <StarRow rating={r.rating} />
                      <Text style={styles.reviewDate}>{formatDate(r.created_at)}</Text>
                    </View>
                  </View>
                </View>
                {r.comment ? (
                  <Text style={styles.reviewComment}>{r.comment}</Text>
                ) : null}
                {r.tags.length > 0 && (
                  <View style={styles.reviewTags}>
                    {r.tags.map(tag => (
                      <View key={tag} style={styles.reviewTag}>
                        <Text style={styles.reviewTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
        </View>

        {/* Actions */}
        {canReview && (
          <TouchableOpacity
            style={[styles.reviewBtn, hasReviewed && { opacity: 0.6, backgroundColor: '#1D9E75' }]}
            onPress={hasReviewed ? undefined : handleLeaveReview}
            disabled={hasReviewed}
            activeOpacity={0.88}
          >
            <Ionicons name={hasReviewed ? 'checkmark-circle' : 'star-outline'} size={18} color={Colors.white} />
            <Text style={styles.reviewBtnText}>
              {hasReviewed ? 'Review submitted ✓' : 'Leave a review'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.inviteBtn, inviting && { opacity: 0.6 }]}
          onPress={handleInvite}
          disabled={inviting}
          activeOpacity={0.88}
        >
          {inviting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <Ionicons name="paper-plane-outline" size={18} color={Colors.white} />
              <Text style={styles.inviteBtnText}>Send invite to {profile.first_name}</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Full-screen photo viewer ── */}
      <Modal
        visible={!!enlarged}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setEnlarged(null)}
      >
        <View style={styles.viewerBackdrop}>
          <TouchableOpacity
            style={styles.viewerClose}
            onPress={() => setEnlarged(null)}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {enlarged && (
            <>
              <Image
                source={{ uri: enlarged.photo_url }}
                style={styles.viewerImg}
                resizeMode="contain"
              />
              {enlarged.caption ? (
                <Text style={styles.viewerCaption}>{enlarged.caption}</Text>
              ) : null}
            </>
          )}
        </View>
      </Modal>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: { fontFamily: 'DancingScript_700Bold', fontSize: 25, color: Colors.warmDark, letterSpacing: -0.3 },

  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 4 },

  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 3, borderColor: Colors.softPink,
  },
  avatarPlaceholder: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 32, fontWeight: '700', color: Colors.roseDark },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  displayName: { fontFamily: 'DancingScript_700Bold', fontSize: 33, color: Colors.warmDark, letterSpacing: -0.5 },
  verifiedBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center',
  },
  verifiedLabel: { fontSize: 13, color: '#1D9E75', fontWeight: '600' },
  bioText: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  igLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
  },
  igLinkText: {
    fontSize: 14,
    color: '#C13584',
    fontWeight: '600',
  },

  sectionTitle: { fontFamily: 'DancingScript_700Bold', fontSize: 25, color: Colors.warmDark, letterSpacing: -0.3, marginBottom: 10 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attrChip: {
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  attrChipLabel: { fontSize: 10, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  attrChipValue: { fontSize: 14, fontWeight: '700' },

  galleryCatSection: { marginBottom: 16 },
  galleryCatLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  galleryThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.inputBg,
  },
  galleryThumbImg: { width: THUMB_SIZE, height: THUMB_SIZE },
  galleryCapBadge: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  galleryCapBadgeText: { fontSize: 9, color: '#fff', fontWeight: '500' },

  // Full-screen viewer
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  viewerImg: {
    width: SCREEN_W,
    height: SCREEN_W,
  },
  viewerCaption: {
    marginTop: 16,
    paddingHorizontal: 24,
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 20,
  },

  reviewsSection: { marginTop: 16 },
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  avgRatingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF9C3', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  avgRatingText: { fontSize: 14, fontWeight: '800', color: '#B45309' },

  emptyReviews: {
    fontSize: 14,
    color: Colors.muted,
    fontStyle: 'italic',
    paddingVertical: 16,
    textAlign: 'center',
  },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  reviewHeader: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'center' },
  reviewerAvatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center',
  },
  reviewerInitials: { fontSize: 13, fontWeight: '700', color: Colors.roseDark },
  reviewerName: { fontSize: 14, fontWeight: '600', color: Colors.warmDark },
  reviewDate: { fontSize: 11, color: Colors.muted },
  reviewComment: { fontSize: 14, color: Colors.warmDark, lineHeight: 20, opacity: 0.85 },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  reviewTag: {
    backgroundColor: Colors.softPink + '40',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewTagText: { fontSize: 12, fontWeight: '600', color: Colors.roseDark },

  reviewBtn: {
    marginTop: 8,
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.roseDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  reviewBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  inviteBtn: {
    marginTop: 16,
    height: 52, borderRadius: 16,
    backgroundColor: Colors.roseDark,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  inviteBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },
})
