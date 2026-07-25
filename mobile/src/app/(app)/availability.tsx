import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, CategoryColors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Nails:       CategoryColors.nails,
  Lashes:      CategoryColors.lashes,
  Brows:       CategoryColors.brows,
  Hair:        CategoryColors.hair,
  Makeup:      CategoryColors.makeup,
  'Spray Tan': CategoryColors.sprayTan,
}

const DAYS_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// Half-hour slots 07:00 → 22:00
const TIMES: string[] = []
for (let h = 7; h <= 22; h++) {
  TIMES.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 22) TIMES.push(`${String(h).padStart(2, '0')}:30`)
}

const DEFAULT_TREATMENTS: Treatment[] = [
  { id: 'nails',     name: 'Nails',     category: 'Nails' },
  { id: 'lashes',    name: 'Lashes',    category: 'Lashes' },
  { id: 'brows',     name: 'Brows',     category: 'Brows' },
  { id: 'hair',      name: 'Hair',      category: 'Hair' },
  { id: 'makeup',    name: 'Makeup',    category: 'Makeup' },
  { id: 'spray_tan', name: 'Spray Tan', category: 'Spray Tan' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

type Treatment      = { id: string; name: string; category: string }
type TimeSlot       = { id: string; startTime: string; endTime: string; treatmentIds: string[] }
type DayTreatments  = Record<string, string[]>
type DaySlots       = Record<string, TimeSlot[]>

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function calendarRows(year: number, month: number): (Date | null)[][] {
  const startDow  = (new Date(year, month, 1).getDay() + 6) % 7  // Mon = 0
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

let _slotCounter = 0
const newSlotId = () => `slot-${++_slotCounter}`

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AvailabilityScreen() {
  const router  = useRouter()
  const { session } = useAuth()
  const insets  = useSafeAreaInsets()
  const userId  = session?.user?.id

  const today    = useMemo(() => new Date(), [])
  const todayKey = useMemo(() => dateKey(today), [today])

  // Step state
  const [step,           setStep]          = useState<1 | 2 | 3>(1)

  // Step 1 – calendar
  const [viewYear,       setViewYear]      = useState(today.getFullYear())
  const [viewMonth,      setViewMonth]     = useState(today.getMonth())
  const [selectedDates,  setSelectedDates] = useState<Set<string>>(new Set())

  // Step 2 – treatments per day
  const [dayTreatments,  setDayTreatments] = useState<DayTreatments>({})
  const [step2Expanded,  setStep2Expanded] = useState(false)

  // Step 3 – time slots per day
  const [daySlots,       setDaySlots]      = useState<DaySlots>({})
  const [step3Expanded,  setStep3Expanded] = useState(false)

  // Data
  const [treatments,     setTreatments]    = useState<Treatment[]>([])
  const [providerId,     setProviderId]    = useState<string | null>(null)
  const [saving,         setSaving]        = useState(false)

  // Slot modal state
  const [modalDate,      setModalDate]     = useState<string | null>(null)
  const [editingSlotId,  setEditingSlotId] = useState<string | null>(null)
  const [modalStart,     setModalStart]    = useState('09:00')
  const [modalEnd,       setModalEnd]      = useState('10:00')
  const [modalTreatIds,  setModalTreatIds] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      if (!userId) return
      try {
        const { data: prov } = await supabase
          .from('providers')
          .select('id')
          .eq('user_id', userId)
          .single()
        if (prov) {
          setProviderId(prov.id)

          // Load saved availability from DB (future dates only)
          // Table: `availability` — one row per time slot
          const today = dateKey(new Date())
          const { data: avData } = await supabase
            .from('availability')
            .select('date, start_time, end_time, active_treatments')
            .eq('provider_id', prov.id)
            .gte('date', today)
            .order('date')
            .order('start_time')

          if (avData && avData.length > 0) {
            const newDates = new Set<string>()
            const newSlots: DaySlots = {}
            const newTreatments: DayTreatments = {}
            for (const row of avData as any[]) {
              const d = (row.date as string).substring(0, 10)  // strip timestamp if any
              newDates.add(d)
              if (!newSlots[d]) newSlots[d] = []
              newSlots[d].push({
                id:           newSlotId(),
                startTime:    (row.start_time as string).substring(0, 5),
                endTime:      (row.end_time as string).substring(0, 5),
                treatmentIds: (row.active_treatments as string[]) || [],
              })
              if (!newTreatments[d]) newTreatments[d] = []
              const treatSet = new Set(newTreatments[d])
              for (const tid of (row.active_treatments || []) as string[]) treatSet.add(tid)
              newTreatments[d] = [...treatSet]
            }
            setSelectedDates(newDates)
            setDaySlots(newSlots)
            setDayTreatments(newTreatments)
          }
        }

        const { data: treats } = await supabase
          .from('provider_treatments')
          .select('id, name, category')
          .eq('provider_id', prov?.id ?? '')
        setTreatments(treats && treats.length > 0 ? (treats as Treatment[]) : DEFAULT_TREATMENTS)
      } catch {
        setTreatments(DEFAULT_TREATMENTS)
      }
    }
    load()
  }, [userId])

  // ── Derived ───────────────────────────────────────────────────────────────

  // Latest date first (descending) — steps 2 & 3 show the most recent date at the
  // top/expanded, older dates under "Other dates" in descending order too.
  const sortedDates = useMemo(() => [...selectedDates].sort((a, b) => b.localeCompare(a)), [selectedDates])

  const datesWithTreatments = useMemo(
    () => sortedDates.filter(d => (dayTreatments[d]?.length ?? 0) > 0),
    [sortedDates, dayTreatments]
  )

  const canNext1 = selectedDates.size > 0
  const canNext2 = datesWithTreatments.length > 0
  const canSave  = useMemo(
    () => datesWithTreatments.some(d => (daySlots[d]?.length ?? 0) > 0),
    [datesWithTreatments, daySlots]
  )

  // ── Calendar handlers ─────────────────────────────────────────────────────

  const toggleDate = async (date: Date) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const key = dateKey(date)
    setSelectedDates(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
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

  // ── Treatment handlers ────────────────────────────────────────────────────

  const toggleTreatment = async (dateStr: string, treatId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const cur  = dayTreatments[dateStr] ?? []
    const next = cur.includes(treatId) ? cur.filter(id => id !== treatId) : [...cur, treatId]
    setDayTreatments(prev => ({ ...prev, [dateStr]: next }))

    // Each SLOT carries its own treatment ids, and the save writes those — not the
    // day-level list. Without reconciling here the two drift apart: changing a day
    // from Nails to Hair left every slot still holding Nails, so the screen showed
    // Hair while the DB was written with Nails.
    setDaySlots(prev => {
      const slots = prev[dateStr]
      if (!slots || slots.length === 0) return prev
      return {
        ...prev,
        [dateStr]: slots.map(s => {
          const kept = s.treatmentIds.filter(id => next.includes(id))
          // Never leave a slot empty — the model's booking screen reads an empty list
          // as "any treatment goes". Fall back to whatever the day still offers.
          return { ...s, treatmentIds: kept.length > 0 ? kept : next }
        }),
      }
    })
  }

  // ── Slot handlers ─────────────────────────────────────────────────────────

  const openAddSlot = async (dateStr: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setEditingSlotId(null)
    setModalStart('09:00')
    setModalEnd('10:00')
    setModalTreatIds(dayTreatments[dateStr] ?? [])
    setModalDate(dateStr)
  }

  const openEditSlot = async (dateStr: string, slot: TimeSlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setEditingSlotId(slot.id)
    setModalStart(slot.startTime)
    setModalEnd(slot.endTime)
    setModalTreatIds(slot.treatmentIds)
    setModalDate(dateStr)
  }

  const saveSlot = async () => {
    if (!modalDate) return
    // A slot with no treatments is what the model's booking screen reads as "any
    // treatment goes", so it must never be saved. This used to `return` silently,
    // which read as a broken Save button — say why instead.
    if (modalTreatIds.length === 0) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      Alert.alert(
        'Pick a treatment',
        'Choose at least one treatment for this time slot, so models know what they can book.',
      )
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const newSlot: TimeSlot = {
      id:           editingSlotId ?? newSlotId(),
      startTime:    modalStart,
      endTime:      modalEnd,
      treatmentIds: modalTreatIds,
    }
    setDaySlots(prev => {
      const existing = prev[modalDate] ?? []
      return {
        ...prev,
        [modalDate!]: editingSlotId
          ? existing.map(s => s.id === editingSlotId ? newSlot : s)
          : [...existing, newSlot],
      }
    })
    setModalDate(null)
  }

  const removeSlot = async (dateStr: string, slotId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setDaySlots(prev => ({
      ...prev,
      [dateStr]: (prev[dateStr] ?? []).filter(s => s.id !== slotId),
    }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const handleSave = async () => {
    if (!providerId) return
    setSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      const datesWithSlots = datesWithTreatments.filter(d => (daySlots[d]?.length ?? 0) > 0)

      // Collect any non-UUID treatment IDs (slug strings from DEFAULT_TREATMENTS)
      // and resolve them to real UUIDs from treatment_categories before saving.
      const allTreatIds = new Set<string>()
      for (const d of datesWithSlots) {
        for (const s of daySlots[d]) {
          for (const id of s.treatmentIds) allTreatIds.add(id)
        }
      }
      const slugsToLookup = [...allTreatIds].filter(id => !UUID_RE.test(id))
      const slugToUuid: Record<string, string> = {}
      if (slugsToLookup.length > 0) {
        const { data: catData } = await supabase
          .from('treatment_categories')
          .select('id, slug')
          .in('slug', slugsToLookup)
        for (const cat of (catData ?? []) as any[]) {
          slugToUuid[cat.slug as string] = cat.id as string
        }
      }
      // A slug with no matching treatment_categories row can't be stored. Dropping it
      // silently used to leave active_treatments EMPTY, which the model-side booking
      // screen reads as "this slot offers everything" — so surface it instead.
      const unresolved: string[] = []
      const resolveId = (id: string): string | null => {
        if (UUID_RE.test(id)) return id
        const uuid = slugToUuid[id]
        if (!uuid) { unresolved.push(id); return null }
        return uuid
      }

      // Normalize "HH:MM" → "HH:MM:SS" so the payload matches the stored time
      // format and the unique index (provider_id, date, start_time, end_time)
      // detects the conflict. Guard against an already-"HH:MM:SS" value.
      const toHHMMSS = (t: string) => (t.length === 5 ? `${t}:00` : t)

      // Desired set of slots from the current UI state.
      const rows = datesWithSlots.flatMap(d =>
        daySlots[d].map(s => ({
          provider_id:       providerId,
          date:              d,
          start_time:        toHHMMSS(s.startTime),
          end_time:          toHHMMSS(s.endTime),
          active_treatments: s.treatmentIds.map(resolveId).filter(Boolean) as string[],
          // is_taken deliberately OMITTED: it defaults to false on insert, and leaving
          // it out of the payload keeps it out of the ON CONFLICT update below, so
          // re-saving a day can never reset a BOOKED slot back to available.
        }))
      )

      if (unresolved.length > 0) {
        console.warn('availability: unresolved treatment ids dropped:', unresolved)
      }

      // 1) Upsert the desired slots FIRST. Insert new slots; on conflict
      //    (provider_id, date, start_time, end_time) UPDATE, so edits to a slot's
      //    treatments actually persist. (This used to be ignoreDuplicates:true —
      //    DO NOTHING — which meant changing only the treatments on an existing
      //    slot silently saved nothing, leaving days stuck with no treatments.)
      //    is_taken isn't in the payload, so booked slots keep their state.
      //    No blanket delete up front, so if this fails the day is never left emptied.
      if (rows.length > 0) {
        const onConflict = 'provider_id,date,start_time,end_time'
        const { error: upsertErr } = await supabase
          .from('availability')
          .upsert(rows, {
            onConflict,
            ignoreDuplicates: false,
          })
        if (upsertErr) throw upsertErr
      }

      // 2) Delete ONLY the slots the provider actually removed: diff what's now
      //    in the DB for these dates against the desired set. Runs after the
      //    upsert succeeds, so a save failure can't destroy existing slots.
      //    Reconcile EVERY date the provider touched this session — including
      //    dates emptied to zero slots — so a fully-cleared day gets its old
      //    rows deleted (cleared days aren't in datesWithSlots). daySlots keeps
      //    a key for cleared days (empty array); selectedDates covers loaded ones.
      const reconcileDates = Array.from(new Set<string>([
        ...datesWithSlots,
        ...selectedDates,
        ...Object.keys(daySlots),
      ]))

      const { data: existingRows, error: fetchErr } = await supabase
        .from('availability')
        .select('id, date, start_time, end_time')
        .eq('provider_id', providerId)
        .in('date', reconcileDates)
      if (fetchErr) throw fetchErr

      const hhmm = (t: string) => t.substring(0, 5)
      const desiredKeys = new Set(
        rows.map(r => `${r.date}|${hhmm(r.start_time)}|${hhmm(r.end_time)}`)
      )
      const idsToRemove = (existingRows ?? [])
        .filter(r => !desiredKeys.has(
          `${(r.date as string).substring(0, 10)}|${hhmm(r.start_time as string)}|${hhmm(r.end_time as string)}`
        ))
        .map(r => (r as any).id)

      // Protect booked slots: a session referencing an availability row via
      // sessions.availability_id (FK, NO ACTION) blocks its deletion with a 23503.
      // Exclude any removed-slot id a session still references — regardless of status,
      // since the FK cares only that a row references it, not what state it's in.
      let skippedBookedCount = 0
      if (idsToRemove.length > 0) {
        const { data: bookedRows, error: bookedErr } = await supabase
          .from('sessions')
          .select('availability_id')
          .in('availability_id', idsToRemove)
        if (bookedErr) throw bookedErr
        const bookedIds    = new Set((bookedRows ?? []).map((r: any) => r.availability_id))
        const deletableIds = idsToRemove.filter(id => !bookedIds.has(id))
        skippedBookedCount = idsToRemove.length - deletableIds.length

        if (deletableIds.length > 0) {
          const { error: delErr } = await supabase
            .from('availability')
            .delete()
            .in('id', deletableIds)
          if (delErr) throw delErr
        }
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Notify models who have favourited this provider
      try {
        const [{ data: provData }, { data: favData }] = await Promise.all([
          supabase.from('providers').select('name').eq('id', providerId).single(),
          supabase.from('favourites').select('user_id').eq('provider_id', providerId),
        ])
        const providerName = (provData as any)?.name ?? 'A stylist'
        if (favData && (favData as any[]).length > 0) {
          // An availability notification isn't tied to a session — leave session_id
          // null (omitted) so it can't violate notifications_session_id_fkey.
          // TODO(notifications): this best-effort insert can 23503 on some rows — investigate when locking down the notifications table; must never affect save UX.
          const { error } = await supabase.from('notifications').insert(
            (favData as any[]).map(f => ({
              user_id: f.user_id,
              type:    'new_availability',
              title:   'New availability posted',
              body:    `${providerName} has new slots available — tap to view their shop`,
              // provider_id lets the notification tap deep-link to the shop
              // (notificationRouting routes new_availability via data.provider_id).
              data:    { provider_id: providerId },
            }))
          )
          if (error) console.warn('new availability notification failed (non-blocking):', error)
        }
      } catch (e) { console.warn('new availability notification failed (non-blocking):', e) }

      if (skippedBookedCount > 0) {
        Alert.alert(
          'Some slots kept',
          `${skippedBookedCount} slot${skippedBookedCount === 1 ? '' : 's'} couldn't be removed because ${skippedBookedCount === 1 ? 'it has a booking' : 'they have bookings'}. Cancel the booking to free the slot before removing it.`,
          [{ text: 'OK', onPress: () => router.back() }],
        )
      } else {
        Alert.alert(
          'Availability saved ✓',
          'Your available dates and times have been updated.',
          [{ text: 'OK', onPress: () => router.back() }],
        )
      }
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      console.error('availability save failed:', e)
      Alert.alert('Couldn’t save', 'Couldn’t save your availability, please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (step > 1) setStep(s => (s - 1) as 1 | 2 | 3)
    else router.back()
  }

  const goNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setStep(s => (s + 1) as 2 | 3)
  }

  const rows = useMemo(() => calendarRows(viewYear, viewMonth), [viewYear, viewMonth])

  // ── Render ────────────────────────────────────────────────────────────────

  const modalTreats = modalDate
    ? treatments.filter(t => (dayTreatments[modalDate] ?? []).includes(t.id))
    : []

  // Light haptic on expand/collapse of the "Other dates" sections.
  const toggleStep2 = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setStep2Expanded(v => !v)
  }, [])
  const toggleStep3 = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setStep3Expanded(v => !v)
  }, [])

  // One date's treatment card (step 2). Shared by the always-visible nearest date
  // and the collapsed "Other dates" list so the markup can't drift apart.
  const renderTreatmentCard = (dateStr: string) => (
    <View key={dateStr} style={styles.card}>
      <Text style={styles.cardDayLabel}>{formatDayLabel(dateStr)}</Text>
      <View style={styles.chipGrid}>
        {treatments.map(t => {
          const active = (dayTreatments[dateStr] ?? []).includes(t.id)
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
              onPress={() => toggleTreatment(dateStr, t.id)}
              activeOpacity={0.75}
            >
              {active && (
                <Ionicons name="checkmark" size={12} color={Colors.white} style={{ marginRight: 4 }} />
              )}
              <Text style={[
                styles.treatChipText,
                active ? styles.treatChipTextActive : { color },
              ]}>
                {t.name}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )

  // One date's slot card (step 3). Slots sorted by startTime so session-added
  // slots read in time order (DB-loaded ones already are).
  const renderSlotCard = (dateStr: string) => {
    const slots     = [...(daySlots[dateStr] ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
    const dayTreats = treatments.filter(t => (dayTreatments[dateStr] ?? []).includes(t.id))

    return (
      <View key={dateStr} style={styles.card}>
        <Text style={styles.cardDayLabel}>{formatDayLabel(dateStr)}</Text>

        {slots.length === 0 && (
          <Text style={styles.noSlotsHint}>No slots yet — add one below</Text>
        )}

        {slots.map(slot => {
          const slotTreats = dayTreats.filter(t => slot.treatmentIds.includes(t.id))
          return (
            <TouchableOpacity
              key={slot.id}
              style={styles.slotRow}
              onPress={() => openEditSlot(dateStr, slot)}
              activeOpacity={0.85}
            >
              <View style={styles.slotTime}>
                <Ionicons name="time-outline" size={14} color={Colors.muted} />
                <Text style={styles.slotTimeText}>{slot.startTime} – {slot.endTime}</Text>
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
              <TouchableOpacity
                style={styles.slotRemove}
                onPress={() => removeSlot(dateStr, slot.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={20} color={Colors.muted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )
        })}

        <TouchableOpacity
          style={styles.addSlotBtn}
          onPress={() => openAddSlot(dateStr)}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
          <Text style={styles.addSlotText}>Add slot</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Dates for steps 2 & 3, latest-first (see sortedDates). Top card = latest date.
  const step2Dates = sortedDates
  const step3Dates = datesWithTreatments

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          <Text style={styles.backText}>{step > 1 ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <StepIndicator step={step} />
      </View>

      {/* ── Step header ── */}
      <View style={styles.stepHeader}>
        <Text style={styles.stepLabel}>Step {step} of 3</Text>
        <Text style={styles.stepTitle}>
          {step === 1 ? 'Select dates'
         : step === 2 ? 'Choose treatments'
         :              'Set time slots'}
        </Text>
        <Text style={styles.stepSub}>
          {step === 1 ? 'Tap days you\'re available'
         : step === 2 ? 'Tick which treatments to offer each day'
         :              'Add free slots — tap any slot to edit it'}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ════ STEP 1 — CALENDAR ════════════════════════════════════════════ */}
        {step === 1 && (
          <View style={styles.card}>
            {/* Month navigator */}
            <View style={styles.monthNav}>
              <TouchableOpacity style={styles.monthNavBtn} onPress={prevMonth} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={18} color={Colors.warmDark} />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>
                {MONTH_NAMES[viewMonth]} {viewYear}
              </Text>
              <TouchableOpacity style={styles.monthNavBtn} onPress={nextMonth} activeOpacity={0.7}>
                <Ionicons name="chevron-forward" size={18} color={Colors.warmDark} />
              </TouchableOpacity>
            </View>

            {/* Day-of-week headers */}
            <View style={styles.calHeaders}>
              {DAYS_SHORT.map(d => (
                <Text key={d} style={styles.calHeader}>{d}</Text>
              ))}
            </View>

            {/* Date grid */}
            {rows.map((row, ri) => (
              <View key={ri} style={styles.calRow}>
                {row.map((date, ci) => {
                  if (!date) return <View key={ci} style={styles.calCell} />
                  const key        = dateKey(date)
                  const isPast     = key < todayKey
                  const isSelected = selectedDates.has(key)
                  const isToday    = key === todayKey
                  return (
                    <TouchableOpacity
                      key={ci}
                      style={[
                        styles.calCell,
                        isToday    && !isSelected && styles.calCellToday,
                        isSelected && styles.calCellSelected,
                        isPast     && styles.calCellPast,
                      ]}
                      onPress={() => toggleDate(date)}
                      disabled={isPast}
                      activeOpacity={0.75}
                    >
                      <Text style={[
                        styles.calCellText,
                        isToday    && !isSelected && styles.calCellTextToday,
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

            {/* Selection summary */}
            {selectedDates.size > 0 && (
              <View style={styles.selectionBanner}>
                <Ionicons name="calendar-outline" size={14} color={Colors.roseDark} />
                <Text style={styles.selectionText}>
                  {selectedDates.size} {selectedDates.size === 1 ? 'date' : 'dates'} selected
                </Text>
                <TouchableOpacity
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                    setSelectedDates(new Set())
                  }}
                >
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ════ STEP 2 — TREATMENTS PER DAY ════════════════════════════════ */}
        {step === 2 && step2Dates.length > 0 && (
          <>
            {/* Most recently touched date (or nearest) — always visible */}
            {renderTreatmentCard(step2Dates[0])}

            {/* The rest — collapsed behind an "Other dates" toggle */}
            {step2Dates.length > 1 && (
              <>
                <TouchableOpacity style={styles.otherToggle} onPress={toggleStep2} activeOpacity={0.8}>
                  <Text style={styles.otherToggleText}>Other dates ({step2Dates.length - 1})</Text>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={Colors.roseDark}
                    style={{ transform: [{ rotate: step2Expanded ? '180deg' : '0deg' }] }}
                  />
                </TouchableOpacity>
                {step2Expanded && step2Dates.slice(1).map(renderTreatmentCard)}
              </>
            )}
          </>
        )}

        {/* ════ STEP 3 — TIME SLOTS ════════════════════════════════════════ */}
        {step === 3 && step3Dates.length > 0 && (
          <>
            {/* Most recently touched date (or nearest) — always visible */}
            {renderSlotCard(step3Dates[0])}

            {/* The rest — collapsed behind an "Other dates" toggle */}
            {step3Dates.length > 1 && (
              <>
                <TouchableOpacity style={styles.otherToggle} onPress={toggleStep3} activeOpacity={0.8}>
                  <Text style={styles.otherToggleText}>Other dates ({step3Dates.length - 1})</Text>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={Colors.roseDark}
                    style={{ transform: [{ rotate: step3Expanded ? '180deg' : '0deg' }] }}
                  />
                </TouchableOpacity>
                {step3Expanded && step3Dates.slice(1).map(renderSlotCard)}
              </>
            )}
          </>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Bottom action bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {step < 3 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !(step === 1 ? canNext1 : canNext2) && styles.nextBtnDisabled]}
            disabled={!(step === 1 ? canNext1 : canNext2)}
            onPress={goNext}
            activeOpacity={0.9}
          >
            <Text style={styles.nextBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.white} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextBtn, (!canSave || saving) && styles.nextBtnDisabled]}
            disabled={!canSave || saving}
            onPress={handleSave}
            activeOpacity={0.9}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
            <Text style={styles.nextBtnText}>{saving ? 'Saving…' : 'Save & Publish'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Slot picker modal ── */}
      <SlotPickerModal
        visible={!!modalDate}
        dateLabel={modalDate ? formatDayLabel(modalDate) : ''}
        availableTreatments={modalTreats}
        startTime={modalStart}
        endTime={modalEnd}
        selectedTreatIds={modalTreatIds}
        bottomInset={Math.max(insets.bottom, 16)}
        onChangeStart={(t) => {
          setModalStart(t)
          if (TIMES.indexOf(modalEnd) <= TIMES.indexOf(t)) {
            setModalEnd(TIMES[Math.min(TIMES.indexOf(t) + 2, TIMES.length - 1)])
          }
        }}
        onChangeEnd={setModalEnd}
        onToggleTreat={async (id) => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          setModalTreatIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
          )
        }}
        onSave={saveSlot}
        onClose={() => setModalDate(null)}
      />
    </View>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  return (
    <View style={styles.stepIndicator}>
      {([1, 2, 3] as const).map((n, i) => (
        <View key={n} style={styles.stepIndicatorItem}>
          <View style={[
            styles.stepDot,
            step === n && styles.stepDotActive,
            step > n  && styles.stepDotDone,
          ]}>
            {step > n
              ? <Ionicons name="checkmark" size={10} color={Colors.white} />
              : <Text style={[styles.stepDotText, step === n && styles.stepDotTextActive]}>{n}</Text>
            }
          </View>
          {i < 2 && <View style={[styles.stepLine, step > n && styles.stepLineDone]} />}
        </View>
      ))}
    </View>
  )
}

// ── Slot picker modal ─────────────────────────────────────────────────────────

function SlotPickerModal({
  visible,
  dateLabel,
  availableTreatments,
  startTime,
  endTime,
  selectedTreatIds,
  bottomInset,
  onChangeStart,
  onChangeEnd,
  onToggleTreat,
  onSave,
  onClose,
}: {
  visible: boolean
  dateLabel: string
  availableTreatments: Treatment[]
  startTime: string
  endTime: string
  selectedTreatIds: string[]
  bottomInset: number
  onChangeStart: (t: string) => void
  onChangeEnd: (t: string) => void
  onToggleTreat: (id: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const startIdx     = TIMES.indexOf(startTime)
  const validEndTimes = TIMES.slice(startIdx + 1)
  const canSave      = selectedTreatIds.length > 0 && TIMES.indexOf(endTime) > startIdx

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOuter}>
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={[styles.modalSheet, { paddingBottom: bottomInset }]}>
          <View style={styles.modalHandle} />

          <Text style={styles.modalTitle}>{dateLabel}</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {/* Start time */}
            <Text style={styles.modalSectionLabel}>Start time</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.timeRow}
            >
              {TIMES.map(t => {
                const active = t === startTime
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeChip, active && styles.timeChipActive]}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      onChangeStart(t)
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {/* End time */}
            <Text style={styles.modalSectionLabel}>End time</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.timeRow}
            >
              {validEndTimes.map(t => {
                const active = t === endTime
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeChip, active && styles.timeChipActive]}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      onChangeEnd(t)
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>

            {/* Treatments */}
            {availableTreatments.length > 0 && (
              <>
                <Text style={styles.modalSectionLabel}>Treatments available in this slot</Text>
                <View style={styles.chipGrid}>
                  {availableTreatments.map(t => {
                    const active = selectedTreatIds.includes(t.id)
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
                        onPress={() => onToggleTreat(t.id)}
                        activeOpacity={0.75}
                      >
                        {active && (
                          <Ionicons name="checkmark" size={12} color={Colors.white} style={{ marginRight: 4 }} />
                        )}
                        <Text style={[
                          styles.treatChipText,
                          active ? styles.treatChipTextActive : { color },
                        ]}>
                          {t.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}

            <View style={{ height: 8 }} />
          </ScrollView>

          {/* Actions */}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSaveBtn, !canSave && styles.modalSaveBtnDisabled]}
              disabled={!canSave}
              onPress={onSave}
              activeOpacity={0.9}
            >
              <Text style={styles.modalSaveText}>Save slot</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingRight: 12,
  },
  backText: {
    fontSize: 15,
    color: Colors.roseDark,
    fontWeight: '500',
  },

  // Step indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepIndicatorItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    borderColor: Colors.roseDark,
    backgroundColor: Colors.roseDark,
  },
  stepDotDone: {
    borderColor: Colors.roseDark,
    backgroundColor: Colors.roseDark,
  },
  stepDotText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.muted,
  },
  stepDotTextActive: {
    color: Colors.white,
  },
  stepLine: {
    width: 28,
    height: 2,
    backgroundColor: Colors.border,
    marginHorizontal: 4,
  },
  stepLineDone: {
    backgroundColor: Colors.roseDark,
  },

  // Step header
  stepHeader: {
    paddingHorizontal: 20,
    paddingBottom: 16,
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
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.rose,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  stepSub: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
  },

  scroll: { paddingHorizontal: 16 },

  // Card (used in all steps)
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.soft,
  },
  cardDayLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 12,
  },

  // "Other dates" collapsible toggle (steps 2 & 3)
  otherToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 12,
  },
  otherToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.warmDark,
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
  calCellSelected: {
    backgroundColor: Colors.roseDark,
  },
  calCellPast: {
    opacity: 0.3,
  },
  calCellText: {
    fontSize: 14,
    color: Colors.warmDark,
  },
  calCellTextToday: {
    color: Colors.roseDark,
    fontWeight: '700',
  },
  calCellTextSelected: {
    color: Colors.white,
    fontWeight: '700',
  },
  calCellTextPast: {
    color: Colors.muted,
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
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roseDark,
  },
  clearText: {
    fontSize: 13,
    color: Colors.muted,
    fontWeight: '500',
  },

  // Treatments chip grid
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  treatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  treatChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  treatChipTextActive: {
    color: Colors.white,
  },

  // Slots
  noSlotsHint: {
    fontSize: 13,
    color: Colors.muted,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  slotTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 100,
  },
  slotTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  slotStripes: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  slotStripe: {
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  slotStripeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.white,
  },
  slotRemove: {
    padding: 2,
  },
  addSlotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  addSlotText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.roseDark,
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
  nextBtn: {
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Shadow.card,
  },
  nextBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  nextBtnText: {
    color: Colors.white,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },

  // Modal
  modalOuter: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: Fonts.heading,
    fontSize: 19,
    color: Colors.warmDark,
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  modalSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 16,
  },
  timeRow: {
    gap: 6,
    paddingBottom: 4,
  },
  timeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.inputBg,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  timeChipActive: {
    backgroundColor: Colors.rose,
    borderColor: Colors.rose,
  },
  timeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  timeChipTextActive: {
    color: Colors.white,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warmDark,
  },
  modalSaveBtn: {
    flex: 2,
    height: 50,
    borderRadius: Radius.md,
    backgroundColor: Colors.rose,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  modalSaveBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalSaveText: {
    fontSize: 15,
    fontFamily: Fonts.bodyBold,
    color: Colors.white,
  },
})
