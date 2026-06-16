import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Colors } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { supabase } from '@/lib/supabase'
import { pendingAuth } from '@/lib/pendingAuth'
import { useAuth } from '@/context/auth'

export default function SignupScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ role?: string }>()
  const { setRole } = useAuth()

  const role = (params.role ?? 'model') as 'model' | 'provider'

  const [firstName, setFirstName]   = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})

  function validate() {
    const e: Record<string, string> = {}
    if (!firstName.trim())    e.firstName   = 'Enter your first name'
    if (!lastInitial.trim())  e.lastInitial = 'Enter your last initial'
    if (lastInitial.length > 1) e.lastInitial = 'Just one letter'
    if (!email.trim())        e.email       = 'Enter your email'
    if (!email.includes('@')) e.email       = 'Enter a valid email'
    if (password.length < 8) e.password    = 'At least 8 characters'
    return e
  }

  async function handleSignup() {
    const e = validate()
    if (Object.keys(e).length) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setErrors(e)
      return
    }
    setErrors({})
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setErrors({ form: error.message })
      setLoading(false)
      return
    }

    // Supabase silently "succeeds" for existing emails but returns no identities — detect this
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setErrors({ form: 'An account with this email already exists. Please log in instead.' })
      setLoading(false)
      return
    }

    if (data.user) {
      const cleanFirst   = firstName.trim()
      const cleanInitial = lastInitial.trim().toUpperCase().charAt(0)

      try {
        await supabase.from('users').insert({
          id:           data.user.id,
          email:        email.trim().toLowerCase(),
          first_name:   cleanFirst,
          last_initial: cleanInitial,
          role,
          region:       'UK',
        })

        if (role === 'provider') {
          await supabase.from('providers').insert({
            user_id:      data.user.id,
            name:         `${cleanFirst} ${cleanInitial}.`,
            is_published: false,
            is_verified:  false,
            rating:       0,
            review_count: 0,
          })
        }
      } catch {}
      // profile inserts failing must not block the auth flow

      setRole(role)
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setLoading(false)

    if (!data.session) {
      // Supabase email confirmation is enabled — hold credentials in memory
      // so the confirm-email screen can verify the user signed in after confirming
      pendingAuth.set(email.trim().toLowerCase(), password)
      router.replace({
        pathname: '/(auth)/confirm-email' as any,
        params:   { email: email.trim().toLowerCase(), role, first: cleanFirst, initial: cleanInitial },
      })
    } else {
      if (role === 'provider') {
        router.replace('/(app)/provider-dashboard' as any)
      } else {
        router.replace('/(app)')
      }
    }
  }

  const goLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.replace('/(auth)/login')
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.back()
  }

  const roleLabel  = role === 'provider' ? 'Stylist' : 'Model'
  const roleColour = role === 'provider' ? Colors.roseDark : Colors.rose

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
            {/* Back */}
            <TouchableOpacity onPress={goBack} style={styles.back}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>

            {/* Header */}
            <View style={styles.header}>
              <View style={[styles.rolePill, { backgroundColor: roleColour }]}>
                <Text style={styles.rolePillText}>{roleLabel}</Text>
              </View>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>
                Join Guinea Pig as a {roleLabel.toLowerCase()} and start connecting.
              </Text>
            </View>

            {/* Form */}
            <View style={styles.form}>
              {errors.form && (
                <View style={styles.formError}>
                  <Text style={styles.formErrorText}>{errors.form}</Text>
                </View>
              )}

              <View style={styles.nameRow}>
                <View style={styles.nameFirst}>
                  <Input
                    label="First name"
                    placeholder="e.g. Emma"
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                    error={errors.firstName}
                  />
                </View>
                <View style={styles.nameInitial}>
                  <Input
                    label="Last initial"
                    placeholder="B"
                    value={lastInitial}
                    onChangeText={t => setLastInitial(t.charAt(0).toUpperCase())}
                    maxLength={1}
                    autoCapitalize="characters"
                    error={errors.lastInitial}
                  />
                </View>
              </View>

              <Input
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.email}
              />

              <Input
                label="Password"
                placeholder="Min. 8 characters"
                value={password}
                onChangeText={setPassword}
                secure
                error={errors.password}
              />

              <Button
                label="Create account"
                onPress={handleSignup}
                loading={loading}
                haptic="success"
                style={styles.submitBtn}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Already have an account? </Text>
                <Text style={styles.switchLink} onPress={goLogin}>Log in</Text>
              </View>

              <Text style={styles.terms}>
                By signing up you agree to our Terms of Service and Privacy Policy.
              </Text>
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
    paddingTop: 12,
    paddingBottom: 28,
  },
  rolePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 12,
  },
  rolePillText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.muted,
    lineHeight: 22,
  },
  form: {},
  formError: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  formErrorText: {
    color: Colors.error,
    fontSize: 14,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameFirst:   { flex: 1 },
  nameInitial: { width: 80 },
  submitBtn: { marginTop: 8, marginBottom: 16 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  switchText: { fontSize: 14, color: Colors.muted },
  switchLink: { fontSize: 14, fontWeight: '600', color: Colors.roseDark },
  terms: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
})
