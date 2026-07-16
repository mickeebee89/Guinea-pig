import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { supabase } from '@/lib/supabase'

const LOGO_URI = 'https://res.cloudinary.com/dzbazlq1o/image/upload/c_fill,g_north,ar_1:1/f_auto,q_auto/54340_ia8jsd'

interface Props {
  onBack: () => void
  onGoLogin: () => void
  initialEmail?: string
}

export default function ForgotPasswordScreen({ onBack, onGoLogin, initialEmail }: Props) {
  const [email, setEmail]     = useState(initialEmail ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  async function handleSend() {
    if (!email.trim()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError('Enter your email')
      return
    }
    if (!email.includes('@')) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError('Enter a valid email')
      return
    }
    setError('')
    setLoading(true)

    // Send them to the web reset page (works whether or not the app is installed).
    // Its URL is registered in Supabase → Auth → URL Configuration → Redirect URLs.
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: 'https://guineapigapp.co.uk/auth/reset' },
    )
    setLoading(false)

    if (resetErr) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError('Could not send the reset email. Please try again.')
      return
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setSent(true)
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onBack()
  }

  const goLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onGoLogin()
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity onPress={goBack} style={styles.back}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>

            <View style={styles.header}>
              <Image source={{ uri: LOGO_URI }} style={styles.logo} resizeMode="cover" />
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.subtitle}>
                {sent
                  ? 'Check your email for the reset link'
                  : "Enter your email and we'll send you a reset link"}
              </Text>
            </View>

            {sent ? (
              <View style={styles.form}>
                <View style={styles.sentBox}>
                  <Text style={styles.sentText}>
                    We've sent a password reset link to{' '}
                    <Text style={styles.sentEmail}>{email.trim().toLowerCase()}</Text>.
                    Open it to choose a new password.
                  </Text>
                </View>
                <Button
                  label="Back to login"
                  onPress={goLogin}
                  haptic="light"
                  style={styles.submitBtn}
                />
              </View>
            ) : (
              <View style={styles.form}>
                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <Input
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />

                <Button
                  label="Send reset link"
                  onPress={handleSend}
                  loading={loading}
                  haptic="success"
                  style={styles.submitBtn}
                />

                <View style={styles.switchRow}>
                  <Text style={styles.switchText}>Remembered it? </Text>
                  <Text style={styles.switchLink} onPress={goLogin}>Log in</Text>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  safe:      { flex: 1 },
  kav:       { flex: 1 },
  scroll:    { paddingHorizontal: 24, paddingBottom: 40 },
  back: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 17,
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
  },
  header: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 36,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 16,
    ...Shadow.card,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 34,
    color: Colors.rose,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.muted,
    fontFamily: Fonts.body,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  form: {},
  errorBox: {
    backgroundColor: Colors.softPink,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: Colors.error, fontSize: 14, fontFamily: Fonts.body },
  sentBox: {
    backgroundColor: Colors.softPink,
    borderRadius: Radius.md,
    padding: 16,
    marginBottom: 20,
  },
  sentText: { color: Colors.warmDark, fontSize: 15, lineHeight: 21, fontFamily: Fonts.body },
  sentEmail: { fontFamily: Fonts.bodyBold, color: Colors.roseDark },
  submitBtn: { marginBottom: 16, borderRadius: Radius.lg },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  switchText: { fontSize: 14, color: Colors.muted, fontFamily: Fonts.body },
  switchLink: { fontSize: 14, color: Colors.roseDark, fontFamily: Fonts.bodyBold },
})
