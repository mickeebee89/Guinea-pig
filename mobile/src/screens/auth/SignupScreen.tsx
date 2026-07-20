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
import { Colors, Fonts, Radius, Spacing, Shadow } from '@/constants/Colors'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { supabase } from '@/lib/supabase'
import { pendingAuth } from '@/lib/pendingAuth'

const TERMS_URL   = 'https://guineapigapp.co.uk/terms'
const PRIVACY_URL = 'https://guineapigapp.co.uk/privacy'

// ── Age gate (18+) ────────────────────────────────────────────────────────────
// Real date-of-birth check, not just a tick-box: the app matches strangers for
// in-person appointments, so store policy expects a genuine age safeguard.

// Age today, accounting for whether this year's birthday has already passed.
function ageOn(dob: Date, today = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

// Parse DD/MM/YYYY parts into a real Date, or null if that date doesn't exist.
// Built from parts (not Date.parse) so there's no timezone shift, and the
// round-trip check rejects rollovers like 31/02 that JS would silently accept.
function parseDob(d: string, m: string, y: string): Date | null {
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null
  const day = Number(d), month = Number(m), year = Number(y)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(year, month - 1, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null
  return dt
}

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
  const [lastName, setLastName]       = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [dobDay, setDobDay]           = useState('')
  const [dobMonth, setDobMonth]       = useState('')
  const [dobYear, setDobYear]         = useState('')
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
    if (!lastName.trim())        e.lastName    = 'Enter your last name'
    if (!email.trim())           e.email       = 'Enter your email'
    if (!email.includes('@'))    e.email       = 'Enter a valid email'
    if (password.length < 8)     e.password    = 'At least 8 characters'
    if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match'

    // Date of birth — the real 18+ gate.
    if (!dobDay.trim() || !dobMonth.trim() || !dobYear.trim()) {
      e.dob = 'Enter your date of birth'
    } else {
      const dob = parseDob(dobDay, dobMonth, dobYear)
      if (!dob)                    e.dob = 'Enter a valid date of birth'
      else if (dob > new Date())   e.dob = 'Date of birth cannot be in the future'
      else if (ageOn(dob) > 120)   e.dob = 'Enter a valid date of birth'
      else if (ageOn(dob) < 18)    e.dob = 'You must be 18 or over to use Guinea Pig'
    }

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
    // Store the FULL surname privately (last_name) and derive the PUBLIC single
    // letter (last_initial) from it — first alphabetic char, upper-cased. Both go
    // into metadata so the auth.users trigger and ensureProfile heal populate them.
    const cleanLast    = lastName.trim()
    const cleanInitial = (cleanLast.match(/[a-z]/i)?.[0] ?? cleanLast.charAt(0)).toUpperCase()

    // Already validated above. Build the ISO date from the local parts so the
    // stored day can't shift a timezone either way.
    const dob    = parseDob(dobDay, dobMonth, dobYear)!
    const dobIso = `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      // Persist name into user_metadata too, so a later login self-heal of a
      // half-created account can recreate the users row with the real name
      // instead of a placeholder.
      // emailRedirectTo: where the confirmation link lands (must be in Supabase
      // Redirect URLs). Confirmation completes server-side; this is a friendly
      // landing. Only used when email confirmation is enabled in Supabase.
      options: {
        emailRedirectTo: 'https://guineapigapp.co.uk/auth/confirmed',
        data: { role, first_name: cleanFirst, last_name: cleanLast, last_initial: cleanInitial, date_of_birth: dobIso, age_confirmed: true, terms_accepted: true },
      },
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
            <View style={styles.headerGradient}>
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
                <View style={styles.nameFirst}>
                  <Input
                    label="Last name"
                    placeholder="e.g. Brown"
                    value={lastName}
                    onChangeText={setLastName}
                    maxLength={60}
                    autoCapitalize="words"
                    error={errors.lastName}
                  />
                </View>
              </View>
              <Text style={styles.nameHint}>
                Only your first name and last initial (e.g. Sarah B.) are shown publicly — your full surname stays private.
              </Text>

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

              <Input
                label="Confirm password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secure
                error={errors.confirmPassword}
              />

              {/* Date of birth — the real 18+ gate (the tick below is the declaration) */}
              <Text style={styles.dobLabel}>Date of birth</Text>
              <View style={styles.dobRow}>
                <View style={styles.dobPart}>
                  <Input
                    placeholder="DD"
                    value={dobDay}
                    onChangeText={t => setDobDay(t.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
                <View style={styles.dobPart}>
                  <Input
                    placeholder="MM"
                    value={dobMonth}
                    onChangeText={t => setDobMonth(t.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    maxLength={2}
                  />
                </View>
                <View style={styles.dobYearPart}>
                  <Input
                    placeholder="YYYY"
                    value={dobYear}
                    onChangeText={t => setDobYear(t.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                </View>
              </View>
              {errors.dob && <Text style={styles.dobError}>{errors.dob}</Text>}
              <Text style={styles.nameHint}>
                We use this to confirm you're 18 or over. It's never shown publicly.
              </Text>

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
  scroll:    { paddingBottom: 40 },
  headerGradient: { paddingHorizontal: Spacing.xxl, backgroundColor: Colors.softPink },
  back: { paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 17, color: Colors.roseDark, fontWeight: '500' },
  header: { paddingTop: 12, paddingBottom: 28 },
  rolePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    marginBottom: 12,
  },
  rolePillText: { color: Colors.white, fontSize: 12, fontFamily: Fonts.bodyBold, letterSpacing: 0.5 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 34,
    color: Colors.rose,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: { fontSize: 15, color: Colors.muted, lineHeight: 22, fontFamily: Fonts.body },
  form: { paddingHorizontal: Spacing.xxl },
  formError: {
    backgroundColor: '#FEE2E2',
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 16,
  },
  formErrorText: { color: Colors.error, fontSize: 14 },
  nameRow:   { flexDirection: 'row', gap: 12 },
  nameFirst:   { flex: 1 },
  nameHint: {
    fontSize: 12,
    color: Colors.muted,
    fontFamily: Fonts.body,
    lineHeight: 17,
    marginTop: 6,
    marginBottom: 4,
    marginLeft: 4,
  },
  // Date of birth — label mirrors the shared Input's own label styling so the
  // three-part row reads as one field.
  dobLabel: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    marginBottom: 6,
    opacity: 0.7,
  },
  dobRow:      { flexDirection: 'row', gap: 12 },
  dobPart:     { flex: 1 },
  dobYearPart: { flex: 1.4 },
  dobError: {
    color: Colors.error,
    fontSize: 12,
    marginTop: -8,   // pull up under the Input's own 16px bottom margin
    marginLeft: 4,
  },
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
    backgroundColor: Colors.rose,
    borderColor: Colors.rose,
  },
  checkLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    lineHeight: 20,
  },
  checkLink: {
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
    textDecorationLine: 'underline',
  },
  ageError: {
    color: Colors.error,
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  submitBtn: { marginTop: 8, marginBottom: 16, ...Shadow.card },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  switchText: { fontSize: 14, color: Colors.muted, fontFamily: Fonts.body },
  switchLink: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.roseDark },
})
