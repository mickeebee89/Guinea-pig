import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'

const CONSENT_ITEMS = [
  {
    icon:  'images-outline'            as const,
    title: 'Photo sharing',
    body:  'Any photos you attach will be shared with the provider to help them prepare your treatment.',
  },
  {
    icon:  'person-outline'            as const,
    title: 'Profile visibility',
    body:  'Your name and profile picture will be visible to the provider when you apply.',
  },
  {
    icon:  'calendar-outline'          as const,
    title: 'Attendance commitment',
    body:  'By applying you agree to attend or cancel at least 24 hours in advance.',
  },
  {
    icon:  'heart-outline'             as const,
    title: 'Community standards',
    body:  'You agree to treat providers with respect and follow our community guidelines.',
  },
]

type Props = { onAccept: () => void }

export function ConsentGate({ onAccept }: Props) {
  const [accepted, setAccepted] = useState(false)

  const toggle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setAccepted(a => !a)
  }

  const handleContinue = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onAccept()
  }

  return (
    <View style={styles.container}>
      {/* Shield icon */}
      <View style={styles.iconRow}>
        <View style={styles.iconCircle}>
          <Ionicons name="shield-checkmark-outline" size={32} color={Colors.roseDark} />
        </View>
      </View>

      <Text style={styles.title}>Before you apply</Text>
      <Text style={styles.subtitle}>
        Please read and agree to the following before sending your application.
      </Text>

      {/* Consent items */}
      {CONSENT_ITEMS.map(item => (
        <View key={item.title} style={styles.termCard}>
          <View style={styles.termIcon}>
            <Ionicons name={item.icon} size={20} color={Colors.roseDark} />
          </View>
          <View style={styles.termText}>
            <Text style={styles.termTitle}>{item.title}</Text>
            <Text style={styles.termBody}>{item.body}</Text>
          </View>
        </View>
      ))}

      {/* Checkbox */}
      <TouchableOpacity style={styles.checkRow} onPress={toggle} activeOpacity={0.8}>
        <View style={[styles.checkbox, accepted && styles.checkboxActive]}>
          {accepted && <Ionicons name="checkmark" size={14} color={Colors.white} />}
        </View>
        <Text style={styles.checkLabel}>I have read and agree to the above</Text>
      </TouchableOpacity>

      {/* Continue button */}
      <TouchableOpacity
        style={[styles.continueBtn, !accepted && styles.continueBtnDisabled]}
        disabled={!accepted}
        onPress={handleContinue}
        activeOpacity={0.9}
      >
        <Text style={styles.continueBtnText}>Continue to confirmation</Text>
        <Ionicons name="arrow-forward" size={18} color={Colors.white} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },

  iconRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.softPink + '50',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.softPink,
  },

  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.rose,
    letterSpacing: -0.4,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },

  termCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.soft,
  },
  termIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  termText: { flex: 1 },
  termTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.warmDark,
    marginBottom: 3,
  },
  termBody: {
    fontSize: 13,
    color: Colors.muted,
    lineHeight: 18,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxActive: {
    backgroundColor: Colors.rose,
    borderColor: Colors.rose,
  },
  checkLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.warmDark,
    lineHeight: 20,
  },

  continueBtn: {
    backgroundColor: Colors.rose,
    borderRadius: Radius.lg,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
    ...Shadow.card,
  },
  continueBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.white,
    letterSpacing: -0.2,
  },
})
