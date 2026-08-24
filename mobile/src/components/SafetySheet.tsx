import { useState } from 'react'
import {
  View, Text, StyleSheet, Modal, Pressable, ScrollView,
  TextInput, ActivityIndicator, Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Fonts, Radius } from '@/constants/Colors'
import { REPORT_REASONS, EMERGENCY_LINE, reportAcknowledgement, type ReportReason } from '@/lib/reportReasons'
import { reportUser, blockUser, type ReportSubject } from '@/lib/report'

/**
 * Report and block, for chat and for both profile screens.
 *
 * ── TWO SEPARATE ACTIONS, ON PURPOSE ──────────────────────────────────────
 * Neither path goes through the other. You can report without blocking (you may
 * still have an appointment with them, or want them dealt with rather than just
 * hidden) and you can block without reporting (you owe nobody an explanation
 * for not wanting contact). Coupling them raises the cost of the safety action,
 * which is the opposite of what a safety action should cost.
 *
 * The acknowledgement after a report MENTIONS blocking as a next step. That is
 * an offer, not a step — nothing has been blocked at that point.
 *
 * ── IT MUST WORK WHEN THE OTHER PARTY IS GONE ─────────────────────────────
 * Suspended or deleted. Reports outlive accounts by design (migration 0004) and
 * the UI must not be the half that cannot. A suspended user still has a
 * `public.users` row so nothing special happens; a deleted one resolves to
 * nothing and `lib/report.ts` returns a sentence saying so, which is rendered
 * as-is rather than replaced with "something went wrong".
 *
 * ── THE SUBJECT IS PASSED THROUGH UNTOUCHED ───────────────────────────────
 * `{ userId }` or `{ providerId }`, decided by whichever screen renders this.
 * This file never unwraps it, so it cannot mix them up — which matters because
 * `provider/[id].tsx` holds a providers.id and `model/[id].tsx` holds a user id.
 */
export default function SafetySheet({
  visible, onClose, subject, name, reporterId, sessionId = null, alreadyBlocked = false,
}: {
  visible: boolean
  onClose: () => void
  subject: ReportSubject
  name: string
  reporterId: string
  sessionId?: string | null
  alreadyBlocked?: boolean
}) {
  const [mode, setMode]     = useState<'menu' | 'report'>('menu')
  const [chosen, setChosen] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [busy, setBusy]     = useState(false)

  function reset() {
    setMode('menu'); setChosen(null); setDetails(''); setBusy(false)
  }
  function close() { reset(); onClose() }

  async function fileReport(reason: ReportReason) {
    if (busy) return
    setBusy(true)
    const res = await reportUser({ reporterId, subject, reason, details, sessionId })
    setBusy(false)
    if (!res.ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Couldn’t send that', res.message)
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const ack = reportAcknowledgement(reason.code)
    close()
    Alert.alert(ack.title, ack.body)
  }

  function confirmBlock() {
    // The cancellation is named here because it is PERMANENT and this dialog is
    // the only moment anyone can decline it. `cancelled` is terminal in
    // enforce_session_status_transition, so unblocking cannot bring a booking
    // back.
    Alert.alert(
      `Block ${name}?`,
      'They won’t be able to message you, and any upcoming bookings between you will be ' +
      'cancelled. Unblocking later won’t bring those bookings back.\n\n' +
      'Blocking doesn’t tell us anything. If you want someone to look at what happened, ' +
      'report them as well.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
            setBusy(true)
            const res = await blockUser({ blockerId: reporterId, subject })
            setBusy(false)
            if (!res.ok) { Alert.alert('Couldn’t block', res.message); return }
            const n = res.cancelledBookings
            close()
            Alert.alert(
              'Blocked',
              n > 0
                ? `${name} has been blocked, and ${n} upcoming booking${n === 1 ? ' was' : 's were'} cancelled.`
                : `${name} has been blocked.`,
            )
          },
        },
      ],
    )
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : close} />
      <View style={styles.sheet}>
        {mode === 'menu' && (
          <>
            <Text style={styles.title}>{name}</Text>
            <Text style={styles.sub}>
              Reporting and blocking are separate — doing one never does the other.
            </Text>

            <Pressable
              style={styles.row}
              onPress={async () => {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setMode('report')
              }}
            >
              <Ionicons name="flag-outline" size={22} color={Colors.rose} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Report {name}</Text>
                <Text style={styles.rowHint}>Tell us about a safety or conduct concern.</Text>
              </View>
            </Pressable>

            {alreadyBlocked ? (
              <Text style={styles.blockedNote}>
                You’ve already blocked this person, or they’ve blocked you. You can undo your own
                block in Settings.
              </Text>
            ) : (
              <Pressable
                style={styles.row}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  confirmBlock()
                }}
              >
                <Ionicons name="ban-outline" size={22} color={Colors.rose} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Block {name}</Text>
                  <Text style={styles.rowHint}>They won’t be able to message you.</Text>
                </View>
              </Pressable>
            )}
          </>
        )}

        {mode === 'report' && (
          <>
            <Text style={styles.title}>What happened?</Text>
            {/* Above the list, not buried under it. We are not an emergency service. */}
            <Text style={styles.emergency}>{EMERGENCY_LINE}</Text>

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {REPORT_REASONS.map(reason => (
                <Pressable
                  key={reason.code}
                  disabled={busy}
                  style={[styles.row, chosen?.code === reason.code && styles.rowChosen]}
                  onPress={async () => {
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setChosen(reason)
                    // One tap for seven of the eight. Only "Something else"
                    // needs words — which is what makes the Community
                    // Guidelines' "one tap" claim true.
                    if (!reason.requiresDetails) await fileReport(reason)
                  }}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{reason.label}</Text>
                    {!!reason.hint && <Text style={styles.rowHint}>{reason.hint}</Text>}
                  </View>
                </Pressable>
              ))}

              {chosen?.requiresDetails && (
                <View style={styles.detailsWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="Tell us what happened"
                    placeholderTextColor={Colors.muted}
                    value={details}
                    onChangeText={setDetails}
                    multiline
                    maxLength={1000}
                  />
                  <Pressable
                    style={[styles.cta, (!details.trim() || busy) && styles.ctaDisabled]}
                    disabled={!details.trim() || busy}
                    onPress={() => fileReport(chosen)}
                  >
                    {busy
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.ctaText}>Send report</Text>}
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </>
        )}

        <Pressable style={styles.close} onPress={busy ? undefined : close}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(43,37,49,0.45)' },
  sheet: {
    backgroundColor: Colors.cream,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: 20, paddingBottom: 32, maxHeight: '85%',
  },
  title: { fontFamily: Fonts.display, fontSize: 22, color: Colors.warmDark },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.muted, marginTop: 4 },
  emergency: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.rose, marginTop: 6 },
  list: { marginTop: 12 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff', borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 14, paddingHorizontal: 14, marginTop: 8,
  },
  rowChosen: { borderColor: Colors.rose },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.warmDark },
  rowHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.muted, marginTop: 2 },
  blockedNote: {
    fontFamily: Fonts.body, fontSize: 13, color: Colors.muted,
    backgroundColor: Colors.inputBg, borderRadius: Radius.md, padding: 14, marginTop: 8,
  },
  detailsWrap: { marginTop: 12 },
  input: {
    backgroundColor: Colors.inputBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: 12, minHeight: 96, textAlignVertical: 'top',
    fontFamily: Fonts.body, fontSize: 15, color: Colors.warmDark,
  },
  cta: {
    backgroundColor: Colors.rose, borderRadius: Radius.pill,
    paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  close: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  closeText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.muted },
})
