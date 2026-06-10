import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

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

  // Step 3 – time slots per day
  const [daySlots,       setDaySlots]      = useState<DaySlots>({})

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
        if (prov) setProviderId(prov.id)

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

  const sortedDates = useMemo(() => [...selectedDates].sort(), [selectedDates])

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
    setDayTreatments(prev => {
      const cur = prev[dateStr] ?? []
      return {
        ...prev,
        [dateStr]: cur.includes(treatId) ? cur.filter(id => id !== treatId) : [...cur, treatId],
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
    if (!modalDate || modalTreatIds.length === 0) return
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

  const handleSave = async () => {
    if (!providerId) return
    setSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      const rows = datesWithTreatments
        .filter(d => (daySlots[d]?.length ?? 0) > 0)
        .map(d => ({
          provider_id: providerId,
          date: d,
          slots: daySlots[d].map(s => ({
            start_time:    s.startTime,
            end_time:      s.endTime,
            treatment_ids: s.treatmentIds,
          })),
        }))

      await supabase
        .from('provider_availability')
        .upsert(rows, { onConflict: 'provider_id,date' })

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
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
        {step === 2 && sortedDates.map(dateStr => (
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
        ))}

        {/* ════ STEP 3 — TIME SLOTS ════════════════════════════════════════ */}
        {step === 3 && datesWithTreatments.map(dateStr => {
          const slots       = daySlots[dateStr] ?? []
          const dayTreats   = treatments.filter(t => (dayTreatments[dateStr] ?? []).includes(t.id))

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
        })}

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
  container: { flex: 1, backgroundColor: Colors.cream },

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

  // Card (used in all steps)
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
  cardDayLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.warmDark,
    marginBottom: 12,
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
  nextBtnDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  nextBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700',
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
    fontSize: 17,
    fontWeight: '800',
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
    borderRadius: 12,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  timeChipActive: {
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
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
    borderRadius: 14,
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
    borderRadius: 14,
    backgroundColor: Colors.roseDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.roseDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  modalSaveBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.white,
  },
})
