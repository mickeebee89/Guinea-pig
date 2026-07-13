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
  Alert,
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
  onGoSignup: () => void
}

export default function LoginScreen({ onBack, onGoSignup }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleLogin() {
    if (!email.trim() || !password) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError('Please enter your email and password.')
      return
    }
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(authError.message)
      setLoading(false)
      return
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setLoading(false)
    // onAuthStateChange fires SIGNED_IN → AppEntry renders the app Stack automatically.
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onBack()
  }

  const goSignup = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onGoSignup()
  }

  const forgotPassword = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!email.trim()) {
      setError('Enter your email above first.')
      return
    }
    // Send them to the web reset page (works whether or not the app is installed).
    // Its URL must be in Supabase → Auth → URL Configuration → Redirect URLs.
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: 'https://guineapigapp.co.uk/auth/reset' },
    )
    setError('')
    if (resetErr) {
      Alert.alert('Something went wrong', 'Could not send the reset email. Please try again.')
      return
    }
    Alert.alert('Check your email', 'We\'ve sent you a link to reset your password.')
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
              <Image
                source={{ uri: LOGO_URI }}
                style={styles.logo}
                resizeMode="cover"
              />
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Log in to your Guinea Pig account</Text>
            </View>

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

              <Input
                label="Password"
                placeholder="Your password"
                value={password}
                onChangeText={setPassword}
                secure
              />

              <TouchableOpacity onPress={forgotPassword} style={styles.forgotRow}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>

              <Button
                label="Log in"
                onPress={handleLogin}
                loading={loading}
                haptic="success"
                style={styles.submitBtn}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Don't have an account? </Text>
                <Text style={styles.switchLink} onPress={goSignup}>Sign up</Text>
              </View>
            </View>
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
  subtitle: { fontSize: 15, color: Colors.muted, fontFamily: Fonts.body },
  form: {},
  errorBox: {
    backgroundColor: Colors.softPink,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: Colors.error, fontSize: 14, fontFamily: Fonts.body },
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 20,
    padding: 4,
  },
  forgotText: {
    fontSize: 14,
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
  },
  submitBtn: { marginBottom: 16, borderRadius: Radius.lg },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  switchText: { fontSize: 14, color: Colors.muted, fontFamily: Fonts.body },
  switchLink: { fontSize: 14, color: Colors.roseDark, fontFamily: Fonts.bodyBold },
})
