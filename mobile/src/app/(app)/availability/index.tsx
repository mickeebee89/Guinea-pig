import { useState, useEffect, useMemo, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import SlotPickerModal from '@/components/SlotPickerModal'
import {
  DAYS_SHORT, MONTH_NAMES,
  Treatment, TimeSlot,
  dateKey, calendarRows, formatDayShort, newSlotId, treatmentColour, findClash,
  loadProviderId, loadTreatments, loadUpcomingDays,
  applySlotsToDates, notifyFavourites,
} from '@/lib/availability'

// Slots are keyed by time+treatments so "shared across all days" can be computed
// honestly rather than assumed.
const slotKey = (s: TimeSlot) =>
  `${s.startTime}|${s.endTime}|${[...s.treatmentIds].sort().join(',')}`
const timeKey = (s: { startTime: string; endTime: string }) => `${s.startTime}|${s.endTime}`

// ADD availability. Two steps: pick the dates, then define the time slots ONCE and
// apply them to every selected date.
//
// This screen is deliberately ADDITIVE — it never deletes. A date that already has
// slots keeps them and gains the new ones. All removal lives in the per-day editor
// (availability/[date].tsx), scoped to a single day, so a bulk action can't wipe
// days the stylist wasn't looking at.

export default function AddAvailabilityScreen() {
  const router  = useRouter()
  const insets  = useSafeAreaInsets()
  const { session } = useAuth()
  const userId  = session?.user?.id

  const todayKey = useMemo(() => dateKey(new Date()), [])
  const now      = useMemo(() => new Date(), [])

  const [step, setStep] = useState<1 | 2>(1)
  const [viewYear,  setViewYear]  = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())

  // Slots per selected date. `activeDay === null` means "All days" — edits then
  // apply to every selected date; picking a date edits only that one.
  const [daySlots,  setDaySlots]  = useState<Record<string, TimeSlot[]>>({})
  const [activeDay, setActiveDay] = useState<string | null>(null)
  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  // Dates that already have availability — dot-marked on the calendar.
  const [existingDates, setExistingDates] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Slot modal
  const [modalOpen,     setModalOpen]     = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [modalStart,    setModalStart]    = useState('09:00')
  const [modalEnd,      setModalEnd]      = useState('10:00')
  const [modalTreatIds, setModalTreatIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!userId) return
      try {
        const pid = await loadProviderId(userId)
        if (cancelled || !pid) return
        setProviderId(pid)
        const [treats, days] = await Promise.all([loadTreatments(pid), loadUpcomingDays(pid)])
        if (cancelled) return
        setTreatments(treats)
        setExistingDates(new Set(Object.keys(days)))
      } catch (e) {
        console.warn('availability: load failed', e)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  // Coming back from the editor, refresh the dots.
  useFocusEffect(useCallback(() => {
    let cancelled = false
    if (providerId) {
      loadUpcomingDays(providerId)
        .then(days => { if (!cancelled) setExistingDates(new Set(Object.keys(days))) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [providerId]))

  const rows = useMemo(() => calendarRows(viewYear, viewMonth), [viewYear, viewMonth])
  const sortedSelected = useMemo(() => [...selectedDates].sort(), [selectedDates])

  // Slots identical across EVERY selected day — what "All days" shows and edits.
  const sharedSlots = useMemo(() => {
    if (sortedSelected.length === 0) return []
    const first = daySlots[sortedSelected[0]] ?? []
    return first.filter(s =>
      sortedSelected.every(d => (daySlots[d] ?? []).some(o => slotKey(o) === slotKey(s))))
  }, [daySlots, sortedSelected])

  // True when at least one day has something the others don't — so "All days"
  // can say so rather than quietly hiding it.
  const diverged = useMemo(
    () => sortedSelected.some(d => (daySlots[d] ?? []).length !== sharedSlots.length),
    [daySlots, sortedSelected, sharedSlots],
  )

  const visibleSlots = activeDay === null ? sharedSlots : (daySlots[activeDay] ?? [])
  const totalSlots   = useMemo(
    () => sortedSelected.reduce((n, d) => n + (daySlots[d] ?? []).length, 0),
    [daySlots, sortedSelected],
  )

  // ── Handlers ────────────────────────────────────────────────────────────────

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

  const goEditExisting = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.push('/(app)/availability/days' as any)
  }

  const openAddSlot = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setEditingSlotId(null)
    setModalStart('09:00')
    setModalEnd('10:00')
    setModalTreatIds([])
    setModalOpen(true)
  }

  const openEditSlot = async (slot: TimeSlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setEditingSlotId(slot.id)
    setModalStart(slot.startTime)
    setModalEnd(slot.endTime)
    setModalTreatIds(slot.treatmentIds)
    setModalOpen(true)
  }

  const saveSlot = async () => {
    const candidate = { startTime: modalStart, endTime: modalEnd }

    // Overlapping slots would let the stylist be booked twice for the same hour.
    // Check every day this edit will touch, and name the day that clashes.
    const targets = activeDay === null ? sortedSelected : [activeDay]
    for (const d of targets) {
      const existing = daySlots[d] ?? []
      const ignoreId = activeDay === null
        ? (existing.find(s => s.id === editingSlotId) ?? existing.find(s => timeKey(s) === timeKey(candidate)))?.id
        : editingSlotId
      const clash = findClash(existing, candidate, ignoreId)
      if (clash) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        Alert.alert(
          'Times overlap',
          `${formatDayShort(d)} already has ${clash.startTime}–${clash.endTime}. Time slots can't overlap — pick a different time.`,
        )
        return
      }
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const sortSlots = (arr: TimeSlot[]) =>
      [...arr].sort((a, b) => a.startTime.localeCompare(b.startTime))

    setDaySlots(prev => {
      const next = { ...prev }
      for (const d of targets) {
        const existing = prev[d] ?? []
        // In All-days mode the same logical slot has a different id on each day,
        // so match on time rather than id.
        const replacing = activeDay === null
          ? existing.find(s => s.id === editingSlotId || (editingSlotId && timeKey(s) === timeKey(candidate)))
          : existing.find(s => s.id === editingSlotId)
        const slot: TimeSlot = {
          id:           replacing?.id ?? newSlotId(),
          dbId:         replacing?.dbId ?? null,
          startTime:    modalStart,
          endTime:      modalEnd,
          treatmentIds: modalTreatIds,
        }
        next[d] = sortSlots(
          replacing
            ? existing.map(s => (s.id === replacing.id ? slot : s))
            : [...existing, slot],
        )
      }
      return next
    })
    setModalOpen(false)
  }

  const removeSlot = async (slot: TimeSlot) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const targets = activeDay === null ? sortedSelected : [activeDay]
    setDaySlots(prev => {
      const next = { ...prev }
      for (const d of targets) {
        next[d] = (prev[d] ?? []).filter(s =>
          activeDay === null ? timeKey(s) !== timeKey(slot) : s.id !== slot.id)
      }
      return next
    })
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (step === 2) setStep(1)
    else router.back()
  }

  const goNext = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    // Give every selected day an entry, dropping any dates deselected since last time.
    setDaySlots(prev => {
      const next: Record<string, TimeSlot[]> = {}
      for (const d of sortedSelected) next[d] = prev[d] ?? []
      return next
    })
    setActiveDay(null)
    setStep(2)
  }

  const apply = async () => {
    if (!providerId) return
    setSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      // Each day writes its OWN slots, so days that were fine-tuned keep their
      // differences. Days left empty are simply skipped.
      for (const d of sortedSelected) {
        const s = daySlots[d] ?? []
        if (s.length > 0) await applySlotsToDates(providerId, [d], s)
      }
      await notifyFavourites(providerId)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      const dayCount = sortedSelected.filter(d => (daySlots[d] ?? []).length > 0).length
      Alert.alert(
        'Availability added ✓',
        `${totalSlots} time slot${totalSlots === 1 ? '' : 's'} added across ${dayCount} day${dayCount === 1 ? '' : 's'}. You can fine-tune any single day from the list.`,
        [{ text: 'OK', onPress: () => router.replace('/(app)/availability/days' as any) }],
      )
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      console.error('availability: apply failed', e)
      Alert.alert('Couldn’t save', 'Couldn’t add your availability, please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          <Text style={styles.backText}>{step > 1 ? 'Back' : 'Cancel'}</Text>
        </TouchableOpacity>
        <StepIndicator step={step} />
      </View>

      <View style={styles.stepHeader}>
        <Text style={styles.stepLabel}>Step {step} of 2</Text>
        <Text style={styles.stepTitle}>{step === 1 ? 'Add dates' : 'Set your times'}</Text>
        <Text style={styles.stepSub}>
          {step === 1
            ? 'Tap the days you\'re available. Days you\'ve already set up are marked with a dot.'
            : `These times will be added to all ${sortedSelected.length} selected ${sortedSelected.length === 1 ? 'day' : 'days'}.`}
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── STEP 1 — calendar ── */}
        {step === 1 && (
          <>
            <View style={styles.card}>
              <View style={styles.monthNav}>
                <TouchableOpacity style={styles.monthNavBtn} onPress={prevMonth} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={18} color={Colors.warmDark} />
                </TouchableOpacity>
                <Text style={styles.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
                <TouchableOpacity style={styles.monthNavBtn} onPress={nextMonth} activeOpacity={0.7}>
                  <Ionicons name="chevron-forward" size={18} color={Colors.warmDark} />
                </TouchableOpacity>
              </View>

              <View style={styles.calHeaders}>
                {DAYS_SHORT.map(d => <Text key={d} style={styles.calHeader}>{d}</Text>)}
              </View>

              {rows.map((row, ri) => (
                <View key={ri} style={styles.calRow}>
                  {row.map((date, ci) => {
                    if (!date) return <View key={ci} style={styles.calCell} />
                    const key        = dateKey(date)
                    const isPast     = key < todayKey
                    const isSelected = selectedDates.has(key)
                    const isToday    = key === todayKey
                    const hasSlots   = existingDates.has(key)
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
                        {hasSlots && !isSelected && <View style={styles.calDot} />}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              ))}

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

            {/* Edit path — deliberately separate from the calendar, so tapping a
               date always means "add" and never "edit". */}
            <TouchableOpacity style={styles.linkBtn} onPress={goEditExisting} activeOpacity={0.85}>
              <View style={styles.linkIcon}>
                <Ionicons name="create-outline" size={20} color={Colors.roseDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkTitle}>Edit existing days</Text>
                <Text style={styles.linkSub}>Change treatments or times on a day you've set up</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
            </TouchableOpacity>
          </>
        )}

        {/* ── STEP 2 — define slots once ── */}
        {step === 2 && (
          <>
            {/* Which day am I editing? "All days" edits every selected date at
               once; tapping a date narrows to just that one. */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Editing</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChips}>
                <DayChip
                  label={`All ${sortedSelected.length} days`}
                  count={sharedSlots.length}
                  active={activeDay === null}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setActiveDay(null)
                  }}
                />
                {sortedSelected.map(d => (
                  <DayChip
                    key={d}
                    label={formatDayShort(d)}
                    count={(daySlots[d] ?? []).length}
                    active={activeDay === d}
                    onPress={async () => {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setActiveDay(d)
                    }}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>
                {activeDay === null ? 'Times for every selected day' : `Times for ${formatDayShort(activeDay)}`}
              </Text>

              {activeDay === null && diverged && (
                <View style={styles.noteRow}>
                  <Ionicons name="information-circle-outline" size={15} color={Colors.roseDark} />
                  <Text style={styles.noteText}>
                    Some days have their own times — tap a date above to see them.
                  </Text>
                </View>
              )}

              {visibleSlots.length === 0 ? (
                <Text style={styles.noSlotsHint}>
                  {activeDay === null && diverged
                    ? 'No times are shared by every day. Tap a date above to edit it.'
                    : 'No slots yet — add one below. Each slot has its own times and its own treatments.'}
                </Text>
              ) : (
                visibleSlots.map(s => (
                  <SlotRow
                    key={s.id}
                    slot={s}
                    treatments={treatments}
                    onPress={() => openEditSlot(s)}
                    onRemove={() => removeSlot(s)}
                  />
                ))
              )}
              <TouchableOpacity style={styles.addSlotBtn} onPress={openAddSlot} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
                <Text style={styles.addSlotText}>
                  {activeDay === null ? 'Add time slot to all days' : `Add time slot to ${formatDayShort(activeDay)}`}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.footnote}>
              Days you've already set up keep their existing slots — these are added on top.
            </Text>
          </>
        )}

        <View style={{ height: 12 }} />
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {step === 1 ? (
          <TouchableOpacity
            style={[styles.primaryBtn, selectedDates.size === 0 && styles.primaryBtnDisabled]}
            disabled={selectedDates.size === 0}
            onPress={goNext}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>
              {selectedDates.size === 0
                ? 'Select dates to continue'
                : `Set times for ${selectedDates.size} ${selectedDates.size === 1 ? 'day' : 'days'}`}
            </Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.white} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, (totalSlots === 0 || saving) && styles.primaryBtnDisabled]}
            disabled={totalSlots === 0 || saving}
            onPress={apply}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>
              {saving
                ? 'Saving…'
                : totalSlots === 0
                  ? 'Add a time slot'
                  : `Add ${totalSlots} time slot${totalSlots === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <SlotPickerModal
        visible={modalOpen}
        title={
          (editingSlotId ? 'Edit slot · ' : 'New slot · ') +
          (activeDay === null ? `all ${sortedSelected.length} days` : formatDayShort(activeDay))
        }
        availableTreatments={treatments}
        startTime={modalStart}
        endTime={modalEnd}
        selectedTreatIds={modalTreatIds}
        bottomInset={insets.bottom + 12}
        onChangeStart={t => {
          setModalStart(t)
          // Keep end after start.
          if (t >= modalEnd) {
            const [h, m] = t.split(':').map(Number)
            const endH = Math.min(h + 1, 22)
            setModalEnd(`${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
          }
        }}
        onChangeEnd={setModalEnd}
        onToggleTreat={id =>
          setModalTreatIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
        onSave={saveSlot}
        onClose={() => setModalOpen(false)}
      />
    </View>
  )
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function SlotRow({
  slot, treatments, onPress, onRemove,
}: {
  slot: TimeSlot
  treatments: Treatment[]
  onPress: () => void
  onRemove: () => void
}) {
  const names = slot.treatmentIds
    .map(id => treatments.find(t => t.id === id))
    .filter(Boolean) as Treatment[]

  return (
    <TouchableOpacity style={styles.slotRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.slotTime}>
        <Ionicons name="time-outline" size={14} color={Colors.warmDark} />
        <Text style={styles.slotTimeText}>{slot.startTime}–{slot.endTime}</Text>
      </View>
      <View style={styles.slotStripes}>
        {names.map(t => (
          <View key={t.id} style={[styles.slotStripe, { backgroundColor: treatmentColour(t.category) }]}>
            <Text style={styles.slotStripeText}>{t.name}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={styles.slotRemove} onPress={onRemove} hitSlop={8}>
        <Ionicons name="close-circle" size={20} color={Colors.muted} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

function DayChip({
  label, count, active, onPress,
}: {
  label: string
  count: number
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.dateChip, active && styles.dateChipActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>{label}</Text>
      {count > 0 && (
        <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
          <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <View style={styles.stepIndicator}>
      {[1, 2].map(n => (
        <View key={n} style={styles.stepIndicatorItem}>
          <View style={[
            styles.stepDot,
            step === n && styles.stepDotActive,
            step > n   && styles.stepDotDone,
          ]}>
            {step > n
              ? <Ionicons name="checkmark" size={14} color={Colors.white} />
              : <Text style={[styles.stepDotText, step === n && styles.stepDotTextActive]}>{n}</Text>}
          </View>
          {n < 2 && <View style={[styles.stepLine, step > n && styles.stepLineDone]} />}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: 12 },
  backText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.roseDark },

  stepIndicator:     { flexDirection: 'row', alignItems: 'center' },
  stepIndicatorItem: { flexDirection: 'row', alignItems: 'center' },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive:     { borderColor: Colors.roseDark, backgroundColor: Colors.roseDark },
  stepDotDone:       { borderColor: Colors.roseDark, backgroundColor: Colors.roseDark },
  stepDotText:       { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.muted },
  stepDotTextActive: { color: Colors.white },
  stepLine:          { width: 28, height: 2, backgroundColor: Colors.border, marginHorizontal: 4 },
  stepLineDone:      { backgroundColor: Colors.roseDark },

  stepHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  stepLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.rose,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  stepTitle: { fontFamily: Fonts.display, fontSize: 30, color: Colors.rose, letterSpacing: -0.5, marginBottom: 4 },
  stepSub:   { fontFamily: Fonts.body, fontSize: 14, color: Colors.muted, lineHeight: 20 },

  scroll: { paddingHorizontal: 16 },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: Colors.border, ...Shadow.soft,
  },
  cardLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },

  // Calendar
  monthNav:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  monthNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  monthTitle:  { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.warmDark },
  calHeaders:  { flexDirection: 'row', marginBottom: 6 },
  calHeader: {
    flex: 1, textAlign: 'center', fontFamily: Fonts.bodyBold, fontSize: 11,
    color: Colors.muted, textTransform: 'uppercase',
  },
  calRow:  { flexDirection: 'row', marginBottom: 4 },
  calCell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  calCellToday:        { borderWidth: 1.5, borderColor: Colors.rose },
  calCellSelected:     { backgroundColor: Colors.roseDark },
  calCellPast:         { opacity: 0.3 },
  calCellText:         { fontFamily: Fonts.body, fontSize: 14, color: Colors.warmDark },
  calCellTextToday:    { color: Colors.roseDark, fontFamily: Fonts.bodyBold },
  calCellTextSelected: { color: Colors.white, fontFamily: Fonts.bodyBold },
  calCellTextPast:     { color: Colors.muted },
  calDot: {
    position: 'absolute', bottom: 5, width: 4, height: 4,
    borderRadius: 2, backgroundColor: Colors.rose,
  },
  selectionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  selectionText: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.roseDark },
  clearText:     { fontFamily: Fonts.body, fontSize: 13, color: Colors.muted },

  // Edit-existing link
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.white, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.soft,
  },
  linkIcon: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  linkTitle: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.warmDark },
  linkSub:   { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: 2 },

  // Day selector chips
  dateChips: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  dateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.inputBg, borderRadius: 20,
    paddingHorizontal: 13, paddingVertical: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  dateChipActive:     { backgroundColor: Colors.roseDark, borderColor: Colors.roseDark },
  dateChipText:       { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.roseDark },
  dateChipTextActive: { color: Colors.white },
  chipBadge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
  },
  chipBadgeActive:     { backgroundColor: 'rgba(255,255,255,0.28)' },
  chipBadgeText:       { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.roseDark },
  chipBadgeTextActive: { color: Colors.white },

  noteRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: Colors.inputBg, borderRadius: 10,
    padding: 10, marginBottom: 10,
  },
  noteText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.roseDark, lineHeight: 17 },

  // Slots
  noSlotsHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.muted, fontStyle: 'italic', marginBottom: 10 },
  slotRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.inputBg,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, gap: 8,
  },
  slotTime:     { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 100 },
  slotTimeText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.warmDark },
  slotStripes:  { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  slotStripe:   { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  slotStripeText: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.white },
  slotRemove:   { padding: 2 },
  addSlotBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4, paddingVertical: 8, alignSelf: 'flex-start',
  },
  addSlotText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.roseDark },

  footnote: {
    fontFamily: Fonts.body, fontSize: 12, color: Colors.muted,
    lineHeight: 18, paddingHorizontal: 4,
  },

  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 6,
  },
  primaryBtn: {
    backgroundColor: Colors.rose, borderRadius: Radius.lg, height: 54,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, ...Shadow.card,
  },
  primaryBtnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  primaryBtnText:     { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 16, letterSpacing: -0.2 },
})
