import { useState, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { supabase } from '@/lib/supabase'
import { pendingAuth } from '@/lib/pendingAuth'

const TERMS_URL   = 'https://guineapigapp.co.uk/terms'
const PRIVACY_URL = 'https://guineapigapp.co.uk/privacy'

interface ConfirmParams {
  email: string
  role: string
  first: string
  initial: string
}

interface Props {
  role: 'model' | 'provider'
  onBack: () => void
  onGoLogin: () => void
  onNeedConfirmation: (params: ConfirmParams) => void
}

export default function SignupScreen({ role, onBack, onGoLogin, onNeedConfirmation }: Props) {
  const [firstName, setFirstName]     = useState('')
  const [lastInitial, setLastInitial] = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [errors, setErrors]           = useState<Record<string, string>>({})
  const [cooldown, setCooldown]       = useState(0)

  const toggleAge = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setAgeConfirmed(a => !a)
  }

  const toggleTerms = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setTermsAccepted(a => !a)
  }

  const openLegal = (url: string) => { Linking.openURL(url) }

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function validate() {
    const e: Record<string, string> = {}
    if (!firstName.trim())       e.firstName   = 'Enter your first name'
    if (!lastInitial.trim())     e.lastInitial = 'Enter your last initial'
    if (lastInitial.length > 1)  e.lastInitial = 'Just one letter'
    if (!email.trim())           e.email       = 'Enter your email'
    if (!email.includes('@'))    e.email       = 'Enter a valid email'
    if (password.length < 8)     e.password    = 'At least 8 characters'
    if (!ageConfirmed)           e.age         = 'You must confirm you are 18 or over'
    if (!termsAccepted)          e.terms       = 'Please agree to the Terms and Privacy Policy'
    return e
  }

  async function handleSignup() {
    if (cooldown > 0) return
    const e = validate()
    if (Object.keys(e).length) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setErrors(e)
      return
    }
    setErrors({})
    setLoading(true)
    setCooldown(60)

    const cleanFirst   = firstName.trim()
    const cleanInitial = lastInitial.trim().toUpperCase().charAt(0)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      // Persist name into user_metadata too, so a later login self-heal of a
      // half-created account can recreate the users row with the real name
      // instead of a placeholder.
      options: { data: { role, first_name: cleanFirst, last_initial: cleanInitial, age_confirmed: true, terms_accepted: true } },
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

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setLoading(false)

    if (!data.session) {
      pendingAuth.set(email.trim().toLowerCase(), password)
      onNeedConfirmation({
        email:   email.trim().toLowerCase(),
        role,
        first:   cleanFirst,
        initial: cleanInitial,
      })
    }
    // If data.session is set (no email confirmation required), onAuthStateChange
    // fires SIGNED_IN → AppEntry renders the app Stack automatically.
  }

  const goLogin = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onGoLogin()
  }

  const goBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onBack()
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
            <TouchableOpacity onPress={goBack} style={styles.back}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>

            <View style={styles.header}>
              <View style={[styles.rolePill, { backgroundColor: roleColour }]}>
                <Text style={styles.rolePillText}>{roleLabel}</Text>
              </View>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>
                Join Guinea Pig as a {roleLabel.toLowerCase()} and start connecting.
              </Text>
            </View>

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

              {/* 18+ age confirmation — required (store compliance gate) */}
              <TouchableOpacity style={styles.checkRow} onPress={toggleAge} activeOpacity={0.8}>
                <View style={[styles.checkbox, ageConfirmed && styles.checkboxActive]}>
                  {ageConfirmed && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                </View>
                <Text style={styles.checkLabel}>I confirm I am 18 or over</Text>
              </TouchableOpacity>
              {errors.age && <Text style={styles.ageError}>{errors.age}</Text>}

              {/* Terms & Privacy acceptance — required (store compliance gate) */}
              <View style={styles.checkRow}>
                <TouchableOpacity onPress={toggleTerms} activeOpacity={0.8}>
                  <View style={[styles.checkbox, termsAccepted && styles.checkboxActive]}>
                    {termsAccepted && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                  </View>
                </TouchableOpacity>
                <Text style={styles.checkLabel}>
                  I agree to the{' '}
                  <Text style={styles.checkLink} onPress={() => openLegal(TERMS_URL)}>Terms of Service</Text>
                  {' '}and{' '}
                  <Text style={styles.checkLink} onPress={() => openLegal(PRIVACY_URL)}>Privacy Policy</Text>
                </Text>
              </View>
              {errors.terms && <Text style={styles.ageError}>{errors.terms}</Text>}

              <Button
                label={cooldown > 0 ? `Please wait ${cooldown}s…` : 'Create account'}
                onPress={handleSignup}
                loading={loading}
                disabled={cooldown > 0}
                haptic="success"
                style={styles.submitBtn}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Already have an account? </Text>
                <Text style={styles.switchLink} onPress={goLogin}>Log in</Text>
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
  back: { paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 17, color: Colors.roseDark, fontWeight: '500' },
  header: { paddingTop: 12, paddingBottom: 28 },
  rolePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 12,
  },
  rolePillText: { color: Colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  title: {
    fontFamily: 'DancingScript_700Bold',
    fontSize: 42,
    color: Colors.warmDark,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: { fontSize: 15, color: Colors.muted, lineHeight: 22 },
  form: {},
  formError: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  formErrorText: { color: Colors.error, fontSize: 14 },
  nameRow:   { flexDirection: 'row', gap: 12 },
  nameFirst:   { flex: 1 },
  nameInitial: { width: 80 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
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
    backgroundColor: Colors.roseDark,
    borderColor: Colors.roseDark,
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.warmDark,
    lineHeight: 20,
  },
  checkLink: {
    color: Colors.roseDark,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  ageError: {
    color: Colors.error,
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  submitBtn: { marginTop: 8, marginBottom: 16 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  switchText: { fontSize: 14, color: Colors.muted },
  switchLink: { fontSize: 14, fontWeight: '600', color: Colors.roseDark },
})
