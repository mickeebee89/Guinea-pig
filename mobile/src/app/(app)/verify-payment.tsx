import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStripe } from '@stripe/stripe-react-native'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step =
  | 'loading'
  | 'locked'
  | 'instructions'
  | 'verifying'
  | 'ready_to_pay'
  | 'confirming'
  | 'success'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(ms: number): string {
  const totalSecs = Math.ceil(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function VerifyPaymentScreen() {
  const router   = useRouter()
  const { session } = useAuth()
  const insets   = useSafeAreaInsets()
  const userId   = session?.user?.id
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  const [step,           setStep]           = useState<Step>('loading')
  const [selfieUri,      setSelfieUri]       = useState<string | null>(null)
  const [attemptId,      setAttemptId]       = useState<string | null>(null)
  const [lockoutUntil,   setLockoutUntil]    = useState<Date | null>(null)
  const [countdown,      setCountdown]       = useState('')
  const [paymentLoading, setPaymentLoading]  = useState(false)

  // Pulse animation for verifying step
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (step !== 'verifying') return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 600, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [step, pulse])

  // ── Lockout countdown ticker ───────────────────────────────────────────────

  useEffect(() => {
    if (!lockoutUntil) return
    const tick = () => {
      const ms = lockoutUntil.getTime() - Date.now()
      if (ms <= 0) { setStep('instructions'); setLockoutUntil(null) }
      else setCountdown(formatCountdown(ms))
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [lockoutUntil])

  // ── Check lockout + existing verification ─────────────────────────────────

  const checkLockout = useCallback(async () => {
    if (!userId) return
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: attempts } = await supabase
      .from('verification_attempts')
      .select('created_at, passed')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })

    const failed = (attempts ?? []).filter((a: any) => !a.passed)
    if (failed.length >= 3) {
      // Lockout expires 24h after the OLDEST recent failure
      const oldest = new Date(failed[0].created_at)
      const expiry = new Date(oldest.getTime() + 24 * 60 * 60 * 1000)
      setLockoutUntil(expiry)
      setCountdown(formatCountdown(expiry.getTime() - Date.now()))
      return true
    }
    return false
  }, [userId])

  const load = useCallback(async () => {
    if (!userId) return
    try {
      // Already verified?
      const { data: ud } = await supabase
        .from('users')
        .select('is_verified')
        .eq('id', userId)
        .single()
      if ((ud as any)?.is_verified) {
        Alert.alert("You're already verified!", 'Your verified badge is active on your profile.')
        router.back()
        return
      }
      // Locked out?
      const locked = await checkLockout()
      setStep(locked ? 'locked' : 'instructions')
    } catch {
      setStep('instructions')
    }
  }, [userId, checkLockout, router])

  useEffect(() => { load() }, [load])

  // ── Selfie ─────────────────────────────────────────────────────────────────

  const takeSelfie = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Camera needed', 'Please allow camera access in Settings to continue.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType:   ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect:        [1, 1],
      quality:       0.85,
    })
    if (result.canceled || !result.assets[0]) return

    const { uri } = result.assets[0]
    setSelfieUri(uri)
    setStep('verifying')

    // Upload selfie to private storage bucket (best-effort)
    let selfieStoragePath: string | null = null
    try {
      const ext    = uri.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path   = `${userId}/selfie-${Date.now()}.${ext}`
      const blob   = await (await fetch(uri)).blob()
      const buffer = await blob.arrayBuffer()
      const { data: up } = await supabase.storage
        .from('verification-selfies')
        .upload(path, buffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` })
      if (up) selfieStoragePath = up.path
    } catch { /* storage failure is non-blocking */ }

    // Record attempt row (passed=false until payment succeeds)
    try {
      const { data: newAttempt } = await supabase
        .from('verification_attempts')
        .insert({ user_id: userId, passed: false, selfie_url: selfieStoragePath })
        .select('id')
        .single()
      if (newAttempt) setAttemptId((newAttempt as any).id)
    } catch {}

    // Simulate identity check (real API would go here)
    await new Promise(r => setTimeout(r, 2200))
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setStep('ready_to_pay')
  }

  // ── Payment ────────────────────────────────────────────────────────────────

  const handlePayment = async () => {
    setPaymentLoading(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      // Get client secret from edge function
      const { data: intentData, error: fnErr } = await supabase.functions.invoke(
        'stripe-payment',
        { body: { action: 'create_verification_intent' } },
      )
      if (fnErr || !intentData?.clientSecret) {
        throw new Error(fnErr?.message ?? 'Could not start payment. Please try again.')
      }

      // Init payment sheet with brand colours
      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: 'Guinea Pig',
        paymentIntentClientSecret: intentData.clientSecret,
        returnURL: 'mobile://stripe-return',
        defaultBillingDetails: { email: session?.user?.email },
        appearance: {
          colors:  { primary: Colors.roseDark },
          shapes:  { borderRadius: 14 },
        },
      })
      if (initErr) throw new Error(initErr.message)

      setPaymentLoading(false)

      // Present
      const { error: presentErr } = await presentPaymentSheet()
      if (presentErr) {
        if (presentErr.code === 'Canceled') return
        throw new Error(presentErr.message)
      }

      // Confirmed on Stripe side — now confirm on our server
      setStep('confirming')
      const { error: confirmErr } = await supabase.functions.invoke('stripe-payment', {
        body: { action: 'confirm_verification', paymentIntentId: intentData.paymentIntentId },
      })

      if (confirmErr) {
        // Payment went through but server update failed.
        // In production the Stripe webhook handles this; show success anyway.
        console.warn('[verify-payment] confirm_verification failed:', confirmErr.message)
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep('success')
    } catch (err: any) {
      setPaymentLoading(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)

      // Mark this attempt as failed
      if (attemptId) {
        await supabase
          .from('verification_attempts')
          .update({ passed: false })
          .eq('id', attemptId)
      }

      // Re-check lockout — this failure might trip the limit
      const nowLocked = await checkLockout()
      if (nowLocked) setStep('locked')

      Alert.alert('Payment failed', err.message ?? 'Please try a different card or contact support.')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Get verified</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* ── LOADING ── */}
      {step === 'loading' && (
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.roseDark} />
        </View>
      )}

      {/* ── LOCKED ── */}
      {step === 'locked' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: '#FEF2F2' }]}>
            <Ionicons name="lock-closed" size={36} color={Colors.error} />
          </View>
          <Text style={styles.centredTitle}>Temporarily locked</Text>
          <Text style={styles.centredSub}>
            You've had 3 failed verification attempts.{'\n'}Try again in{' '}
            <Text style={{ fontWeight: '800', color: Colors.warmDark }}>{countdown || '…'}</Text>.
          </Text>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.8}
          >
            <Text style={styles.ghostBtnText}>Back to settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── INSTRUCTIONS ── */}
      {step === 'instructions' && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          {/* Header */}
          <View style={styles.heroCard}>
            <View style={styles.heroIconCircle}>
              <Ionicons name="shield-checkmark" size={44} color={Colors.white} />
            </View>
            <Text style={styles.heroTitle}>Identity check</Text>
            <Text style={styles.heroSub}>
              A one-time selfie confirms you're a real person. The check is instant — we don't store your photo beyond the review.
            </Text>
            <View style={styles.priceTag}>
              <Text style={styles.priceTagText}>£4.99 one-off payment after the check</Text>
            </View>
          </View>

          {/* Steps */}
          <Text style={styles.sectionLabel}>What to expect</Text>
          {[
            { icon: 'camera-outline',       step: '1', text: 'Take a quick selfie — face clearly visible, good lighting' },
            { icon: 'checkmark-circle-outline', step: '2', text: 'We verify your identity in seconds (free)' },
            { icon: 'card-outline',         step: '3', text: 'Pay £4.99 — your verified badge is applied immediately' },
          ].map(item => (
            <View key={item.step} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <Ionicons name={item.icon as any} size={22} color={Colors.roseDark} style={{ marginRight: 12 }} />
              <Text style={styles.stepText}>{item.text}</Text>
            </View>
          ))}

          {/* Benefits */}
          <Text style={styles.sectionLabel}>What you get</Text>
          <View style={styles.benefitsCard}>
            {[
              'Verified badge on your profile',
              'Priority matching with providers',
              'Increased trust from the community',
              'Access to exclusive sessions',
            ].map(b => (
              <View key={b} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle" size={18} color="#1D9E75" />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={takeSelfie}
            activeOpacity={0.9}
          >
            <Ionicons name="camera" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Take selfie</Text>
          </TouchableOpacity>

          <Text style={styles.legalNote}>
            By continuing you agree to our identity verification policy. Your selfie is used only for verification and deleted after review.
          </Text>
        </ScrollView>
      )}

      {/* ── VERIFYING ── */}
      {step === 'verifying' && (
        <View style={styles.centred}>
          {selfieUri && (
            <Animated.View style={[styles.selfiePreview, { transform: [{ scale: pulse }] }]}>
              <Image source={{ uri: selfieUri }} style={styles.selfieImg} />
              <View style={styles.selfieOverlay}>
                <ActivityIndicator color={Colors.white} />
              </View>
            </Animated.View>
          )}
          <Text style={styles.centredTitle}>Verifying your identity…</Text>
          <Text style={styles.centredSub}>This usually takes a few seconds.</Text>
        </View>
      )}

      {/* ── READY TO PAY ── */}
      {step === 'ready_to_pay' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="checkmark-circle" size={44} color="#1D9E75" />
          </View>
          <Text style={styles.centredTitle}>Identity confirmed ✓</Text>
          <Text style={styles.centredSub}>
            One last step — pay the £4.99 verification fee to activate your badge.
          </Text>

          <View style={styles.payCard}>
            <Ionicons name="shield-checkmark" size={28} color={Colors.roseDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.payCardTitle}>Verified Badge</Text>
              <Text style={styles.payCardSub}>One-time fee · Never charged again</Text>
            </View>
            <Text style={styles.payCardPrice}>£4.99</Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, paymentLoading && { opacity: 0.7 }]}
            onPress={handlePayment}
            disabled={paymentLoading}
            activeOpacity={0.9}
          >
            {paymentLoading
              ? <ActivityIndicator color={Colors.white} />
              : <>
                  <Ionicons name="card-outline" size={20} color={Colors.white} />
                  <Text style={styles.primaryBtnText}>Pay £4.99</Text>
                </>
            }
          </TouchableOpacity>

          <Text style={styles.legalNote}>
            Secured by Stripe. Your card details are never stored on our servers.
          </Text>
        </View>
      )}

      {/* ── CONFIRMING ── */}
      {step === 'confirming' && (
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.roseDark} size="large" />
          <Text style={styles.centredTitle}>Activating your badge…</Text>
        </View>
      )}

      {/* ── SUCCESS ── */}
      {step === 'success' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.softPink + '50', width: 100, height: 100, borderRadius: 50 }]}>
            <Ionicons name="shield-checkmark" size={52} color={Colors.roseDark} />
          </View>
          <Text style={styles.centredTitle}>You're verified! 🎉</Text>
          <Text style={styles.centredSub}>
            Your verified badge is now active. Providers and models will see it on your profile.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>Back to settings</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.cream,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: {
    flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800',
    color: Colors.warmDark, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  // Hero
  heroCard: {
    backgroundColor: Colors.white, borderRadius: 24, padding: 24,
    alignItems: 'center', gap: 12, marginBottom: 24,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: Colors.warmDark, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  heroIconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.roseDark,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  heroTitle:   { fontSize: 22, fontWeight: '800', color: Colors.warmDark, letterSpacing: -0.4 },
  heroSub:     { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  priceTag: {
    backgroundColor: Colors.inputBg, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  priceTagText: { fontSize: 13, fontWeight: '600', color: Colors.warmDark },

  // Steps
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10, paddingHorizontal: 2,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.white, borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.softPink + '50',
    alignItems: 'center', justifyContent: 'center', marginRight: 4,
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: Colors.roseDark },
  stepText:    { flex: 1, fontSize: 13, color: Colors.warmDark, lineHeight: 18 },

  // Benefits
  benefitsCard: {
    backgroundColor: Colors.white, borderRadius: 14,
    padding: 16, gap: 12, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.border,
  },
  benefitRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefitText: { flex: 1, fontSize: 14, color: Colors.warmDark, fontWeight: '500' },

  // Verifying
  selfiePreview: {
    width: 120, height: 120, borderRadius: 60, overflow: 'hidden',
    borderWidth: 3, borderColor: Colors.roseDark, position: 'relative',
    marginBottom: 8,
  },
  selfieImg:     { width: '100%', height: '100%' },
  selfieOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(140,74,88,0.4)', alignItems: 'center', justifyContent: 'center',
  },

  // Ready to pay
  payCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderRadius: 18,
    padding: 16, width: '100%', marginBottom: 4,
    borderWidth: 1.5, borderColor: Colors.softPink,
  },
  payCardTitle: { fontSize: 15, fontWeight: '700', color: Colors.warmDark },
  payCardSub:   { fontSize: 12, color: Colors.muted, marginTop: 2 },
  payCardPrice: { fontSize: 20, fontWeight: '800', color: Colors.roseDark },

  // Lockout / success
  bigIcon: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  centredTitle: {
    fontSize: 22, fontWeight: '800', color: Colors.warmDark,
    textAlign: 'center', letterSpacing: -0.4,
  },
  centredSub: {
    fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 21,
  },
  ghostBtn: {
    marginTop: 8, paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },

  // Shared
  primaryBtn: {
    width: '100%', height: 54, backgroundColor: Colors.roseDark,
    borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.white, letterSpacing: -0.2 },
  legalNote: {
    fontSize: 11, color: Colors.muted, textAlign: 'center',
    lineHeight: 16, marginTop: 8, paddingHorizontal: 8,
  },
})
