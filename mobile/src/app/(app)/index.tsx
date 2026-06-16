import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

const CATEGORIES = [
  { name: 'All',       color: Colors.muted   },
  { name: 'Nails',     color: '#C8788A'      },
  { name: 'Lashes',    color: '#1D9E75'      },
  { name: 'Brows',     color: '#BA7517'      },
  { name: 'Hair',      color: '#7B5EA7'      },
  { name: 'Makeup',    color: '#E8845E'      },
  { name: 'Spray Tan', color: '#C99A4E'      },
] as const

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
}

export default function ModelHomeScreen() {
  const router = useRouter()
  const { session } = useAuth()
  const userId = session?.user?.id

  const [providers, setProviders]         = useState<Provider[]>([])
  const [favouriteIds, setFavouriteIds]   = useState<Set<string>>(new Set())
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [search, setSearch]               = useState('')
  const [refreshing, setRefreshing]       = useState(false)
  const [loading, setLoading]             = useState(true)
  const [roleChecked, setRoleChecked]     = useState(false)
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null)
  const [unreadCount, setUnreadCount]     = useState(0)

  const fetchData = useCallback(async () => {
    if (!userId) { setLoading(false); setRoleChecked(true); return }

    try {
      // Check role first — redirect providers before loading model home data
      const { data: userData } = await supabase
        .from('users')
        .select('role, profile_pic_url')
        .eq('id', userId)
        .single()

      if (userData?.role === 'provider') {
        router.replace('/(app)/provider-dashboard' as any)
        return
      }

      // Fallback for users whose row wasn't created at signup — check providers table directly
      if (!userData) {
        const { data: provRow } = await supabase
          .from('providers')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle()
        if (provRow) {
          router.replace('/(app)/provider-dashboard' as any)
          return
        }
      }

      setProfilePicUrl(userData?.profile_pic_url ?? null)
      setRoleChecked(true)

      const [{ data: provData }, { data: favData }, { count: unread }] = await Promise.all([
        supabase
          .from('providers')
          .select('id, name, location, is_verified, rating, profile_pic_url, provider_treatments(category)')
          .order('rating', { ascending: false }),
        supabase
          .from('favourites')
          .select('provider_id')
          .eq('user_id', userId),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('read', false),
      ])

      if (provData) setProviders(provData as Provider[])
      if (favData) {
        setFavouriteIds(new Set((favData as { provider_id: string }[]).map(f => f.provider_id)))
      }
      setUnreadCount(unread ?? 0)
    } catch {
      setRoleChecked(true)
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

  const selectCategory = async (cat: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedCategory(cat)
  }

  const openProvider = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push({ pathname: '/(app)/provider/[id]', params: { id } })
  }

  const filtered = providers.filter(p => {
    const matchesCategory =
      selectedCategory === 'All' ||
      p.provider_treatments.some(t => t.category === selectedCategory)
    const q = search.trim().toLowerCase()
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.location ?? '').toLowerCase().includes(q)
    return matchesCategory && matchesSearch
  })

  const favouriteProviders = providers.filter(p => favouriteIds.has(p.id))

  // Prevent flash of model home for providers while role check is in-flight
  if (!roleChecked) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.roseDark} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
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
          {/* ── Header ── */}
          <View style={styles.header}>
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
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color={Colors.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search providers…"
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
              style={styles.bellBtn}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                router.push('/(app)/messages' as any)
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={22} color={Colors.warmDark} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                router.push('/(app)/notifications' as any)
              }}
            >
              <Ionicons name="notifications-outline" size={22} color={Colors.warmDark} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {unreadCount > 9 ? '9+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Category chips ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {CATEGORIES.map(cat => {
              const active = selectedCategory === cat.name
              return (
                <TouchableOpacity
                  key={cat.name}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: cat.color, borderColor: cat.color }
                      : { borderColor: cat.color },
                  ]}
                  onPress={() => selectCategory(cat.name)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : { color: cat.color }]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          {/* ── Favourites ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Favourites</Text>
            {favouriteProviders.length === 0 ? (
              <View style={styles.emptyFavs}>
                <Text style={styles.emptyFavsEmoji}>🤍</Text>
                <Text style={styles.emptyFavsText}>
                  Save providers you love — tap the heart on any profile
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

          {/* ── Nearby providers ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nearby providers</Text>
            {loading ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>Finding providers near you…</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🐾</Text>
                <Text style={styles.emptyStateTitle}>No providers yet</Text>
                <Text style={styles.emptyStateText}>
                  We're growing! Check back soon — new providers join every week.
                </Text>
              </View>
            ) : (
              filtered.map(p => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  isFavourite={favouriteIds.has(p.id)}
                  onPress={() => openProvider(p.id)}
                  onToggleFavourite={() => toggleFavourite(p.id)}
                />
              ))
            )}
          </View>

          <View style={styles.bottomPad} />
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

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

// ── Provider discovery card ──────────────────────────────────────────────────

function ProviderCard({
  provider,
  isFavourite,
  onPress,
  onToggleFavourite,
}: {
  provider: Provider
  isFavourite: boolean
  onPress: () => void
  onToggleFavourite: () => void
}) {
  const cats = provider.provider_treatments.map(t => t.category)

  return (
    <TouchableOpacity style={styles.providerCard} onPress={onPress} activeOpacity={0.9}>
      {provider.profile_pic_url ? (
        <Image source={{ uri: provider.profile_pic_url }} style={styles.providerAvatar} />
      ) : (
        <View style={styles.providerAvatarPlaceholder}>
          <Text style={styles.providerAvatarInitial}>{provider.name[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}

      <View style={styles.providerInfo}>
        <View style={styles.providerNameRow}>
          <Text style={styles.providerName} numberOfLines={1}>{provider.name}</Text>
          {provider.is_verified && (
            <Ionicons name="checkmark-circle" size={15} color="#1D9E75" style={styles.verifiedIcon} />
          )}
        </View>

        {provider.location ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color={Colors.muted} />
            <Text style={styles.locationText}>{provider.location}</Text>
          </View>
        ) : null}

        {cats.length > 0 && (
          <View style={styles.pillsRow}>
            {cats.slice(0, 4).map(cat => (
              <View
                key={cat}
                style={[styles.pill, { backgroundColor: (CATEGORY_COLOR[cat] ?? Colors.muted) + '22' }]}
              >
                <View style={[styles.pillStripe, { backgroundColor: CATEGORY_COLOR[cat] ?? Colors.muted }]} />
                <Text style={[styles.pillText, { color: CATEGORY_COLOR[cat] ?? Colors.muted }]}>{cat}</Text>
              </View>
            ))}
          </View>
        )}

        {provider.rating != null && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color="#F59E0B" />
            <Text style={styles.ratingText}> {provider.rating.toFixed(1)}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={styles.heartBtn}
        onPress={onToggleFavourite}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={isFavourite ? 'heart' : 'heart-outline'}
          size={22}
          color={isFavourite ? Colors.rose : Colors.muted}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  safe:      { flex: 1 },
  scroll:    { paddingBottom: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 12,
    paddingBottom: 12,
    gap: 10,
  },
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
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: Colors.cream,
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: -0.2,
  },

  chips: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.white,
  },

  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
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

  providerCard: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'flex-start',
  },
  providerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 14,
    marginRight: 12,
  },
  providerAvatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.softPink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  providerAvatarInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.roseDark,
  },
  providerInfo: {
    flex: 1,
    gap: 4,
  },
  providerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.warmDark,
    flexShrink: 1,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  locationText: {
    fontSize: 12,
    color: Colors.muted,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  pillStripe: {
    width: 3,
    height: 10,
    borderRadius: 2,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  heartBtn: {
    padding: 4,
    marginLeft: 4,
  },

  bottomPad: { height: 20 },
})
