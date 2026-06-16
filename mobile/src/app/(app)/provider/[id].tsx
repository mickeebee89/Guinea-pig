import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Animated,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

const BANNER_HEIGHT = 220

const CATEGORY_COLOR: Record<string, string> = {
  Nails:      '#C8788A',
  Lashes:     '#1D9E75',
  Brows:      '#BA7517',
  Hair:       '#7B5EA7',
  Makeup:     '#E8845E',
  'Spray Tan':'#C99A4E',
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = {
  id: string
  name: string
  location: string | null
  bio: string | null
  is_verified: boolean
  rating: number | null
  review_count: number | null
  profile_pic_url: string | null
  banner_url: string | null
  status_message: string | null
  status_expiry: string | null
  skill_level: string | null
  response_time: string | null
}

type Treatment = {
  id: string
  name: string
  category: string
  duration_mins: number | null
  materials_cost: number | null
}

type PortfolioItem = {
  id: string
  category: string
  media_url: string
  media_type: 'photo' | 'video'
}

type Review = {
  id: string
  rating: number
  comment: string | null
  tags: string[] | null
  created_at: string
  reviewer: { name: string | null; profile_pic_url: string | null } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatExpiry(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return 'Expired'
  const h = Math.floor(diffMs / 3_600_000)
  if (h < 1) return `Expires in ${Math.floor(diffMs / 60_000)}m`
  if (h < 24) return `Expires in ${h}h`
  return `Expires ${new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProviderShopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { session } = useAuth()
  const insets = useSafeAreaInsets()
  const userId = session?.user?.id

  const [provider,    setProvider]    = useState<Provider | null>(null)
  const [treatments,  setTreatments]  = useState<Treatment[]>([])
  const [portfolio,   setPortfolio]   = useState<PortfolioItem[]>([])
  const [reviews,     setReviews]     = useState<Review[]>([])
  const [isFavourite, setIsFavourite] = useState(false)
  const [refreshing,  setRefreshing]  = useState(false)
  const [loading,     setLoading]     = useState(true)

  const fetchAll = useCallback(async () => {
    if (!id) return
    try {
      const [{ data: provData }, { data: treatData }, { data: portData }, { data: revData }] =
        await Promise.all([
          supabase
            .from('providers')
            .select('id, name, location, bio, is_verified, rating, review_count, profile_pic_url, banner_url, status_message, status_expiry, skill_level, response_time')
            .eq('id', id)
            .single(),
          supabase
            .from('provider_treatments')
            .select('id, name, category, duration_mins, materials_cost')
            .eq('provider_id', id),
          supabase
            .from('provider_portfolio')
            .select('id, category, media_url, media_type')
            .eq('provider_id', id),
          supabase
            .from('reviews')
            .select('id, rating, comment, tags, created_at, reviewer:reviewer_id(name, profile_pic_url)')
            .eq('provider_id', id)
            .order('created_at', { ascending: false }),
        ])

      if (provData)  setProvider(provData as Provider)
      if (treatData) setTreatments(treatData as Treatment[])
      if (portData)  setPortfolio(portData as PortfolioItem[])
      if (revData) {
        // Supabase infers one-to-one FK joins as arrays; normalise to single object
        const normalised = (revData as any[]).map(r => ({
          ...r,
          reviewer: Array.isArray(r.reviewer) ? (r.reviewer[0] ?? null) : r.reviewer,
        }))
        setReviews(normalised as Review[])
      }
    } catch {}

    if (userId) {
      try {
        const { data } = await supabase
          .from('favourites')
          .select('id')
          .eq('user_id', userId)
          .eq('provider_id', id)
          .maybeSingle()
        setIsFavourite(!!data)
      } catch {}
    }

    setLoading(false)
  }, [id, userId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }, [fetchAll])

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const toggleFavourite = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!userId || !id) return
    if (isFavourite) {
      setIsFavourite(false)
      await supabase.from('favourites').delete().eq('user_id', userId).eq('provider_id', id)
    } else {
      setIsFavourite(true)
      await supabase.from('favourites').insert({ user_id: userId, provider_id: id })
    }
  }

  const handleApply = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push({
      pathname: '/(app)/apply-session' as any,
      params: { providerId: id, providerName: provider?.name ?? '' },
    })
  }

  const portfolioByCategory = portfolio.reduce<Record<string, PortfolioItem[]>>((acc, item) => {
    const cat = item.category || 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  if (!provider) {
    return (
      <View style={[styles.container, styles.centred]}>
        <TouchableOpacity
          style={[styles.backBtnFallback, { top: insets.top + 12 }]}
          onPress={goBack}
        >
          <Text style={styles.backBtnFallbackText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorEmoji}>🐹</Text>
        <Text style={styles.errorTitle}>Provider not found</Text>
        <Text style={styles.errorSub}>This profile may no longer be available.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.rose}
            colors={[Colors.rose]}
          />
        }
      >
        {/* ── Banner ── */}
        <View style={styles.bannerWrapper}>
          {provider.banner_url ? (
            <Image source={{ uri: provider.banner_url }} style={styles.bannerImage} resizeMode="cover" />
          ) : (
            <View style={styles.bannerPlaceholder} />
          )}
          <View style={[styles.bannerControls, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={styles.bannerIconBtn} onPress={goBack} activeOpacity={0.85}>
              <Ionicons name="chevron-back" size={20} color={Colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bannerIconBtn} onPress={toggleFavourite} activeOpacity={0.85}>
              <Ionicons
                name={isFavourite ? 'heart' : 'heart-outline'}
                size={20}
                color={isFavourite ? '#FF6B8A' : Colors.white}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Profile row ── */}
        <View style={styles.profileRow}>
          <View style={styles.avatarWrapper}>
            {provider.profile_pic_url ? (
              <Image source={{ uri: provider.profile_pic_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{provider.name[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
            {provider.is_verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={10} color={Colors.white} />
              </View>
            )}
          </View>

          <View style={styles.profileMeta}>
            <View style={styles.nameRow}>
              <Text style={styles.providerName} numberOfLines={1}>{provider.name}</Text>
              {provider.is_verified && (
                <Ionicons name="checkmark-circle" size={16} color="#1D9E75" style={styles.verifiedIcon} />
              )}
            </View>
            {provider.location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={13} color={Colors.muted} />
                <Text style={styles.locationText}> {provider.location}</Text>
              </View>
            ) : null}
            {provider.rating != null && (
              <View style={styles.ratingRow}>
                <StarRating rating={provider.rating} size={13} />
                <Text style={styles.ratingNum}> {provider.rating.toFixed(1)}</Text>
                {provider.review_count != null && (
                  <Text style={styles.reviewCount}> ({provider.review_count})</Text>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={styles.body}>
          {/* ── Status bar ── */}
          {provider.status_message ? (
            <View style={styles.statusBar}>
              <PulsingDot />
              <Text style={styles.statusText} numberOfLines={2}>{provider.status_message}</Text>
              {provider.status_expiry ? (
                <Text style={styles.statusExpiry}>{formatExpiry(provider.status_expiry)}</Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Badges ── */}
          {(provider.skill_level || provider.is_verified || provider.response_time) ? (
            <View style={styles.badgesRow}>
              {provider.skill_level ? (
                <BadgeChip icon="ribbon-outline" label={provider.skill_level} color={Colors.roseDark} />
              ) : null}
              {provider.is_verified ? (
                <BadgeChip icon="shield-checkmark-outline" label="Verified" color="#1D9E75" />
              ) : null}
              {provider.response_time ? (
                <BadgeChip icon="time-outline" label={provider.response_time} color="#7B5EA7" />
              ) : null}
            </View>
          ) : null}

          {/* ── Bio ── */}
          {provider.bio ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bioText}>{provider.bio}</Text>
            </View>
          ) : null}

          {/* ── Treatments ── */}
          {treatments.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Treatments</Text>
              {treatments.map(t => (
                <TreatmentRow key={t.id} treatment={t} />
              ))}
            </View>
          ) : null}

          {/* ── Portfolio ── */}
          {portfolio.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Portfolio</Text>
              {Object.entries(portfolioByCategory).map(([cat, items]) => (
                <View key={cat} style={styles.portfolioCatBlock}>
                  <Text style={[styles.portfolioCatLabel, { color: CATEGORY_COLOR[cat] ?? Colors.muted }]}>
                    {cat}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.portfolioRow}
                  >
                    {items.map(item => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.portfolioThumb}
                        onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                        activeOpacity={0.85}
                      >
                        <Image source={{ uri: item.media_url }} style={styles.portfolioImg} resizeMode="cover" />
                        {item.media_type === 'video' ? (
                          <View style={styles.playOverlay}>
                            <Ionicons name="play-circle" size={32} color="rgba(255,255,255,0.9)" />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Reviews ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {'Reviews'}
              {provider.review_count != null ? ` (${provider.review_count})` : ''}
            </Text>
            {reviews.length === 0 ? (
              <Text style={styles.emptyReviews}>No reviews yet — be the first!</Text>
            ) : (
              reviews.map(r => <ReviewCard key={r.id} review={r} />)
            )}
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky apply bar ── */}
      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.9}>
          <Ionicons name="calendar-outline" size={18} color={Colors.white} />
          <Text style={styles.applyBtnText}>Apply for session</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PulsingDot() {
  const anim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [anim])

  return <Animated.View style={[styles.pulsingDot, { opacity: anim }]} />
}

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star-outline'}
          size={size}
          color="#F59E0B"
        />
      ))}
    </View>
  )
}

function BadgeChip({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '18' }]}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  )
}

function TreatmentRow({ treatment }: { treatment: Treatment }) {
  const color = CATEGORY_COLOR[treatment.category] ?? Colors.muted
  return (
    <View style={styles.treatmentRow}>
      <View style={[styles.treatmentStripe, { backgroundColor: color }]} />
      <View style={styles.treatmentInfo}>
        <Text style={styles.treatmentName}>{treatment.name}</Text>
        <View style={styles.treatmentMeta}>
          {treatment.duration_mins != null ? (
            <View style={styles.treatmentMetaItem}>
              <Ionicons name="time-outline" size={12} color={Colors.muted} />
              <Text style={styles.treatmentMetaText}> {treatment.duration_mins} min</Text>
            </View>
          ) : null}
          {treatment.materials_cost != null && treatment.materials_cost > 0 ? (
            <Text style={styles.treatmentCost}>Materials: £{treatment.materials_cost.toFixed(2)}</Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.treatmentCatPill, { backgroundColor: color + '22' }]}>
        <Text style={[styles.treatmentCatText, { color }]}>{treatment.category}</Text>
      </View>
    </View>
  )
}

function ReviewCard({ review }: { review: Review }) {
  const name = review.reviewer?.name ?? 'Anonymous'
  const initials = name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        {review.reviewer?.profile_pic_url ? (
          <Image source={{ uri: review.reviewer.profile_pic_url }} style={styles.reviewerAvatar} />
        ) : (
          <View style={styles.reviewerAvatarPlaceholder}>
            <Text style={styles.reviewerInitials}>{initials}</Text>
          </View>
        )}
        <View style={styles.reviewerMeta}>
          <Text style={styles.reviewerName}>{name}</Text>
          <View style={styles.reviewRatingRow}>
            <StarRating rating={review.rating} size={12} />
            <Text style={styles.reviewDate}> · {formatDate(review.created_at)}</Text>
          </View>
        </View>
      </View>
      {review.tags && review.tags.length > 0 ? (
        <View style={styles.reviewTags}>
          {review.tags.map(tag => (
            <View key={tag} style={styles.reviewTag}>
              <Text style={styles.reviewTagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {review.comment ? (
        <Text style={styles.reviewComment}>{review.comment}</Text>
      ) : null}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  centred:   { alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 15, color: Colors.muted },

  backBtnFallback: { position: 'absolute', left: 20 },
  backBtnFallbackText: { fontSize: 17, color: Colors.roseDark, fontWeight: '500' },
  errorEmoji: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.warmDark, marginBottom: 6 },
  errorSub:   { fontSize: 14, color: Colors.muted },

  // Banner
  bannerWrapper: {
    height: BANNER_HEIGHT,
  },
  bannerImage: {
    width: '100%',
    height: BANNER_HEIGHT,
  },
  bannerPlaceholder: {
    width: '100%',
    height: BANNER_HEIGHT,
    backgroundColor: Colors.roseDark,
  },
  bannerControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  bannerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Profile row
  profileRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 16,
    alignItems: 'flex-end',
    marginTop: -44,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: Colors.cream,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.cream,
  },
  avatarInitial: {
    fontSize: 30,
    fontWeight: '700',
    color: Colors.roseDark,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.cream,
  },
  profileMeta: {
    flex: 1,
    paddingBottom: 6,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  verifiedIcon: { marginLeft: 4 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: { fontSize: 13, color: Colors.muted },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingNum: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  reviewCount: { fontSize: 12, color: Colors.muted },

  body: { paddingHorizontal: 20 },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F59E0B22',
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F59E0B',
    flexShrink: 0,
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    color: '#92400E',
    lineHeight: 19,
  },
  statusExpiry: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
    flexShrink: 0,
  },

  // Badges
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Section
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.3,
    marginBottom: 12,
  },

  // Bio
  bioText: {
    fontSize: 15,
    color: Colors.warmDark,
    lineHeight: 23,
    opacity: 0.85,
  },

  // Treatments
  treatmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  treatmentStripe: {
    width: 4,
    alignSelf: 'stretch',
  },
  treatmentInfo: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  treatmentName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  treatmentMeta: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  treatmentMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  treatmentMetaText: { fontSize: 12, color: Colors.muted },
  treatmentCost:     { fontSize: 12, color: Colors.muted },
  treatmentCatPill: {
    marginRight: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  treatmentCatText: { fontSize: 11, fontWeight: '600' },

  // Portfolio
  portfolioCatBlock: { marginBottom: 16 },
  portfolioCatLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  portfolioRow: { gap: 10 },
  portfolioThumb: {
    width: 110,
    height: 110,
    borderRadius: 14,
    overflow: 'hidden',
  },
  portfolioImg: { width: 110, height: 110 },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },

  // Reviews
  emptyReviews: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  reviewCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  reviewerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  reviewerAvatarPlaceholder: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewerInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.roseDark,
  },
  reviewerMeta: { gap: 3 },
  reviewerName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  reviewRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewDate: { fontSize: 11, color: Colors.muted },
  reviewTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  reviewTag: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reviewTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.muted,
  },
  reviewComment: {
    fontSize: 14,
    color: Colors.warmDark,
    lineHeight: 20,
    opacity: 0.85,
  },

  // Stars
  stars: { flexDirection: 'row', gap: 2 },

  // Sticky bar
  stickyBar: {
    backgroundColor: Colors.cream,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  applyBtn: {
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  applyBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
})
