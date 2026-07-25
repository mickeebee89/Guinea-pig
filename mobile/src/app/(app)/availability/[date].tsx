import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import ScreenDecor from '@/components/ScreenDecor'
import LoadErrorState from '@/components/LoadErrorState'
import SlotPickerModal from '@/components/SlotPickerModal'
import {
  Treatment, TimeSlot,
  formatDayLabel, newSlotId, treatmentColour,
  loadProviderId, loadTreatments, loadDay,
  saveDay, deleteDay, notifyFavourites,
} from '@/lib/availability'

// Edit ONE day. The date is named prominently at the top and is fixed for the whole
// screen, so there is never any ambiguity about which day is being changed.
//
// Each slot carries its OWN times and its OWN treatments — that's how the DB stores
// it, and having no second (day-level) copy is what stops the two drifting apart.
// Saving is scoped to this single date, so it can't affect any other day.

export default function EditDayScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session } = useAuth()
  const userId = session?.user?.id
  const { date } = useLocalSearchParams<{ date: string }>()

  const [providerId, setProviderId] = useState<string | null>(null)
  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [slots,      setSlots]      = useState<TimeSlot[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [dirty,      setDirty]      = useState(false)

  const [modalOpen,     setModalOpen]     = useState(false)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [modalStart,    setModalStart]    = useState('09:00')
  const [modalEnd,      setModalEnd]      = useState('10:00')
  const [modalTreatIds, setModalTreatIds] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!userId || !date) { setLoading(false); return }
    setLoading(true)
    setLoadError(false)
    try {
      const pid = await loadProviderId(userId)
      if (!pid) { setLoadError(true); return }
      setProviderId(pid)
      const [treats, daySlots] = await Promise.all([loadTreatments(pid), loadDay(pid, date)])
      setTreatments(treats)
      setSlots(daySlots)
      setDirty(false)
    } catch (e) {
      console.warn('edit day: load failed', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [userId, date])

  useEffect(() => { load() }, [load])

  // ── Slot handlers ───────────────────────────────────────────────────────────

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
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setSlots(prev => {
      const existing = prev.find(s => s.id === editingSlotId)
      const next: TimeSlot = {
        id:           editingSlotId ?? newSlotId(),
        dbId:         existing?.dbId ?? null,
        startTime:    modalStart,
        endTime:      modalEnd,
        treatmentIds: modalTreatIds,
      }
      const updated = editingSlotId
        ? prev.map(s => (s.id === editingSlotId ? next : s))
        : [...prev, next]
      return [...updated].sort((a, b) => a.startTime.localeCompare(b.startTime))
    })
    setDirty(true)
    setModalOpen(false)
  }

  const removeSlot = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSlots(prev => prev.filter(s => s.id !== id))
    setDirty(true)
  }

  // ── Save / delete ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!providerId || !date) return
    setSaving(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      const { skippedBooked } = await saveDay(providerId, date, slots)
      await notifyFavourites(providerId)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (skippedBooked > 0) {
        Alert.alert(
          'Saved — some slots kept',
          `${skippedBooked} slot${skippedBooked === 1 ? ' is' : 's are'} booked and ${skippedBooked === 1 ? 'was' : 'were'} kept. Cancel the booking first if you need to remove ${skippedBooked === 1 ? 'it' : 'them'}.`,
          [{ text: 'OK', onPress: () => router.back() }],
        )
      } else {
        router.back()
      }
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      console.error('edit day: save failed', e)
      Alert.alert('Couldn’t save', 'Couldn’t save this day, please try again.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteDay = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    Alert.alert(
      'Remove this day?',
      `This removes all your time slots on ${date ? formatDayLabel(date) : 'this day'}. Slots that already have a booking will be kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove day',
          style: 'destructive',
          onPress: async () => {
            if (!providerId || !date) return
            setSaving(true)
            try {
              const { skippedBooked } = await deleteDay(providerId, date)
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              if (skippedBooked > 0) {
                Alert.alert(
                  'Some slots kept',
                  `${skippedBooked} slot${skippedBooked === 1 ? ' is' : 's are'} booked, so ${skippedBooked === 1 ? 'it was' : 'they were'} kept. Cancel the booking first to remove ${skippedBooked === 1 ? 'it' : 'them'}.`,
                  [{ text: 'OK', onPress: () => router.back() }],
                )
              } else {
                router.back()
              }
            } catch (e) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
              console.error('edit day: delete failed', e)
              Alert.alert('Couldn’t remove', 'Couldn’t remove this day, please try again.')
            } finally {
              setSaving(false)
            }
          },
        },
      ],
    )
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!dirty) { router.back(); return }
    Alert.alert('Discard changes?', 'You have unsaved changes on this day.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ])
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenDecor />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* The date, stated plainly and fixed for the whole screen. */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Editing</Text>
        <Text style={styles.headerDate}>{date ? formatDayLabel(date) : ''}</Text>
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator color={Colors.rose} /></View>
      ) : loadError ? (
        <LoadErrorState onRetry={load} />
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scroll, { paddingBottom: 20 }]}
          >
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Time slots</Text>
              {slots.length === 0 ? (
                <Text style={styles.noSlotsHint}>
                  No time slots on this day. Add one, or remove the day entirely.
                </Text>
              ) : (
                slots.map(slot => {
                  const names = slot.treatmentIds
                    .map(id => treatments.find(t => t.id === id))
                    .filter(Boolean) as Treatment[]
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      style={styles.slotRow}
                      onPress={() => openEditSlot(slot)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.slotTime}>
                        <Ionicons name="time-outline" size={14} color={Colors.warmDark} />
                        <Text style={styles.slotTimeText}>{slot.startTime}–{slot.endTime}</Text>
                      </View>
                      <View style={styles.slotStripes}>
                        {names.length === 0 ? (
                          <Text style={styles.slotNoTreat}>No treatments</Text>
                        ) : names.map(t => (
                          <View
                            key={t.id}
                            style={[styles.slotStripe, { backgroundColor: treatmentColour(t.category) }]}
                          >
                            <Text style={styles.slotStripeText}>{t.name}</Text>
                          </View>
                        ))}
                      </View>
                      <TouchableOpacity
                        style={styles.slotRemove}
                        onPress={() => removeSlot(slot.id)}
                        hitSlop={8}
                      >
                        <Ionicons name="close-circle" size={20} color={Colors.muted} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  )
                })
              )}

              <TouchableOpacity style={styles.addSlotBtn} onPress={openAddSlot} activeOpacity={0.7}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.roseDark} />
                <Text style={styles.addSlotText}>Add time slot</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.footnote}>
              Each slot has its own treatments, so you can offer different things at different times.
            </Text>

            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={confirmDeleteDay}
              disabled={saving}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={17} color={Colors.error} />
              <Text style={styles.deleteText}>Remove this day</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
              disabled={saving}
              onPress={handleSave}
              activeOpacity={0.9}
            >
              <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <SlotPickerModal
        visible={modalOpen}
        title={editingSlotId ? 'Edit time slot' : 'New time slot'}
        availableTreatments={treatments}
        startTime={modalStart}
        endTime={modalEnd}
        selectedTreatIds={modalTreatIds}
        bottomInset={insets.bottom + 12}
        onChangeStart={t => {
          setModalStart(t)
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centre:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topBar:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  backBtn:  { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: 12 },
  backText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.roseDark },

  header:      { paddingHorizontal: 20, paddingBottom: 16 },
  headerLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.rose,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  headerDate: { fontFamily: Fonts.display, fontSize: 27, color: Colors.rose, letterSpacing: -0.5 },

  scroll: { paddingHorizontal: 16 },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: Colors.border, ...Shadow.soft,
  },
  cardLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },

  noSlotsHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.muted, fontStyle: 'italic', marginBottom: 10 },
  slotRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.inputBg,
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, gap: 8,
  },
  slotTime:       { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 100 },
  slotTimeText:   { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.warmDark },
  slotStripes:    { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  slotStripe:     { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  slotStripeText: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.white },
  slotNoTreat:    { fontFamily: Fonts.body, fontSize: 11, color: Colors.muted, fontStyle: 'italic' },
  slotRemove:     { padding: 2 },
  addSlotBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4, paddingVertical: 8, alignSelf: 'flex-start',
  },
  addSlotText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.roseDark },

  footnote: {
    fontFamily: Fonts.body, fontSize: 12, color: Colors.muted,
    lineHeight: 18, paddingHorizontal: 4, marginBottom: 20,
  },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 13, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.error + '55', backgroundColor: Colors.white,
  },
  deleteText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.error },

  bottomBar: {
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 6,
  },
  primaryBtn: {
    backgroundColor: Colors.rose, borderRadius: Radius.lg, height: 54,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...Shadow.card,
  },
  primaryBtnDisabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  primaryBtnText:     { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 16, letterSpacing: -0.2 },
})
