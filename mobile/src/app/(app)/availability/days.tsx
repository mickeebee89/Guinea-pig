import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'
import {
  DaySlots, Treatment,
  formatDayShort, hhmm,
  loadProviderId, loadTreatments, loadUpcomingDays,
} from '@/lib/availability'

// Every upcoming day this stylist has set up. Tapping one opens a dedicated editor
// for THAT day, so there's never any doubt which date is being changed.
// Past dates are excluded — they can't be edited.

export default function AvailabilityDaysScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session } = useAuth()
  const userId = session?.user?.id

  const [days,       setDays]       = useState<DaySlots>({})
  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError,  setLoadError]  = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (!userId) { setLoading(false); return }
    if (!isRefresh) setLoading(true)
    setLoadError(false)
    try {
      const pid = await loadProviderId(userId)
      if (!pid) { setDays({}); return }
      const [treats, d] = await Promise.all([loadTreatments(pid), loadUpcomingDays(pid)])
      setTreatments(treats)
      setDays(d)
    } catch (e) {
      console.warn('availability days: load failed', e)
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  // Refetch on focus so edits/deletes made in the editor show immediately.
  useFocusEffect(useCallback(() => { load() }, [load]))

  const onRefresh = () => { setRefreshing(true); load(true) }

  const openDay = async (date: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push({ pathname: '/(app)/availability/[date]' as any, params: { date } })
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const dates = Object.keys(days).sort()

  return (
    <View style={styles.container}>
      <ScreenDecor />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>Your days</Text>
        <View style={{ width: 68 }} />
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator color={Colors.rose} /></View>
      ) : loadError ? (
        <LoadErrorState onRetry={() => load()} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.rose} />
          }
        >
          {dates.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="calendar-outline" size={30} color={Colors.muted} />
              <Text style={styles.emptyTitle}>No availability set yet</Text>
              <Text style={styles.emptyBody}>
                Add some dates and times so models can book you.
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={goBack} activeOpacity={0.9}>
                <Text style={styles.emptyBtnText}>Add dates</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.countLabel}>
                {dates.length} upcoming {dates.length === 1 ? 'day' : 'days'}
              </Text>
              {dates.map(date => (
                <DayRow
                  key={date}
                  date={date}
                  slots={days[date]}
                  treatments={treatments}
                  onPress={() => openDay(date)}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  )
}

function DayRow({
  date, slots, treatments, onPress,
}: {
  date: string
  slots: DaySlots[string]
  treatments: Treatment[]
  onPress: () => void
}) {
  // Treatment names are DERIVED from the day's slots — there's no day-level
  // treatment stored anywhere, which is exactly what keeps this honest.
  const names = Array.from(new Set(slots.flatMap(s => s.treatmentIds)))
    .map(id => treatments.find(t => t.id === id)?.name)
    .filter(Boolean) as string[]

  const times = slots.length === 0
    ? 'No times'
    : slots.length === 1
      ? `${hhmm(slots[0].startTime)}–${hhmm(slots[0].endTime)}`
      : `${slots.length} slots · ${hhmm(slots[0].startTime)}–${hhmm(slots[slots.length - 1].endTime)}`

  return (
    <TouchableOpacity style={styles.dayRow} onPress={onPress} activeOpacity={0.85}>
      <View style={{ flex: 1 }}>
        <Text style={styles.dayDate}>{formatDayShort(date)}</Text>
        <Text style={styles.dayMeta} numberOfLines={1}>
          {names.length > 0 ? names.join(', ') : 'No treatments set'}
        </Text>
        <Text style={styles.dayTimes}>{times}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centre:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, width: 68 },
  backText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.roseDark },
  topTitle: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.warmDark },

  scroll: { paddingHorizontal: 16 },

  countLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginLeft: 4,
  },

  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 18, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.soft,
  },
  dayDate:  { fontFamily: Fonts.heading, fontSize: 16, color: Colors.warmDark },
  dayMeta:  { fontFamily: Fonts.body, fontSize: 13, color: Colors.roseDark, marginTop: 3 },
  dayTimes: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: 2 },

  emptyCard: {
    alignItems: 'center', gap: 10, backgroundColor: Colors.white,
    borderRadius: Radius.lg, padding: 28, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft, marginTop: 8,
  },
  emptyTitle: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.warmDark },
  emptyBody: {
    fontFamily: Fonts.body, fontSize: 13, color: Colors.muted,
    textAlign: 'center', lineHeight: 19,
  },
  emptyBtn: {
    marginTop: 6, backgroundColor: Colors.rose, borderRadius: Radius.lg,
    paddingVertical: 12, paddingHorizontal: 26, ...Shadow.card,
  },
  emptyBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },
})
