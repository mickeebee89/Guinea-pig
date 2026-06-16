import { useState, useEffect, useMemo, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { ConsentGate } from '@/components/ConsentGate'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Nails:       '#C8788A',
  Lashes:      '#1D9E75',
  Brows:       '#BA7517',
  Hair:        '#7B5EA7',
  Makeup:      '#E8845E',
  'Spray Tan': '#C99A4E',
}

const DAYS_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const TOTAL_STEPS = 7
const NOTE_MAX    = 300

const STEP_TITLES = [
  'Choose a date',
  'Pick a time',
  'Select a treatment',
  'Add a note',
  'Share photos',
  'Almost there',
  'Review & confirm',
]

const STEP_SUBS = [
  "Available dates are highlighted in rose — tap one to select",
  'Choose a time slot that works for you',
  "Pick the treatment you'd like at this session",
  'Anything the provider should know? (optional)',
  'Share photos to help the provider prepare (optional)',
  'Please read and agree before confirming your application',
  'Check your details, then send your application',
]

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailabilitySlot = { start_time: string; end_time: string; treatment_ids: string[] }
type AvailabilityRow  = { date: string; slots: AvailabilitySlot[] }
type Treatment        = { id: string; name: string; category: string }
type ExistingPhoto    = { id: string; photoUrl: string }
type PendingPhoto     = { uri: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function calendarRows(year: number, month: number): (Date | null)[][] {
  const startDow  = (new Date(year, month, 1).getDay() + 6) % 7
  const totalDays = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatDateShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ApplySessionScreen() {
  const { providerId, providerName } =
    useLocalSearchParams<{ providerId: string; providerName: string }>()
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id
  const scrollRef = useRef<ScrollView>(null)

  const today    = useMemo(() => new Date(), [])
  const todayKey = useMemo(() => dateKey(today), [today])

  // ── Data state ─────────────────────────────────────────────────────────────

  const [loading,         setLoading]         = useState(true)
  const [availRows,       setAvailRows]       = useState<AvailabilityRow[]>([])
  const [treatments,      setTreatments]      = useState<Treatment[]>([])
  const [existingPhotos,  setExistingPhotos]  = useState<ExistingPhoto[]>([])
  const [selectedPhotoIds,setSelectedPhotoIds]= useState<Set<string>>(new Set())
  const [pendingPhotos,   setPendingPhotos]   = useState<PendingPhoto[]>([])
  const [providerUserId,  setProviderUserId]  = useState<string | null>(null)

  // ── Wizard state ───────────────────────────────────────────────────────────

  const [step,          setStep]         = useState<1|2|3|4|5|6|7>(1)
  const [viewYear,      setViewYear]     = useState(today.getFullYear())
  const [viewMonth,     setViewMonth]    = useState(today.getMonth())
  const [selectedDate,  setSelectedDate] = useState<string | null>(null)
  const [selectedSlot,  setSelectedSlot] = useState<AvailabilitySlot | null>(null)
  const [selectedTreatId,setSelectedTreatId]= useState<string | null>(null)
  const [note,          setNote]         = useState('')
  const [submitting,    setSubmitting]   = useState(false)
  const [submitted,     setSubmitted]    = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!providerId || !userId) return
    async function load() {
      // Gate: models must have an active subscription to apply
      try {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle()
        if (!sub) {
          router.replace({
            pathname: '/(app)/subscribe' as any,
            params:   { providerId, providerName },
          })
          return
        }
      } catch { /* if query fails let them through rather than blocking */ }

      try {
        const [{ data: availData }, { data: treatData }, { data: provData }] = await Promise.all([
          supabase
            .from('provider_availability')
            .select('date, slots')
            .eq('provider_id', providerId)
            .gte('date', todayKey)
            .order('date'),
          supabase
            .from('provider_treatments')
            .select('id, name, category')
            .eq('provider_id', providerId),
          supabase
            .from('providers')
            .select('user_id')
            .eq('id', providerId)
            .single(),
        ])
        if (availData) setAvailRows(availData as AvailabilityRow[])
        if (treatData) setTreatments(treatData as Treatment[])
        if (provData)  setProviderUserId((provData as any).user_id ?? null)
      } catch {}

      try {
        const { data: photoData } = await supabase
          .from('model_photos')
          .select('id, photo_url')
          .eq('user_id', userId)
        if (photoData) {
          setExistingPhotos(photoData.map((p: any) => ({ id: p.id, photoUrl: p.photo_url })))
        }
      } catch {}

      setLoading(false)
    }
    load()
  }, [providerId, userId, todayKey])

  // ── Derived ────────────────────────────────────────────────────────────────

  const availDateSet = useMemo(() => new Set(availRows.map(r => r.date)), [availRows])

  const slotsForDate = useMemo(
    () => availRows.find(r => r.date === selectedDate)?.slots ?? [],
    [availRows, selectedDate]
  )

  const treatmentsInSlot = useMemo(
    () => selectedSlot
      ? treatments.filter(t => selectedSlot.treatment_ids.includes(t.id))
      : [],
    [selectedSlot, treatments]
  )

  const selectedTreatment = useMemo(
    () => treatments.find(t => t.id === selectedTreatId) ?? null,
    [treatments, selectedTreatId]
  )

  const calRows = useMemo(() => calendarRows(viewYear, viewMonth), [viewYear, viewMonth])

  const canNext = useMemo(() => {
    switch (step) {
      case 1: return selectedDate !== null
      case 2: return selectedSlot !== null
      case 3: return selectedTreatId !== null
      case 4:
      case 5: return true
      default: return false
    }
  }, [step, selectedDate, selectedSlot, selectedTreatId])

  const totalShareCount = selectedPhotoIds.size + pendingPhotos.length

  // ── Navigation handlers ────────────────────────────────────────────────────

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (step > 1) {
      setStep(s => (s - 1) as 1|2|3|4|5|6|7)
      scrollRef.current?.scrollTo({ y: 0, animated: false })
    } else {
      router.back()
    }
  }

  const goNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setStep(s => (s + 1) as 2|3|4|5|6|7)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  const handleConsentAccept = () => {
    setStep(7)
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  // ── Selection handlers ─────────────────────────────────────────────────────

  const selectDate = async (key: string) => {
    if (!availDateSet.has(key)) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedDate(key)
    setSelectedSlot(null)
    setSelectedTreatId(null)
  }

  const selectSlot = async (slot: AvailabilitySlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedSlot(slot)
    setSelectedTreatId(null)
  }

  const selectTreatment = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedTreatId(id)
  }

  const prevMonth = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  const nextMonth = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  // ── Photo handlers ─────────────────────────────────────────────────────────

  const toggleExistingPhoto = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedPhotoIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const addPhotos = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need access to your photo library.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 0.8,
    })
    if (!result.canceled && result.assets.length > 0) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setPendingPhotos(prev => [...prev, ...result.assets.map(a => ({ uri: a.uri }))])
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!userId || !providerId || !selectedDate || !selectedSlot || !selectedTreatId) return
    setSubmitting(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      // Upload pending photos, silently skip failures
      const uploadedUrls: string[] = []
      for (const photo of pendingPhotos) {
        try {
          const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
          const manipulated = await ImageManipulator.manipulateAsync(photo.uri, [], { base64: true })
          const { data: up, error: upErr } = await supabase.storage
            .from('model-photos')
            .upload(fileName, decode(manipulated.base64!), { contentType: 'image/jpeg' })
          if (!upErr && up) {
            const { data: urlData } = supabase.storage.from('model-photos').getPublicUrl(up.path)
            uploadedUrls.push(urlData.publicUrl)
            try {
              await supabase.from('model_photos').insert({ user_id: userId, photo_url: urlData.publicUrl })
            } catch {}
          }
        } catch {}
      }

      const selectedExistingUrls = existingPhotos
        .filter(p => selectedPhotoIds.has(p.id))
        .map(p => p.photoUrl)
      const allPhotoUrls = [...selectedExistingUrls, ...uploadedUrls]

      const { data: sessionData, error: sessionErr } = await supabase
        .from('sessions')
        .insert({
          provider_id:   providerId,
          model_user_id: userId,
          date:          selectedDate,
          start_time:    selectedSlot.start_time,
          end_time:      selectedSlot.end_time,
          treatment_id:  selectedTreatId,
          note:          note.trim() || null,
          photo_urls:    allPhotoUrls.length > 0 ? allPhotoUrls : null,
          status:        'pending',
        })
        .select('id')
        .single()

      if (sessionErr) throw sessionErr

      // Notify provider (silent fail)
      if (providerUserId && sessionData) {
        try {
          await supabase.from('notifications').insert({
            user_id: providerUserId,
            type:    'session_application',
            title:   'New session application',
            body:    `A model has applied for ${selectedTreatment?.name ?? 'a session'} on ${formatDateShort(selectedDate)} at ${selectedSlot.start_time}`,
            data:    { session_id: sessionData.id, provider_id: providerId },
            read:    false,
          })
        } catch {}
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setSubmitted(true)
    } catch (err: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Could not submit', err?.message ?? 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <View style={[styles.successInner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.roseDark} />
          </View>
          <Text style={styles.successTitle}>Application sent!</Text>
          <Text style={styles.successSub}>
            Your application has been sent to {providerName ? providerName : 'the provider'}.{'\n'}
            You'll be notified when they respond.
          </Text>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.back()}
            activeOpacity={0.9}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const progressPct = `${Math.round((step / TOTAL_STEPS) * 100)}%` as const

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          <Text style={styles.backText}>{step > 1 ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressPct }]} />
          </View>
          <Text style={styles.progressLabel}>{step}/{TOTAL_STEPS}</Text>
        </View>
      </View>

      {/* ── Step header ── */}
      <View style={styles.stepHeader}>
        <Text style={styles.stepLabel}>Step {step} of {TOTAL_STEPS}</Text>
        <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
        <Text style={styles.stepSub}>{STEP_SUBS[step - 1]}</Text>
      </View>

      {/* ── Content ── */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >

        {/* ════ STEP 1 — DATE ══════════════════════════════════════════════ */}
        {step === 1 && (
          loading ? (
            <View style={[styles.card, styles.centred]}>
              <Text style={styles.loadingText}>Loading availability…</Text>
            </View>
          ) : availRows.length === 0 ? (
            <View style={[styles.card, styles.centred, { paddingVertical: 32 }]}>
              <Text style={styles.emptyEmoji}>📅</Text>
              <Text style={styles.emptyTitle}>No availability yet</Text>
              <Text style={styles.emptySub}>
                This provider hasn't published their schedule. Check back soon!
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              {/* Month nav */}
              <View style={styles.monthNav}>
                <TouchableOpacity style={styles.monthNavBtn} onPress={prevMonth} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={18} color={Colors.warmDark} />
                </TouchableOpacity>
                <Text style={styles.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
                <TouchableOpacity style={styles.monthNavBtn} onPress={nextMonth} activeOpacity={0.7}>
                  <Ionicons name="chevron-forward" size={18} color={Colors.warmDark} />
                </TouchableOpacity>
              </View>

              {/* Day headers */}
              <View style={styles.calHeaders}>
                {DAYS_SHORT.map(d => (
                  <Text key={d} style={styles.calHeader}>{d}</Text>
                ))}
              </View>

              {/* Date grid */}
              {calRows.map((row, ri) => (
                <View key={ri} style={styles.calRow}>
                  {row.map((date, ci) => {
                    if (!date) return <View key={ci} style={styles.calCell} />
                    const key        = dateKey(date)
                    const isPast     = key < todayKey
                    const isAvail    = availDateSet.has(key) && !isPast
                    const isSelected = key === selectedDate
                    const isToday    = key === todayKey
                    return (
                      <TouchableOpacity
                        key={ci}
                        style={[
                          styles.calCell,
                          isToday    && !isSelected && styles.calCellToday,
                          isAvail    && !isSelected && styles.calCellAvail,
                          isSelected && styles.calCellSelected,
                          isPast     && styles.calCellPast,
                        ]}
                        onPress={() => selectDate(key)}
                        disabled={isPast || !isAvail}
                        activeOpacity={0.75}
                      >
                        <Text style={[
                          styles.calCellText,
                          isToday    && !isSelected && styles.calCellTextToday,
                          isAvail    && !isSelected && styles.calCellTextAvail,
                          isSelected && styles.calCellTextSelected,
                          isPast     && styles.calCellTextPast,
                        ]}>
                          {date.getDate()}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ))}

              {/* Legend + selection */}
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.rose + '55' }]} />
                  <Text style={styles.legendText}>Available</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.roseDark }]} />
                  <Text style={styles.legendText}>Selected</Text>
                </View>
              </View>

              {selectedDate && (
                <View style={styles.selectionBanner}>
                  <Ionicons name="calendar-outline" size={14} color={Colors.roseDark} />
                  <Text style={styles.selectionText}>{formatDayLabel(selectedDate)}</Text>
                </View>
              )}
            </View>
          )
        )}

        {/* ════ STEP 2 — TIME SLOTS ════════════════════════════════════════ */}
        {step === 2 && (
          <View style={styles.card}>
            {slotsForDate.length === 0 ? (
              <Text style={styles.emptyHint}>No time slots available for this date.</Text>
            ) : (
              slotsForDate.map((slot, i) => {
                const isSelected = selectedSlot?.start_time === slot.start_time &&
                                   selectedSlot?.end_time   === slot.end_time
                const slotTreats = treatments.filter(t => slot.treatment_ids.includes(t.id))
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.slotPill, isSelected && styles.slotPillSelected]}
                    onPress={() => selectSlot(slot)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.slotTimeWrap}>
                      <Ionicons
                        name="time-outline"
                        size={16}
                        color={isSelected ? Colors.roseDark : Colors.muted}
                      />
                      <Text style={[styles.slotTimeText, isSelected && styles.slotTimeTextSelected]}>
                        {slot.start_time} – {slot.end_time}
                      </Text>
                    </View>
                    <View style={styles.slotStripes}>
                      {slotTreats.map(t => {
                        const color = CATEGORY_COLOR[t.category] ?? Colors.muted
                        return (
                          <View key={t.id} style={[styles.slotStripe, { backgroundColor: color }]}>
                            <Text style={styles.slotStripeText}>{t.category}</Text>
                          </View>
                        )
                      })}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={22} color={Colors.roseDark} />
                    )}
                  </TouchableOpacity>
                )
              })
            )}
          </View>
        )}

        {/* ════ STEP 3 — TREATMENT ═════════════════════════════════════════ */}
        {step === 3 && (
          <View style={styles.card}>
            {treatmentsInSlot.length === 0 ? (
              <Text style={styles.emptyHint}>No treatments listed for this slot.</Text>
            ) : (
              <View style={styles.chipGrid}>
                {treatmentsInSlot.map(t => {
                  const active = selectedTreatId === t.id
                  const color  = CATEGORY_COLOR[t.category] ?? Colors.muted
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[
                        styles.treatChip,
                        active
                          ? { backgroundColor: color, borderColor: color }
                          : { borderColor: color },
                      ]}
                      onPress={() => selectTreatment(t.id)}
                      activeOpacity={0.75}
                    >
                      {active && (
                        <Ionicons name="checkmark" size={13} color={Colors.white} style={{ marginRight: 5 }} />
                      )}
                      <Text style={[styles.treatChipText, { color: active ? Colors.white : color }]}>
                        {t.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </View>
        )}

        {/* ════ STEP 4 — NOTE ══════════════════════════════════════════════ */}
        {step === 4 && (
          <View style={styles.card}>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={t => setNote(t.slice(0, NOTE_MAX))}
              placeholder="Anything the provider should know?"
              placeholderTextColor={Colors.muted}
              multiline
              textAlignVertical="top"
              maxLength={NOTE_MAX}
            />
            <Text style={styles.noteCounter}>{note.length}/{NOTE_MAX}</Text>
          </View>
        )}

        {/* ════ STEP 5 — PHOTOS ════════════════════════════════════════════ */}
        {step === 5 && (
          <>
            <View style={[styles.card, styles.infoCard]}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.roseDark} />
              <Text style={styles.infoText}>
                Photos help the provider prepare their tools and materials. You choose what to share.
              </Text>
            </View>

            <View style={styles.card}>
              {existingPhotos.length === 0 && pendingPhotos.length === 0 ? (
                <View style={styles.photoEmptyState}>
                  <Ionicons name="images-outline" size={44} color={Colors.muted} />
                  <Text style={styles.photoEmptyTitle}>No photos yet</Text>
                  <Text style={styles.photoEmptySub}>
                    Add photos from your library to share with the provider.
                  </Text>
                </View>
              ) : (
                <View style={styles.photoGrid}>
                  {existingPhotos.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.photoThumb, selectedPhotoIds.has(p.id) && styles.photoThumbSelected]}
                      onPress={() => toggleExistingPhoto(p.id)}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: p.photoUrl }} style={styles.photoImg} resizeMode="cover" />
                      {selectedPhotoIds.has(p.id) && (
                        <View style={styles.photoCheckOverlay}>
                          <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                  {pendingPhotos.map((p, i) => (
                    <View key={`pending-${i}`} style={[styles.photoThumb, styles.photoThumbSelected]}>
                      <Image source={{ uri: p.uri }} style={styles.photoImg} resizeMode="cover" />
                      <View style={styles.photoCheckOverlay}>
                        <Ionicons name="checkmark-circle" size={22} color={Colors.white} />
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={styles.addPhotoBtn}
                onPress={addPhotos}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle-outline" size={20} color={Colors.roseDark} />
                <Text style={styles.addPhotoText}>Add photos from library</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ════ STEP 6 — CONSENT ═══════════════════════════════════════════ */}
        {step === 6 && (
          <ConsentGate onAccept={handleConsentAccept} />
        )}

        {/* ════ STEP 7 — CONFIRMATION ══════════════════════════════════════ */}
        {step === 7 && selectedDate && selectedSlot && selectedTreatment && (
          <View style={styles.card}>
            <Text style={styles.confirmSectionTitle}>Session details</Text>

            <ConfirmRow icon="person-outline"   label="Provider"  value={providerName ?? ''} />
            <ConfirmRow icon="calendar-outline" label="Date"      value={formatDayLabel(selectedDate)} />
            <ConfirmRow icon="time-outline"     label="Time"      value={`${selectedSlot.start_time} – ${selectedSlot.end_time}`} />

            {/* Treatment — special row with colour stripe */}
            <View style={styles.confirmRow}>
              <Ionicons name="sparkles-outline" size={18} color={Colors.muted} style={styles.confirmRowIcon} />
              <Text style={styles.confirmLabel}>Treatment</Text>
              <View style={styles.confirmTreatWrap}>
                <View style={[
                  styles.confirmTreatStripe,
                  { backgroundColor: CATEGORY_COLOR[selectedTreatment.category] ?? Colors.muted },
                ]} />
                <Text style={styles.confirmValue}>{selectedTreatment.name}</Text>
              </View>
            </View>

            {note.trim() ? (
              <ConfirmRow icon="chatbubble-outline" label="Note"   value={note.trim()} multiline />
            ) : (
              <ConfirmRow icon="chatbubble-outline" label="Note"   value="No note added" muted />
            )}

            {totalShareCount > 0 ? (
              <ConfirmRow
                icon="images-outline"
                label="Photos"
                value={`${totalShareCount} photo${totalShareCount !== 1 ? 's' : ''} to share`}
              />
            ) : (
              <ConfirmRow icon="images-outline" label="Photos" value="No photos shared" muted />
            )}
          </View>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Bottom bar (hidden for step 6 — ConsentGate has its own button) ── */}
      {step !== 6 && (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {step < 7 ? (
            <TouchableOpacity
              style={[styles.actionBtn, !canNext && styles.actionBtnDisabled]}
              disabled={!canNext}
              onPress={goNext}
              activeOpacity={0.9}
            >
              <Text style={styles.actionBtnText}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color={Colors.white} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, submitting && styles.actionBtnDisabled]}
              disabled={submitting}
              onPress={handleSubmit}
              activeOpacity={0.9}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
              <Text style={styles.actionBtnText}>
                {submitting ? 'Sending…' : 'Confirm application'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfirmRow({
  icon,
  label,
  value,
  muted     = false,
  multiline = false,
}: {
  icon: string
  label: string
  value: string
  muted?: boolean
  multiline?: boolean
}) {
  return (
    <View style={[styles.confirmRow, multiline && { alignItems: 'flex-start' }]}>
      <Ionicons name={icon as any} size={18} color={Colors.muted} style={styles.confirmRowIcon} />
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={[
        styles.confirmValue,
        muted && styles.confirmValueMuted,
        multiline && { flex: 1 },
      ]}>
        {value}
      </Text>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },

  // Success
  successContainer: { justifyContent: 'center' },
  successInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 15,
    color: Colors.muted,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  doneBtn: {
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 56,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingRight: 10,
  },
  backText: {
    fontSize: 15,
    color: Colors.roseDark,
    fontWeight: '500',
  },
  progressWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.roseDark,
    borderRadius: 2,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    minWidth: 28,
    textAlign: 'right',
  },

  // Step header
  stepHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.rose,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  stepSub: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
  },

  scroll: { paddingHorizontal: 16 },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  centred: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.softPink + '30',
    borderColor: Colors.softPink,
    padding: 14,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.warmDark,
    lineHeight: 19,
    opacity: 0.85,
  },

  loadingText: { fontSize: 15, color: Colors.muted },

  emptyEmoji: { fontSize: 40, marginBottom: 10 },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    paddingVertical: 12,
  },

  // Calendar
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  calHeaders: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: Colors.muted,
    textTransform: 'uppercase',
  },
  calRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calCell: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  calCellToday: {
    borderWidth: 1.5,
    borderColor: Colors.rose,
  },
  calCellAvail: {
    backgroundColor: Colors.rose + '28',
  },
  calCellSelected: {
    backgroundColor: Colors.roseDark,
  },
  calCellPast: { opacity: 0.3 },
  calCellText: { fontSize: 14, color: Colors.warmDark },
  calCellTextToday:    { color: Colors.roseDark, fontWeight: '700' },
  calCellTextAvail:    { color: Colors.roseDark, fontWeight: '600' },
  calCellTextSelected: { color: Colors.white, fontWeight: '700' },
  calCellTextPast:     { color: Colors.muted },

  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: '500',
  },

  selectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  selectionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roseDark,
  },

  // Slot pills
  slotPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 10,
  },
  slotPillSelected: {
    borderColor: Colors.roseDark,
    backgroundColor: Colors.rose + '12',
  },
  slotTimeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 106,
  },
  slotTimeText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  slotTimeTextSelected: {
    color: Colors.roseDark,
  },
  slotStripes: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  slotStripe: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  slotStripeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
  },

  // Treatment chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  treatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  treatChipText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Note
  noteInput: {
    fontSize: 15,
    color: Colors.warmDark,
    lineHeight: 22,
    minHeight: 120,
    backgroundColor: Colors.inputBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteCounter: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'right',
    marginTop: 6,
  },

  // Photos
  photoEmptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  photoEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.warmDark,
  },
  photoEmptySub: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 220,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  photoThumbSelected: {
    borderColor: Colors.roseDark,
  },
  photoImg: {
    width: '100%',
    height: '100%',
  },
  photoCheckOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  addPhotoText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.roseDark,
  },

  // Confirmation
  confirmSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  confirmRowIcon: { flexShrink: 0 },
  confirmLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
    width: 72,
    flexShrink: 0,
  },
  confirmValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.warmDark,
  },
  confirmValueMuted: {
    color: Colors.muted,
    fontStyle: 'italic',
  },
  confirmTreatWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmTreatStripe: {
    width: 4,
    height: 18,
    borderRadius: 2,
    flexShrink: 0,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream,
    shadowColor: Colors.warmDark,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 6,
  },
  actionBtn: {
    backgroundColor: Colors.roseDark,
    borderRadius: 16,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  actionBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
})
