import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { TIMES, Treatment, treatmentColour } from '@/lib/availability'

// Bottom-sheet for adding/editing ONE time slot: its start, its end, and the
// treatments offered IN THAT SLOT. Treatments are per-slot by design (the DB
// stores them that way), so this is the single place they're chosen — shared by
// the bulk-add flow and the per-day editor so the two can't drift apart.

type Props = {
  visible: boolean
  title: string
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
}

export default function SlotPickerModal({
  visible,
  title,
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
}: Props) {
  const startIdx      = TIMES.indexOf(startTime)
  const validEndTimes = TIMES.slice(startIdx + 1)
  // A slot with no treatments would read as "any treatment goes" on the model's
  // booking screen, so it can never be saved.
  const canSave       = selectedTreatIds.length > 0 && TIMES.indexOf(endTime) > startIdx

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOuter}>
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={[styles.modalSheet, { paddingBottom: bottomInset }]}>
          <View style={styles.modalHandle} />

          <Text style={styles.modalTitle}>{title}</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            <Text style={styles.modalSectionLabel}>Start time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
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

            <Text style={styles.modalSectionLabel}>End time</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
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

            {availableTreatments.length > 0 && (
              <>
                <Text style={styles.modalSectionLabel}>Treatments offered in this slot</Text>
                <View style={styles.chipGrid}>
                  {availableTreatments.map(t => {
                    const active = selectedTreatIds.includes(t.id)
                    const color  = treatmentColour(t.category)
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[
                          styles.treatChip,
                          active ? { backgroundColor: color, borderColor: color } : { borderColor: color },
                        ]}
                        onPress={async () => {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                          onToggleTreat(t.id)
                        }}
                        activeOpacity={0.75}
                      >
                        {active && (
                          <Ionicons name="checkmark" size={12} color={Colors.white} style={{ marginRight: 4 }} />
                        )}
                        <Text style={[styles.treatChipText, active ? styles.treatChipTextActive : { color }]}>
                          {t.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                {selectedTreatIds.length === 0 && (
                  <Text style={styles.hint}>Pick at least one treatment to save this slot.</Text>
                )}
              </>
            )}

            <View style={{ height: 8 }} />
          </ScrollView>

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

const styles = StyleSheet.create({
  modalOuter:    { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
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
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: {
    fontFamily: Fonts.heading, fontSize: 19, color: Colors.warmDark,
    marginBottom: 16, letterSpacing: -0.3,
  },
  modalSectionLabel: {
    fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16,
  },
  timeRow:  { gap: 6, paddingBottom: 4 },
  timeChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.md,
    backgroundColor: Colors.inputBg, borderWidth: 1.5, borderColor: Colors.border,
  },
  timeChipActive:     { backgroundColor: Colors.rose, borderColor: Colors.rose },
  timeChipText:       { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.warmDark },
  timeChipTextActive: { color: Colors.white },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  treatChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  treatChipText:       { fontFamily: Fonts.bodyBold, fontSize: 13 },
  treatChipTextActive: { color: Colors.white },
  hint: {
    fontFamily: Fonts.body, fontSize: 12, color: Colors.muted,
    marginTop: 10, fontStyle: 'italic',
  },
  modalActions:  { flexDirection: 'row', gap: 10, paddingTop: 16 },
  modalCancelBtn: {
    flex: 1, height: 50, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  modalCancelText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.warmDark },
  modalSaveBtn: {
    flex: 2, height: 50, borderRadius: Radius.md, backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center', ...Shadow.card,
  },
  modalSaveBtnDisabled: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },
  modalSaveText:        { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },
})
