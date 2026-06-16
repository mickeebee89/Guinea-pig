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
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/auth'

const LOGO_URI = 'https://res.cloudinary.com/dzbazlq1o/image/upload/f_auto,q_auto/54340_ia8jsd'

export default function LoginScreen() {
  const router = useRouter()
  const { setRole } = useAuth()

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

    const { data: loginData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (authError) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(authError.message)
      setLoading(false)
      return
    }

    // Fetch role and route to the correct screen immediately
    let userRole: string | null = null
    try {
      const { data: ud } = await supabase
        .from('users')
        .select('role')
        .eq('id', loginData.user?.id ?? '')
        .maybeSingle()
      userRole = ud?.role ?? null
    } catch {}

    if (userRole) setRole(userRole as any)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setLoading(false)
    if (userRole === 'provider') {
      router.replace('/(app)/provider-dashboard' as any)
    } else {
      router.replace('/(app)')
    }
  }

  const goSignup = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.replace('/')
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const forgotPassword = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (!email.trim()) {
      setError('Enter your email above first.')
      return
    }
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase())
    setError('')
    alert('Check your email for a reset link.')
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

            {/* Logo mark */}
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
    fontWeight: '500',
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
    shadowColor: Colors.rose,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.muted,
  },
  form: {},
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 20,
    padding: 4,
  },
  forgotText: {
    fontSize: 14,
    color: Colors.roseDark,
    fontWeight: '500',
  },
  submitBtn: { marginBottom: 16 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  switchText: { fontSize: 14, color: Colors.muted },
  switchLink: { fontSize: 14, fontWeight: '600', color: Colors.roseDark },
})
