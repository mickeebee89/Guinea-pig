import { useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius } from '@/constants/Colors'
import { cancelBooking } from '@/lib/cancel'

/**
 * Cancelling a booking. The wording is the whole point of this component.
 *
 * ── CONSEQUENCE, NOT DISCOURAGEMENT ───────────────────────────────────────
 * Someone cancelling at short notice may be doing it because they have changed
 * their mind about being alone with a stranger. That person must not meet a
 * screen implying they are letting anybody down.
 *
 * So this says what will happen and stops: the other person is told, the slot
 * frees up, it cannot be undone. There is no "are you sure", no "please
 * reconsider", no count of how little notice they are giving, and no warning
 * icon. The short-notice line is a fact about the clock, not a judgement about
 * the reader.
 *
 * ── THE PROMPT IS A COURTESY, NOT A DEMAND ────────────────────────────────
 * "Anything you'd like them to know?" rather than "Reason". The box shapes the
 * answer: a field labelled Reason reads as an obligation to justify yourself,
 * and the person least able to do that is the one this flow exists for.
 * Optional, and the label says the other person will see it.
 */
export default function CancelSheet({
  visible, onClose, sessionId, otherName, shortNotice, onCancelled,
}: {
  visible: boolean
  onClose: () => void
  sessionId: string
  otherName: string
  /**
   * Whether the booking is within 24 hours, computed by the CALLER with
   * isShortNotice() at the moment this opens. Not derived here: Date.now() is
   * impure, so computing it during render could flip the line under the reader.
   */
  shortNotice: boolean
  onCancelled: () => void
}) {
  const [reason, setReason]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true); setError(null)
    const res = await cancelBooking(sessionId, reason)
    setBusy(false)
    if (!res.ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(res.error)
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setReason('')
    onCancelled()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Cancel your booking with {otherName}?</Text>

          <Text style={styles.consequence}>
            {shortNotice ? 'This booking is within the next 24 hours. ' : ''}
            {otherName} will be told, and the time slot goes back on their calendar.
            This can’t be undone.
          </Text>

          <Text style={styles.label}>Anything you’d like them to know?</Text>
          <Text style={styles.optional}>Optional. They’ll see this.</Text>
          <TextInput
            value={reason}
            onChangeText={t => setReason(t.slice(0, 280))}
            multiline
            style={styles.input}
            placeholder=""
            placeholderTextColor={Colors.muted}
            editable={!busy}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primary, busy && { opacity: 0.6 }]}
            onPress={submit}
            disabled={busy}
            activeOpacity={0.9}
          >
            {busy
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.primaryText}>Cancel booking</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondary} onPress={onClose} disabled={busy} activeOpacity={0.8}>
            <Text style={styles.secondaryText}>Keep it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43,37,49,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: 20, paddingBottom: 32, gap: 6,
  },
  title: { fontFamily: Fonts.display, fontSize: 20, color: Colors.warmDark },
  consequence: { fontFamily: Fonts.body, fontSize: 14, color: Colors.muted, lineHeight: 20 },
  label: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.warmDark, marginTop: 14 },
  optional: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted },
  input: {
    minHeight: 64, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm,
    backgroundColor: Colors.inputBg, padding: 10, marginTop: 6,
    fontFamily: Fonts.body, fontSize: 14, color: Colors.warmDark,
    textAlignVertical: 'top',
  },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.error, marginTop: 8 },
  primary: {
    marginTop: 16, minHeight: 48, borderRadius: Radius.pill, backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.white },
  secondary: { marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.muted },
})
