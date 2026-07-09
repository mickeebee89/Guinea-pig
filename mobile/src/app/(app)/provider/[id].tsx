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
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { getBlockedIds } from '@/lib/blocks'
import AvailabilityCalendar from '@/components/AvailabilityCalendar'

const BANNER_HEIGHT = 165

const CATEGORY_COLOR: Record<string, string> = {
  Nails:      CategoryColors.nails,
  Lashes:     CategoryColors.lashes,
  Brows:      CategoryColors.brows,
  Hair:       CategoryColors.hair,
  Makeup:     CategoryColors.makeup,
  'Spray Tan':CategoryColors.sprayTan,
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
  status_text: string | null
  status_expires_at: string | null
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
  media_url: string
  media_type: 'photo' | 'video'
  category_name: string | null
  category_id: string | null
}

type Review = {
  id: string
  rating: number
  comment: string | null
  tags: string[] | null
  created_at: string
  reviewer_id: string
  reviewer_name: string
}

type AvailabilitySlot = {
  date: string
  start_time: string
  end_time: string
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

function formatTime12(t: string): string {
  const [h, min] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${min}${hour >= 12 ? 'pm' : 'am'}`
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Group portfolio items by category
function groupPortfolio(items: PortfolioItem[]): { label: string; items: PortfolioItem[] }[] {
  const grouped: Record<string, PortfolioItem[]> = {}
  const order: string[] = []
  for (const item of items) {
    const key = item.category_name ?? 'Other'
    if (!grouped[key]) { grouped[key] = []; order.push(key) }
    grouped[key].push(item)
  }
  return order.map(label => ({ label, items: grouped[label] }))
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ProviderShopScreen() {
  const { id, ownShop } = useLocalSearchParams<{ id: string; ownShop?: string }>()
  const router = useRouter()
  const { session } = useAuth()
  const insets = useSafeAreaInsets()
  const userId = session?.user?.id

  const [provider,      setProvider]      = useState<Provider | null>(null)
  const [treatments,    setTreatments]    = useState<Treatment[]>([])
  const [portfolio,     setPortfolio]     = useState<PortfolioItem[]>([])
  const [reviews,       setReviews]       = useState<Review[]>([])
  const [availability,  setAvailability]  = useState<AvailabilitySlot[]>([])
  const [hasOpenSlots,  setHasOpenSlots]  = useState(false)
  const [isBlocked,     setIsBlocked]     = useState(false)   // mutual block either direction
  const [isFavourite,   setIsFavourite]   = useState(false)
  const [refreshing,    setRefreshing]    = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [shopDate,      setShopDate]      = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!id) return
    try {
      const today = todayKey()
      const [
        { data: provData },
        { data: treatData },
        { data: portData },
        { data: avData },
        { data: openData },
      ] = await Promise.all([
        supabase
          .from('providers')
          .select('id, name, location, bio, is_verified, rating, review_count, profile_pic_url, banner_url, status_text, status_expires_at, user_id')
          .eq('id', id)
          .single(),
        supabase
          .from('provider_treatments')
          .select('id, name, category, duration_mins, materials_cost')
          .eq('provider_id', id),
        supabase
          .from('portfolio_items')
          .select('id, media_url, media_type, category_id, portfolio_categories(name)')
          .eq('provider_id', id),
        supabase
          .from('availability')
          .select('date, start_time, end_time')
          .eq('provider_id', id)
          .gte('date', today)
          .order('date')
          .order('start_time')
          .limit(30),
        // Authoritative bookable check: at least one future slot with no
        // pending/accepted session referencing it. The `availability` list above
        // still counts booked slots, so gate the Apply button on this instead.
        supabase.rpc('has_open_availability', { p_provider_id: id }),
      ])

      if (provData)  setProvider(provData as Provider)
      if (treatData) setTreatments(treatData as Treatment[])
      if (portData) {
        const normPort = (portData as any[]).map(item => ({
          id:            item.id,
          media_url:     item.media_url,
          media_type:    item.media_type,
          category_id:   item.category_id ?? null,
          category_name: item.portfolio_categories?.name ?? null,
        }))
        setPortfolio(normPort as PortfolioItem[])
      }
      if (avData) setAvailability(avData as AvailabilitySlot[])
      setHasOpenSlots(openData === true)

      // Fetch reviews using the provider's auth user_id as reviewee_id
      const providerUserId = (provData as any)?.user_id
      // Mutual block: if blocked either direction, Apply is disabled below.
      if (providerUserId && userId) {
        const blocked = await getBlockedIds(userId).catch(() => new Set<string>())
        setIsBlocked(blocked.has(providerUserId))
      }
      if (providerUserId) {
        try {
          const { data: revData, error: revErr } = await supabase
            .from('reviews')
            .select('id, rating:overall_rating, comment, tags, created_at, reviewer_id')
            .eq('reviewee_id', providerUserId)
            .order('created_at', { ascending: false })

          if (revData && (revData as any[]).length > 0) {
            const reviewerIds = [...new Set((revData as any[]).map((r: any) => r.reviewer_id))]
            const { data: reviewerUsers, error: reviewerErr } = await supabase
              .from('public_profiles')
              .select('id, first_name, last_initial')
              .in('id', reviewerIds)
            if (reviewerErr) console.warn('PROVIDER REVIEWS users lookup', reviewerErr)
            const userMap: Record<string, string> = {}
            ;(reviewerUsers as any[] ?? []).forEach((u: any) => {
              const name = `${u.first_name ?? ''}${u.last_initial ? ' ' + u.last_initial + '.' : ''}`.trim()
              userMap[u.id] = name || 'Anonymous'
            })
            setReviews((revData as any[]).map((r: any) => ({
              id:            r.id,
              rating:        r.rating,
              comment:       r.comment ?? null,
              tags:          Array.isArray(r.tags) ? r.tags : [],
              created_at:    r.created_at,
              reviewer_id:   r.reviewer_id,
              reviewer_name: userMap[r.reviewer_id] ?? 'Anonymous',
            })))
          }
        } catch {}
      }
    } catch (e) { console.error('provider load failed:', e) }

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
      params: { providerId: id, providerName: provider?.name ?? '', preDate: shopDate ?? '' },
    })
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  const shopIsEmpty = !provider?.bio && treatments.length === 0 && portfolio.length === 0
  if (!provider || (ownShop === '1' && shopIsEmpty)) {
    return (
      <View style={[styles.container, styles.centred]}>
        <TouchableOpacity
          style={[styles.backBtnFallback, { top: insets.top + 12 }]}
          onPress={goBack}
        >
          <Text style={styles.backBtnFallbackText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorEmoji}>🐹</Text>
        {ownShop === '1' ? (
          <>
            <Text style={styles.errorTitle}>Your shop isn't set up yet</Text>
            <Text style={styles.errorSub}>Add your bio, treatments and photos to get started</Text>
          </>
        ) : (
          <>
            <Text style={styles.errorTitle}>Stylist not found</Text>
            <Text style={styles.errorSub}>This profile may no longer be available.</Text>
          </>
        )}
      </View>
    )
  }

  const portfolioGroups = groupPortfolio(portfolio)
  const availDateSet = new Set(availability.map(s => s.date))

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rose} colors={[Colors.rose]} />
        }
      >
        {/* ── Banner ── */}
        <View style={styles.bannerWrapper}>
          {/* Guinea Pig branding — shown for every provider */}
          <View style={styles.bannerBrand}>
            <Image
              source={require('../../../../assets/images/guinea-pig-logo.png')}
              style={styles.bannerLogo}
              resizeMode="contain"
            />
            <Text style={styles.bannerBrandText}>Guinea Pig</Text>
          </View>
          <View style={[styles.bannerControls, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={styles.bannerIconBtn} onPress={goBack} activeOpacity={0.85}>
              <Ionicons name="chevron-back" size={20} color={Colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bannerIconBtn} onPress={toggleFavourite} activeOpacity={0.85}>
              <Ionicons
                name={isFavourite ? 'heart' : 'heart-outline'}
                size={20}
                color={isFavourite ? Colors.rose : Colors.white}
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
                <Ionicons name="checkmark-circle" size={16} color={Colors.rose} style={styles.verifiedIcon} />
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
          {provider.status_text ? (
            <View style={styles.statusBar}>
              <PulsingDot />
              <Text style={styles.statusText} numberOfLines={2}>{provider.status_text}</Text>
              {provider.status_expires_at ? (
                <Text style={styles.statusExpiry}>{formatExpiry(provider.status_expires_at)}</Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Badges ── */}
          {provider.is_verified ? (
            <View style={styles.badgesRow}>
              <BadgeChip icon="shield-checkmark-outline" label="Verified" color={Colors.rose} />
            </View>
          ) : null}

          {/* ── Bio ── */}
          {provider.bio ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bioText}>{provider.bio}</Text>
            </View>
          ) : null}

          {/* ── Availability ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Availability</Text>
            <AvailabilityCalendar
              availableDates={availDateSet}
              todayKey={todayKey()}
              selectedDate={shopDate}
              onSelectDate={setShopDate}
            />
          </View>

          {/* ── Treatments ── */}
          {treatments.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Treatments</Text>
              {treatments.map(t => (
                <TreatmentRow key={t.id} treatment={t} />
              ))}
            </View>
          ) : null}

          {/* ── Portfolio (grouped by category) ── */}
          {portfolioGroups.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Portfolio</Text>
              {portfolioGroups.map(group => (
                <View key={group.label} style={styles.portfolioCatBlock}>
                  <Text style={styles.portfolioCatLabel}>{group.label}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.portfolioRow}
                  >
                    {group.items.map(item => (
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
      {ownShop !== '1' && (
        <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {isBlocked ? (
            <>
              <View style={[styles.applyBtn, styles.applyBtnDisabled]}>
                <Ionicons name="ban-outline" size={18} color={Colors.muted} />
                <Text style={[styles.applyBtnText, { color: Colors.muted }]}>Apply for treatment</Text>
              </View>
              <Text style={styles.applyHint}>You can’t apply to this stylist</Text>
            </>
          ) : !hasOpenSlots ? (
            <>
              <View style={[styles.applyBtn, styles.applyBtnDisabled]}>
                <Ionicons name="calendar-outline" size={18} color={Colors.muted} />
                <Text style={[styles.applyBtnText, { color: Colors.muted }]}>Apply for treatment</Text>
              </View>
              <Text style={styles.applyHint}>No availability yet — check back soon</Text>
            </>
          ) : (
            <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.9}>
              <Ionicons name="calendar-outline" size={18} color={Colors.white} />
              <Text style={styles.applyBtnText}>Apply for treatment</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
  const name = review.reviewer_name
  const initials = name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewerAvatarPlaceholder}>
          <Text style={styles.reviewerInitials}>{initials}</Text>
        </View>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  centred:   { alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 15, color: Colors.muted },

  backBtnFallback: { position: 'absolute', left: 20 },
  backBtnFallbackText: { fontSize: 17, color: Colors.roseDark, fontWeight: '500' },
  errorEmoji: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.warmDark, marginBottom: 6 },
  errorSub:   { fontSize: 14, color: Colors.muted },

  bannerWrapper: { height: BANNER_HEIGHT },
  bannerBrand: {
    width: '100%',
    height: BANNER_HEIGHT,
    backgroundColor: Colors.softPink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  bannerLogo: { width: 104, height: 104 },
  bannerBrandText: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.rose,
    letterSpacing: -0.3,
  },
  bannerControls: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16,
  },
  bannerIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },

  profileRow: {
    flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 16,
    alignItems: 'flex-start',
  },
  avatarWrapper: { position: 'relative', marginRight: 14, marginTop: -44 },
  avatar: { width: 88, height: 88, borderRadius: Radius.lg, borderWidth: 3, borderColor: Colors.cream },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: Radius.lg,
    backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: Colors.cream,
  },
  avatarInitial: { fontSize: 30, fontWeight: '700', color: Colors.roseDark },
  verifiedBadge: {
    position: 'absolute', bottom: 2, right: 2,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.rose, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.cream,
  },
  profileMeta: { flex: 1, paddingBottom: 6, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  providerName: { fontFamily: Fonts.display, fontSize: 26, color: Colors.warmDark, letterSpacing: -0.4, flexShrink: 1 },
  verifiedIcon: { marginLeft: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center' },
  locationText: { fontSize: 13, color: Colors.muted },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingNum: { fontSize: 13, fontWeight: '700', color: Colors.warmDark },
  reviewCount: { fontSize: 12, color: Colors.muted },

  body: { paddingHorizontal: 20 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, gap: 10, marginBottom: 16,
    borderWidth: 1, borderColor: '#F59E0B22',
  },
  pulsingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F59E0B', flexShrink: 0 },
  statusText: { flex: 1, fontSize: 14, color: '#92400E', lineHeight: 19 },
  statusExpiry: { fontSize: 11, fontWeight: '600', color: '#D97706', flexShrink: 0 },

  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  badgeText: { fontSize: 13, fontWeight: '600' },

  section: { marginBottom: 24 },
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.warmDark, letterSpacing: -0.1, marginBottom: 12 },

  bioText: { fontSize: 15, color: Colors.warmDark, lineHeight: 23, opacity: 0.85 },

  // Treatments
  treatmentRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md, marginBottom: 8,
    overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft,
  },
  treatmentStripe: { width: 4, alignSelf: 'stretch' },
  treatmentInfo: { flex: 1, padding: 12, gap: 4 },
  treatmentName: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  treatmentMeta: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  treatmentMetaItem: { flexDirection: 'row', alignItems: 'center' },
  treatmentMetaText: { fontSize: 12, color: Colors.muted },
  treatmentCost: { fontSize: 12, color: Colors.muted },
  treatmentCatPill: { marginRight: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  treatmentCatText: { fontSize: 11, fontWeight: '600' },

  // Portfolio
  portfolioCatBlock: { marginBottom: 16 },
  portfolioCatLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  portfolioRow: { gap: 10 },
  portfolioThumb: { width: 110, height: 110, borderRadius: Radius.md, overflow: 'hidden' },
  portfolioImg: { width: 110, height: 110 },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },

  // Reviews
  emptyReviews: { fontSize: 14, color: Colors.muted, textAlign: 'center', paddingVertical: 20 },
  reviewCard: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft,
  },
  reviewHeader: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  reviewerAvatar: { width: 38, height: 38, borderRadius: 19 },
  reviewerAvatarPlaceholder: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center',
  },
  reviewerInitials: { fontSize: 13, fontWeight: '700', color: Colors.roseDark },
  reviewerMeta: { gap: 3 },
  reviewerName: { fontSize: 14, fontWeight: '600', color: Colors.warmDark },
  reviewRatingRow: { flexDirection: 'row', alignItems: 'center' },
  reviewDate: { fontSize: 11, color: Colors.muted },
  reviewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  reviewTag: { backgroundColor: Colors.inputBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  reviewTagText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  reviewComment: { fontSize: 14, color: Colors.warmDark, lineHeight: 20, opacity: 0.85 },

  stars: { flexDirection: 'row', gap: 2 },

  stickyBar: {
    backgroundColor: Colors.cream, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 8,
  },
  applyBtn: {
    backgroundColor: Colors.rose, borderRadius: Radius.lg, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...Shadow.card,
  },
  applyBtnText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 16, letterSpacing: -0.2 },
  applyBtnDisabled: { backgroundColor: Colors.inputBg, shadowOpacity: 0, elevation: 0 },
  applyHint: { fontSize: 12, color: Colors.muted, textAlign: 'center', marginTop: 8, fontWeight: '500' },
})
