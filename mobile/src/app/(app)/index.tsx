import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
  Platform,
  ActivityIndicator,
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { Colors, CategoryColors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { isIdentityVerified } from '@/lib/verification'
import ScreenDecor from '@/components/ScreenDecor'
import HeaderIcons from '@/components/HeaderIcons'
import { useAppRole } from '@/components/AppEntry'
import LoadErrorState from '@/components/LoadErrorState'
import ProviderDashboardScreen from './provider-dashboard'

const CATEGORIES = [
  { name: 'All',       color: Colors.muted   },
  { name: 'Nails',     color: CategoryColors.nails },
  { name: 'Lashes',    color: '#1D9E75'      },
  { name: 'Brows',     color: '#BA7517'      },
  { name: 'Hair',      color: '#7B5EA7'      },
  { name: 'Makeup',    color: '#E8845E'      },
  { name: 'Spray Tan', color: '#C99A4E'      },
] as const

const DISTANCE_OPTIONS = ['Any', '1 mi', '2 mi', '4 mi', '10 mi', '20 mi'] as const
type DistanceOption = typeof DISTANCE_OPTIONS[number]

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(d: number): string {
  if (d < 0.1) return 'nearby'
  if (d < 10) return `${d.toFixed(1)} mi`
  return `${Math.round(d)} mi`
}

const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(
  CATEGORIES.filter(c => c.name !== 'All').map(c => [c.name, c.color])
)

type ProviderTreatment = { category: string }

type Provider = {
  id: string
  name: string
  location: string | null
  is_verified: boolean
  rating: number | null
  profile_pic_url: string | null
  provider_treatments: ProviderTreatment[]
  latitude: number | null
  longitude: number | null
  distance: number | null
}

type UpcomingSession = {
  id: string
  provider_id: string
  provider_name: string
  provider_pic: string | null
  date: string
  start_time: string
  treatment_name: string | null
  treatment_category: string | null
  location_type: string | null
}

type PendingApp = {
  id: string
  provider_id: string
  provider_name: string
  provider_pic: string | null
  date: string
  start_time: string
  treatment_name: string | null
  treatment_category: string | null
}

type Invite = {
  id: string
  title: string
  body: string
  data: { provider_id?: string; shop_handle?: string }
  created_at: string
}

type SubscriptionInfo = { status: string; periodEnd: string | null }
type ImpactInfo      = { completed: number; distinctProviders: number }

function formatSessDate(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const [h, min] = timeStr.split(':').map(Number)
  return `${label} · ${h % 12 || 12}:${String(min).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
}

function formatPeriodEnd(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Role is fetched once in RoleRouter (components/RoleRouter.tsx) and provided
// via context. This screen reads it and renders the appropriate content directly
// — no navigation calls, no Redirect.
export default function AppHome() {
  const role = useAppRole()
  if (role === 'provider') return <ProviderDashboardScreen />
  return <ModelHomeContent />
}

function ModelHomeContent() {
  const router = useRouter()
  const { session } = useAuth()
  const userId = session?.user?.id

  const [providers, setProviders]               = useState<Provider[]>([])
  const [favouriteIds, setFavouriteIds]         = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [search, setSearch]                     = useState('')
  const [distanceFilter, setDistanceFilter]     = useState<DistanceOption>('Any')
  const [verifiedOnly, setVerifiedOnly]         = useState(false)
  const [showFilters, setShowFilters]           = useState(false)
  const [userLat, setUserLat]                   = useState<number | null>(null)
  const [userLng, setUserLng]                   = useState<number | null>(null)
  const [refreshing, setRefreshing]             = useState(false)
  const [loading, setLoading]                   = useState(true)
  const [loadError, setLoadError]               = useState(false)
  const [profilePicUrl, setProfilePicUrl]       = useState<string | null>(null)
  const [upcomingSessions, setUpcomingSessions] = useState<UpcomingSession[]>([])
  const [pendingApps,      setPendingApps]      = useState<PendingApp[]>([])
  const [invites,          setInvites]          = useState<Invite[]>([])
  const [subscription,     setSubscription]     = useState<SubscriptionInfo | null>(null)
  const [isVerified,       setIsVerified]       = useState(false)
  const [impact,           setImpact]           = useState<ImpactInfo | null>(null)

  const fetchData = useCallback(async () => {
    if (!userId) { setLoading(false); return }

    setLoadError(false)
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('profile_pic_url, latitude, longitude')
        .eq('id', userId)
        .single()

      setProfilePicUrl((userData as any)?.profile_pic_url ?? null)
      // Use stored GPS immediately so distance shows without waiting for device GPS
      if ((userData as any)?.latitude != null && (userData as any)?.longitude != null) {
        setUserLat((userData as any).latitude)
        setUserLng((userData as any).longitude)
      }

      // GPS — request and store in background, don't block provider load
      Location.requestForegroundPermissionsAsync().then(({ status }) => {
        if (status === 'granted') {
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(loc => {
            setUserLat(loc.coords.latitude)
            setUserLng(loc.coords.longitude)
            supabase.from('users').update({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            }).eq('id', userId).then(() => {})
          }).catch(() => {})
        }
      }).catch(() => {})

      const [{ data: provData }, { data: favData }] = await Promise.all([
        supabase
          .from('providers')
          .select('id, name, profile_pic_url, is_verified, rating, location_text, latitude, longitude, provider_treatments(category)')
          .eq('is_published', true),
        supabase
          .from('favourites')
          .select('provider_id')
          .eq('user_id', userId),
      ])

      if (provData) {
        setProviders((provData as any[]).map(p => ({
          id:                  p.id,
          name:                (p.name as string) || 'Stylist',
          location:            (p.location_text as string | null) || null,
          is_verified:         !!(p.is_verified),
          rating:              (p.rating as number | null) ?? null,
          profile_pic_url:     (p.profile_pic_url as string | null) ?? null,
          provider_treatments: Array.isArray(p.provider_treatments) ? p.provider_treatments : [],
          latitude:            (p.latitude as number | null) ?? null,
          longitude:           (p.longitude as number | null) ?? null,
          distance:            null,
        })))
      }
      if (favData) {
        setFavouriteIds(new Set((favData as { provider_id: string }[]).map(f => f.provider_id)))
      }

      // ── Dashboard data ────────────────────────────────────────────────────
      const todayStr = (() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()

      const [
        { data: upcomingRaw },
        { data: pendingRaw },
        { data: inviteRaw },
        { data: subRaw },
        { data: completedRaw },
        verifiedResult,
      ] = await Promise.all([
        supabase.from('sessions').select('id, provider_id, date, start_time, treatment_id, location_type').eq('model_user_id', userId).eq('status', 'accepted').gte('date', todayStr).order('date').order('start_time').limit(5),
        supabase.from('sessions').select('id, provider_id, date, start_time, treatment_id').eq('model_user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
        supabase.from('notifications').select('id, title, body, data, created_at').eq('user_id', userId).eq('type', 'stylist_invite').is('read_at', null).order('created_at', { ascending: false }).limit(10),
        supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle(),
        supabase.from('sessions').select('provider_id').eq('model_user_id', userId).eq('status', 'completed'),
        isIdentityVerified(userId).catch(() => false),
      ])

      const allProviderIds = [...new Set([...(upcomingRaw ?? []).map((s: any) => s.provider_id), ...(pendingRaw ?? []).map((s: any) => s.provider_id)])]
      const allTreatmentIds = [...new Set([...(upcomingRaw ?? []).map((s: any) => s.treatment_id), ...(pendingRaw ?? []).map((s: any) => s.treatment_id)].filter(Boolean) as string[])]

      const [{ data: sessProviders }, { data: sessTreats }] = await Promise.all([
        allProviderIds.length > 0 ? supabase.from('providers').select('id, name, profile_pic_url').in('id', allProviderIds) : Promise.resolve({ data: [] as any[] }),
        allTreatmentIds.length > 0 ? supabase.from('provider_treatments').select('id, name, category').in('id', allTreatmentIds) : Promise.resolve({ data: [] as any[] }),
      ])

      const provMap: Record<string, { name: string; pic: string | null }> = Object.fromEntries(
        (sessProviders ?? []).map((p: any) => [p.id, { name: p.name as string, pic: (p.profile_pic_url as string | null) ?? null }])
      )
      const treatMap: Record<string, { name: string; category: string }> = Object.fromEntries(
        (sessTreats ?? []).map((t: any) => [t.id, { name: t.name as string, category: t.category as string }])
      )

      setUpcomingSessions((upcomingRaw ?? []).map((s: any) => ({
        id:                 s.id,
        provider_id:        s.provider_id,
        provider_name:      provMap[s.provider_id]?.name ?? 'Stylist',
        provider_pic:       provMap[s.provider_id]?.pic ?? null,
        date:               s.date,
        start_time:         s.start_time,
        treatment_name:     s.treatment_id ? (treatMap[s.treatment_id]?.name ?? null) : null,
        treatment_category: s.treatment_id ? (treatMap[s.treatment_id]?.category ?? null) : null,
        location_type:      s.location_type ?? null,
      })))

      setPendingApps((pendingRaw ?? []).map((s: any) => ({
        id:                 s.id,
        provider_id:        s.provider_id,
        provider_name:      provMap[s.provider_id]?.name ?? 'Stylist',
        provider_pic:       provMap[s.provider_id]?.pic ?? null,
        date:               s.date,
        start_time:         s.start_time,
        treatment_name:     s.treatment_id ? (treatMap[s.treatment_id]?.name ?? null) : null,
        treatment_category: s.treatment_id ? (treatMap[s.treatment_id]?.category ?? null) : null,
      })))

      setInvites((inviteRaw ?? []).map((n: any) => ({
        id:         n.id,
        title:      n.title as string,
        body:       n.body as string,
        data:       (n.data ?? {}) as Invite['data'],
        created_at: n.created_at as string,
      })))

      const periodEnd = (subRaw as any)?.current_period_end ?? (subRaw as any)?.period_end ?? (subRaw as any)?.expires_at ?? null
      setSubscription(subRaw ? { status: (subRaw as any).status as string, periodEnd: periodEnd ? String(periodEnd) : null } : null)
      setIsVerified(verifiedResult as boolean)

      const completedList = completedRaw ?? []
      setImpact({
        completed:         completedList.length,
        distinctProviders: new Set(completedList.map((s: any) => s.provider_id as string)).size,
      })
    } catch (e) {
      console.error('index load failed:', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { fetchData() }, [fetchData])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  const toggleFavourite = async (providerId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const isFav = favouriteIds.has(providerId)
    if (isFav) {
      setFavouriteIds(prev => { const s = new Set(prev); s.delete(providerId); return s })
      await supabase.from('favourites').delete().eq('user_id', userId).eq('provider_id', providerId)
    } else {
      setFavouriteIds(prev => new Set([...prev, providerId]))
      await supabase.from('favourites').insert({ user_id: userId, provider_id: providerId })
    }
  }

  const openProvider = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/provider/[id]', params: { id } })
  }

  // Enrich providers with distance when we have GPS
  const providersWithDist = providers.map(p => ({
    ...p,
    distance: (userLat != null && userLng != null && p.latitude != null && p.longitude != null)
      ? haversine(userLat, userLng, p.latitude, p.longitude)
      : null,
  }))

  const hasActiveFilter = selectedCategory !== 'All' || distanceFilter !== 'Any' || verifiedOnly

  const distanceMiles = distanceFilter === 'Any' ? null : parseInt(distanceFilter)

  const filtered = providersWithDist
    .filter(p => {
      const matchesCategory =
        selectedCategory === 'All' ||
        p.provider_treatments.some(t => t.category === selectedCategory)
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.location ?? '').toLowerCase().includes(q)
      const matchesDistance =
        distanceMiles == null || p.distance == null || p.distance <= distanceMiles
      const matchesVerified = !verifiedOnly || p.is_verified
      return matchesCategory && matchesSearch && matchesDistance && matchesVerified
    })
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))

  // Fallback: if all filters produce no results, show all providers sorted by distance
  const displayProviders = filtered.length === 0 && providers.length > 0
    ? [...providersWithDist].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    : filtered

  const favouriteProviders = providersWithDist.filter(p => favouriteIds.has(p.id))

  return (
    <View style={styles.container}>
      <ScreenDecor />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.rose}
              colors={[Colors.rose]}
            />
          }
        >
          {/* ── Title ── */}
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>Dashboard</Text>
            <View style={styles.titleIcons}>
              <HeaderIcons />
              <TouchableOpacity
                style={styles.profileBtn}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  router.push('/(app)/model-profile' as any)
                }}
                activeOpacity={0.85}
              >
                {profilePicUrl ? (
                  <Image source={{ uri: profilePicUrl }} style={styles.profileBtnImg} />
                ) : (
                  <View style={styles.profileBtnPlaceholder}>
                    <Ionicons name="person" size={18} color={Colors.roseDark} />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Upcoming sessions ── */}
          {upcomingSessions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming treatments ({upcomingSessions.length})</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.upcomingScroll}
              >
                {upcomingSessions.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.upcomingCard}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId: s.id } })
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.upcomingHeader}>
                      <View style={styles.dashAvatarWrap}>
                        {s.provider_pic ? (
                          <Image source={{ uri: s.provider_pic }} style={styles.dashAvatar} />
                        ) : (
                          <View style={[styles.dashAvatarPlaceholder, { backgroundColor: Colors.softPink }]}>
                            <Text style={styles.dashAvatarInitial}>{s.provider_name[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dashTitle} numberOfLines={1}>{s.provider_name}</Text>
                        <Text style={styles.dashMeta} numberOfLines={1}>{formatSessDate(s.date, s.start_time)}</Text>
                      </View>
                    </View>
                    {s.treatment_name ? (
                      <Text style={[styles.dashTag, { color: CATEGORY_COLOR[s.treatment_category ?? ''] ?? Colors.roseDark }]}>
                        {s.treatment_name}
                      </Text>
                    ) : null}
                    <View style={[styles.dashStatusBadge, styles.upcomingStatus]}>
                      <Text style={styles.dashStatusText}>Confirmed</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* ── Needs your attention ── */}
          {(pendingApps.length > 0 || invites.length > 0) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Needs your attention</Text>

              {pendingApps.length > 0 && (
                <>
                  <Text style={styles.attentionLabel}>Pending applications</Text>
                  {pendingApps.map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.dashCard}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        router.push({ pathname: '/(app)/chat/[sessionId]' as any, params: { sessionId: s.id } })
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={styles.dashAvatarWrap}>
                        {s.provider_pic ? (
                          <Image source={{ uri: s.provider_pic }} style={styles.dashAvatar} />
                        ) : (
                          <View style={[styles.dashAvatarPlaceholder, { backgroundColor: Colors.softPink }]}>
                            <Text style={styles.dashAvatarInitial}>{s.provider_name[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.dashInfo}>
                        <Text style={styles.dashTitle}>{s.provider_name}</Text>
                        <Text style={styles.dashMeta}>{formatSessDate(s.date, s.start_time)}</Text>
                        {s.treatment_name ? (
                          <Text style={[styles.dashTag, { color: CATEGORY_COLOR[s.treatment_category ?? ''] ?? Colors.roseDark }]}>
                            {s.treatment_name}
                          </Text>
                        ) : null}
                      </View>
                      <View style={[styles.dashStatusBadge, styles.dashStatusPending]}>
                        <Text style={[styles.dashStatusText, styles.dashStatusTextPending]}>Awaiting reply</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {invites.length > 0 && (
                <>
                  <Text style={[styles.attentionLabel, pendingApps.length > 0 && { marginTop: 12 }]}>
                    Invites from stylists
                  </Text>
                  {invites.map(n => {
                    const provId = n.data?.provider_id
                    return (
                      <TouchableOpacity
                        key={n.id}
                        style={styles.dashCard}
                        onPress={async () => {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          if (provId) router.push({ pathname: '/(app)/provider/[id]' as any, params: { id: provId } })
                          else router.push('/(app)/notifications' as any)
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={[styles.dashAvatarWrap, { backgroundColor: Colors.roseDark + '18' }]}>
                          <Ionicons name="mail-outline" size={22} color={Colors.roseDark} />
                        </View>
                        <View style={styles.dashInfo}>
                          <Text style={styles.dashTitle}>{n.title}</Text>
                          <Text style={styles.dashMeta} numberOfLines={2}>{n.body}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                      </TouchableOpacity>
                    )
                  })}
                </>
              )}
            </View>
          )}

          {/* ── Favourites ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Favourites</Text>
            {favouriteProviders.length === 0 ? (
              <View style={styles.emptyFavs}>
                <Text style={styles.emptyFavsEmoji}>🤍</Text>
                <Text style={styles.emptyFavsText}>
                  Save models you love — tap the heart on any profile
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.favsRow}
              >
                {favouriteProviders.map(p => (
                  <FavouriteCard key={p.id} provider={p} onPress={() => openProvider(p.id)} />
                ))}
              </ScrollView>
            )}
          </View>

          {/* ── Search + filter (for Nearby stylists) ── */}
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color={Colors.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search stylists…"
                placeholderTextColor={Colors.muted}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.filterBtn, (showFilters || hasActiveFilter) && styles.filterBtnActive]}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setShowFilters(f => !f)
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="options-outline" size={15} color={(showFilters || hasActiveFilter) ? Colors.white : Colors.roseDark} />
              <Text style={[styles.filterBtnText, (showFilters || hasActiveFilter) && { color: Colors.white }]}>Filter</Text>
            </TouchableOpacity>
          </View>

          {/* ── Filter panel ── */}
          {showFilters && (
            <View style={styles.filterPanel}>
              <Text style={styles.filterPanelLabel}>Treatment</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
                {CATEGORIES.map(cat => {
                  const active = selectedCategory === cat.name
                  return (
                    <TouchableOpacity
                      key={cat.name}
                      style={[
                        styles.distChip,
                        active
                          ? { backgroundColor: cat.color, borderColor: cat.color }
                          : { borderColor: cat.color },
                      ]}
                      onPress={async () => {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                        setSelectedCategory(cat.name)
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.distChipText, active ? styles.distChipTextActive : { color: cat.color }]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
              <Text style={styles.filterPanelLabel}>Distance</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 2 }}>
                {DISTANCE_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.distChip, distanceFilter === opt && styles.distChipActive]}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setDistanceFilter(opt)
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.distChipText, distanceFilter === opt && styles.distChipTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.verifiedToggleRow}>
                <Text style={styles.verifiedToggleLabel}>Verified only</Text>
                <Switch
                  value={verifiedOnly}
                  onValueChange={async v => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setVerifiedOnly(v)
                  }}
                  trackColor={{ false: Colors.border, true: Colors.rose }}
                  thumbColor={verifiedOnly ? Colors.roseDark : Colors.muted}
                  ios_backgroundColor={Colors.border}
                />
              </View>
            </View>
          )}

          {/* ── Nearby stylists ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nearby stylists</Text>
            {loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Finding stylists near you…</Text>
              </View>
            ) : loadError ? (
              <LoadErrorState onRetry={() => fetchData()} fill={false} />
            ) : displayProviders.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🐹</Text>
                <Text style={styles.emptyStateTitle}>No stylists yet</Text>
                <Text style={styles.emptyStateText}>
                  We're growing! Check back soon — new stylists join every week.
                </Text>
              </View>
            ) : (
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={displayProviders}
                keyExtractor={p => p.id}
                contentContainerStyle={styles.nearbyRow}
                renderItem={({ item: p }) => (
                  <TouchableOpacity
                    style={styles.nearbyCard}
                    onPress={() => openProvider(p.id)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.nearbyAvatarWrap}>
                      {p.profile_pic_url ? (
                        <Image source={{ uri: p.profile_pic_url }} style={styles.nearbyAvatar} />
                      ) : (
                        <View style={styles.nearbyAvatarPlaceholder}>
                          <Text style={styles.nearbyAvatarInitial}>{p.name[0]?.toUpperCase() ?? '?'}</Text>
                        </View>
                      )}
                      {p.is_verified && (
                        <Ionicons name="checkmark-circle" size={14} color="#1D9E75" style={styles.nearbyVerified} />
                      )}
                    </View>
                    <Text style={styles.nearbyName} numberOfLines={1}>{p.name}</Text>
                    {p.distance != null && (
                      <View style={styles.nearbyDistRow}>
                        <Ionicons name="location" size={10} color={Colors.roseDark} />
                        <Text style={styles.nearbyDist}>{formatDistance(p.distance)}</Text>
                      </View>
                    )}
                    {p.rating != null && (
                      <View style={styles.nearbyRatingRow}>
                        <Ionicons name="star" size={10} color="#F59E0B" />
                        <Text style={styles.nearbyRating}>{p.rating.toFixed(1)}</Text>
                      </View>
                    )}
                    {p.provider_treatments.length > 0 && (
                      <View style={[styles.nearbyPill, {
                        backgroundColor: (CATEGORY_COLOR[p.provider_treatments[0].category] ?? Colors.muted) + '22',
                      }]}>
                        <Text style={[styles.nearbyPillText, {
                          color: CATEGORY_COLOR[p.provider_treatments[0].category] ?? Colors.muted,
                        }]} numberOfLines={1}>
                          {p.provider_treatments[0].category}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>

          {/* ── Subscription status ── */}
          {isVerified && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Subscription</Text>
              <View style={styles.subCard}>
                <View style={styles.subIconWrap}>
                  <Ionicons name="diamond-outline" size={22} color={Colors.roseDark} />
                </View>
                <View style={styles.subInfo}>
                  <Text style={styles.subStatusText}>Verified</Text>
                  {subscription?.periodEnd ? (
                    <Text style={styles.subRenew}>Renews {formatPeriodEnd(subscription.periodEnd)}</Text>
                  ) : null}
                </View>
                <View style={styles.subBadge}>
                  <Text style={styles.subBadgeText}>Verified</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── Your impact ── */}
          {impact != null && impact.completed > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your impact</Text>
              <View style={styles.impactRow}>
                <View style={styles.impactStat}>
                  <Text style={styles.impactNum}>{impact.completed}</Text>
                  <Text style={styles.impactLabel}>
                    {impact.completed === 1 ? 'treatment' : 'treatments'}{'\n'}completed
                  </Text>
                </View>
                {impact.distinctProviders > 0 && (
                  <View style={styles.impactStat}>
                    <Text style={styles.impactNum}>{impact.distinctProviders}</Text>
                    <Text style={styles.impactLabel}>
                      {impact.distinctProviders === 1 ? 'stylist' : 'stylists'}{'\n'}helped
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={styles.bottomPad} />
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}  // end ModelHomeContent

// ── Favourite strip card ─────────────────────────────────────────────────────

function FavouriteCard({ provider, onPress }: { provider: Provider; onPress: () => void }) {
  const cats = provider.provider_treatments.map(t => t.category).slice(0, 2)
  return (
    <TouchableOpacity style={styles.favCard} onPress={onPress} activeOpacity={0.85}>
      {provider.profile_pic_url ? (
        <Image source={{ uri: provider.profile_pic_url }} style={styles.favAvatar} />
      ) : (
        <View style={styles.favAvatarPlaceholder}>
          <Text style={styles.favAvatarInitial}>{provider.name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <Text style={styles.favName} numberOfLines={1}>{provider.name}</Text>
      <View style={styles.favPills}>
        {cats.map(cat => (
          <View key={cat} style={[styles.favPill, { backgroundColor: CATEGORY_COLOR[cat] ?? Colors.muted }]}>
            <Text style={styles.favPillText}>{cat}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', overflow: 'hidden' },
  safe:      { flex: 1 },
  scroll:    { paddingBottom: 24 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 12,
    paddingBottom: 4,
  },
  titleIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pageTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 33,
    color: Colors.warmDark,
    letterSpacing: -0.5,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
    gap: 10,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    flexShrink: 0,
    backgroundColor: Colors.softPink + '40',
    borderWidth: 1,
    borderColor: Colors.rose + '40',
  },
  filterBtnActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  filterBtnText: { fontSize: 13, fontWeight: '700', color: Colors.roseDark },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.softPink,
  },
  profileBtnImg: {
    width: '100%',
    height: '100%',
  },
  profileBtnPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.softPink + '50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'android' ? 4 : 8,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.warmDark,
    padding: 0,
  },
  // Nearby horizontal list
  nearbyRow: { gap: 12, paddingBottom: 4 },
  nearbyCard: {
    width: 120, backgroundColor: Colors.white, borderRadius: 18,
    padding: 12, alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  nearbyAvatarWrap: { position: 'relative' },
  nearbyAvatar: { width: 64, height: 64, borderRadius: 32 },
  nearbyAvatarPlaceholder: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.softPink, alignItems: 'center', justifyContent: 'center',
  },
  nearbyAvatarInitial: { fontSize: 22, fontWeight: '700', color: Colors.roseDark },
  nearbyVerified: { position: 'absolute', bottom: 0, right: -2 },
  nearbyName: { fontSize: 13, fontWeight: '700', color: Colors.warmDark, textAlign: 'center' },
  nearbyDistRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  nearbyDist: { fontSize: 11, color: Colors.roseDark, fontWeight: '600' },
  nearbyRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  nearbyRating: { fontSize: 11, fontWeight: '600', color: Colors.warmDark },
  nearbyPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 100 },
  nearbyPillText: { fontSize: 10, fontWeight: '700', textAlign: 'center' },

  // Filter panel
  filterPanel: {
    backgroundColor: Colors.white, marginHorizontal: 16, marginTop: 8,
    borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.border,
    gap: 10,
  },
  filterPanelLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  distChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.inputBg,
  },
  distChipActive: { backgroundColor: Colors.roseDark, borderColor: Colors.roseDark },
  distChipText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  distChipTextActive: { color: Colors.white },
  verifiedToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  verifiedToggleLabel: { fontSize: 14, fontWeight: '600', color: Colors.warmDark },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 26,
    color: Colors.warmDark,
    letterSpacing: -0.3,
    marginBottom: 12,
  },

  emptyFavs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyFavsEmoji: { fontSize: 22 },
  emptyFavsText: {
    flex: 1,
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },

  favsRow: {
    gap: 12,
  },
  favCard: {
    width: 110,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  favAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  favAvatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  favAvatarInitial: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.roseDark,
  },
  favName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 6,
    textAlign: 'center',
  },
  favPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'center',
  },
  favPill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  favPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.white,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyStateEmoji: { fontSize: 40, marginBottom: 12 },
  emptyStateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Dashboard cards ──
  dashCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  // Upcoming treatments — horizontal cards
  upcomingScroll: { gap: 12, paddingRight: 16, paddingBottom: 4 },
  upcomingCard: {
    width: 230,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  upcomingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upcomingStatus: { alignSelf: 'flex-start' },

  dashAvatarWrap: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  dashAvatar: { width: 44, height: 44, borderRadius: 22 },
  dashAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashAvatarInitial: { fontSize: 18, fontWeight: '700', color: Colors.roseDark },
  dashInfo: { flex: 1, gap: 3 },
  dashTitle: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  dashMeta: { fontSize: 13, color: Colors.muted },
  dashTag: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.softPink,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
  },
  dashStatusBadge: {
    backgroundColor: Colors.softPink,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dashStatusText: { fontSize: 11, fontWeight: '700', color: Colors.roseDark },
  dashStatusPending: { backgroundColor: '#FFF3CD' },
  dashStatusTextPending: { color: '#856404' },

  attentionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Subscription card ──
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  subIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subInfo: { flex: 1 },
  subStatusText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  subRenew: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  subBadge: {
    backgroundColor: Colors.roseDark,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  subBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  // ── Impact stats ──
  impactRow: {
    flexDirection: 'row',
    gap: 12,
  },
  impactStat: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  impactNum: { fontSize: 32, fontWeight: '800', color: Colors.roseDark },
  impactLabel: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },

  bottomPad: { height: 20 },
  wrongScreenBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.roseDark,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  wrongScreenText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
    lineHeight: 21,
  },
})
