import { useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStripe } from '@stripe/stripe-react-native'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

type Step = 'loading' | 'instructions' | 'camera' | 'uploading' | 'submitted' | 'approved_pay' | 'confirming' | 'success' | 'rejected'

export default function VerifyPaymentScreen() {
  const router  = useRouter()
  const { session } = useAuth()
  const insets  = useSafeAreaInsets()
  const userId  = session?.user?.id
  const userRole = session?.user?.user_metadata?.role as string | undefined
  const isProvider = userRole === 'provider'
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  const [step,           setStep]           = useState<Step>('loading')
  const [selfieUri,      setSelfieUri]       = useState<string | null>(null)
  const [requestNotes,   setRequestNotes]   = useState<string | null>(null)
  const [paymentLoading, setPaymentLoading] = useState(false)

  // ── Check existing request ─────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) return
    try {
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

      const { data: existing } = await supabase
        .from('verification_requests')
        .select('status, notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!existing) {
        setStep('instructions')
        return
      }

      const status = (existing as any).status as string
      if (status === 'pending') {
        setStep('submitted')
      } else if (status === 'approved') {
        // Model: auto-verify, Provider: show payment
        if (isProvider) {
          setStep('approved_pay')
        } else {
          // Auto-verify model
          await supabase.from('users').update({ is_verified: true }).eq('id', userId)
          setStep('success')
        }
      } else if (status === 'rejected') {
        setRequestNotes((existing as any).notes ?? null)
        setStep('rejected')
      } else {
        setStep('instructions')
      }
    } catch {
      setStep('instructions')
    }
  }, [userId, isProvider, router])

  useEffect(() => { load() }, [load])

  // ── Take selfie ────────────────────────────────────────────────────────────

  const takeSelfie = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Camera needed', 'Please allow camera access in Settings to continue.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType:    ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect:        [3, 4],
      quality:       0.85,
    })
    if (result.canceled || !result.assets[0]) return
    setSelfieUri(result.assets[0].uri)
    setStep('camera')
  }

  const submitSelfie = async () => {
    if (!selfieUri || !userId) return
    setStep('uploading')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        selfieUri,
        [{ resize: { width: 1080 } }],
        { base64: true, compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      )
      if (!manipulated.base64) throw new Error('Image processing failed')

      const path = `${userId}/selfie-${Date.now()}.jpg`
      const { data: up, error: uploadErr } = await supabase.storage
        .from('verification-selfies')
        .upload(path, decode(manipulated.base64), { contentType: 'image/jpeg' })
      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage
        .from('verification-selfies')
        .getPublicUrl(up.path)

      // Delete any previous rejected request so we can submit fresh
      await supabase.from('verification_requests').delete().eq('user_id', userId)

      const { error: insertErr } = await supabase.from('verification_requests').insert({
        user_id:    userId,
        selfie_url: urlData.publicUrl,
        status:     'pending',
      })
      if (insertErr) throw insertErr

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep('submitted')
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Upload failed', e?.message ?? 'Could not submit your selfie. Please try again.')
      setStep('camera')
    }
  }

  // ── Provider payment ───────────────────────────────────────────────────────

  const handlePayment = async () => {
    setPaymentLoading(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    try {
      const { data: intentData, error: fnErr } = await supabase.functions.invoke(
        'stripe-payment',
        { body: { action: 'create_verification_intent' } },
      )
      if (fnErr || !intentData?.clientSecret) {
        throw new Error(fnErr?.message ?? 'Could not start payment. Please try again.')
      }

      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName:        'Guinea Pig',
        paymentIntentClientSecret:  intentData.clientSecret,
        returnURL:                  'mobile://stripe-return',
        defaultBillingDetails:      { email: session?.user?.email },
        appearance: {
          colors: { primary: Colors.roseDark },
          shapes: { borderRadius: 14 },
        },
      })
      if (initErr) throw new Error(initErr.message)

      setPaymentLoading(false)

      const { error: presentErr } = await presentPaymentSheet()
      if (presentErr) {
        if (presentErr.code === 'Canceled') return
        throw new Error(presentErr.message)
      }

      setStep('confirming')
      await supabase.functions.invoke('stripe-payment', {
        body: { action: 'confirm_verification', userId },
      })

      await supabase.from('users').update({ is_verified: true }).eq('id', userId)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setStep('success')
    } catch (err: any) {
      setPaymentLoading(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
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

      {/* ── INSTRUCTIONS ── */}
      {step === 'instructions' && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          <View style={styles.heroCard}>
            <View style={styles.heroIconCircle}>
              <Ionicons name="shield-checkmark" size={44} color={Colors.white} />
            </View>
            <Text style={styles.heroTitle}>Identity check</Text>
            <Text style={styles.heroSub}>
              Take a selfie holding a piece of paper with your first name and{' '}
              <Text style={{ fontWeight: '800', color: Colors.warmDark }}>"Guinea Pig"</Text>
              {' '}written on it. Our team reviews within 24 hours.
            </Text>
            {isProvider && (
              <View style={styles.priceTag}>
                <Text style={styles.priceTagText}>£4.99 one-off fee after approval</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionLabel}>What to do</Text>
          {[
            { icon: 'pencil-outline',          step: '1', text: 'Write your first name and "Guinea Pig" on a piece of paper' },
            { icon: 'camera-outline',           step: '2', text: 'Take a clear selfie holding the paper — face and writing both visible' },
            { icon: 'cloud-upload-outline',     step: '3', text: 'Submit — our team reviews within 24 hours' },
            { icon: 'notifications-outline',    step: '4', text: isProvider ? 'Get notified then complete £4.99 payment to activate your badge' : 'Get notified when approved — badge activates automatically (included in your subscription)' },
          ].map(item => (
            <View key={item.step} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <Ionicons name={item.icon as any} size={22} color={Colors.roseDark} style={{ marginRight: 12 }} />
              <Text style={styles.stepText}>{item.text}</Text>
            </View>
          ))}

          <TouchableOpacity style={styles.primaryBtn} onPress={takeSelfie} activeOpacity={0.9}>
            <Ionicons name="camera" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Take selfie</Text>
          </TouchableOpacity>

          <Text style={styles.legalNote}>
            Your selfie is stored securely and only used for identity verification.
          </Text>
        </ScrollView>
      )}

      {/* ── PREVIEW SELFIE ── */}
      {step === 'camera' && selfieUri && (
        <View style={styles.centred}>
          <Image source={{ uri: selfieUri }} style={styles.selfiePreview} />
          <Text style={styles.centredTitle}>Looks good?</Text>
          <Text style={styles.centredSub}>
            Make sure your face and the handwritten paper are both clearly visible.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={submitSelfie} activeOpacity={0.9}>
            <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Submit for review</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={takeSelfie} activeOpacity={0.85}>
            <Text style={styles.ghostBtnText}>Retake photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── UPLOADING ── */}
      {step === 'uploading' && (
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.roseDark} size="large" />
          <Text style={styles.centredTitle}>Uploading…</Text>
        </View>
      )}

      {/* ── SUBMITTED / PENDING ── */}
      {step === 'submitted' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.softPink + '40' }]}>
            <Ionicons name="time-outline" size={44} color={Colors.roseDark} />
          </View>
          <Text style={styles.centredTitle}>Under review</Text>
          <Text style={styles.centredSub}>
            Your verification selfie has been submitted.{'\n'}
            Our team will review it within 24 hours and notify you when done.
          </Text>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostBtnText}>Back to settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── APPROVED — PROVIDER PAYS ── */}
      {step === 'approved_pay' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="checkmark-circle" size={44} color="#1D9E75" />
          </View>
          <Text style={styles.centredTitle}>Identity approved ✓</Text>
          <Text style={styles.centredSub}>
            One last step — pay the £4.99 verification fee to activate your verified badge.
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
          <Text style={styles.legalNote}>Secured by Stripe. Your card details are never stored on our servers.</Text>
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
            Your verified badge is now active on your profile.
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

      {/* ── REJECTED ── */}
      {step === 'rejected' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: '#FEF2F2' }]}>
            <Ionicons name="close-circle" size={44} color={Colors.error} />
          </View>
          <Text style={styles.centredTitle}>Not approved</Text>
          <Text style={styles.centredSub}>
            {requestNotes
              ? requestNotes
              : 'We couldn\'t verify your identity from the photo. Please resubmit with a clearer image showing your face and the handwritten paper.'}
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { setSelfieUri(null); setStep('instructions') }} activeOpacity={0.9}>
            <Ionicons name="refresh" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
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
    fontFamily: 'DancingScript_700Bold',
    flex: 1, textAlign: 'center', fontSize: 25,
    color: Colors.warmDark, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: 24, padding: 24,
    alignItems: 'center', gap: 12, marginBottom: 24,
    borderWidth: 1, borderColor: Colors.border,
  },
  heroIconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.roseDark,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontFamily: 'DancingScript_700Bold', fontSize: 33, color: Colors.warmDark, letterSpacing: -0.4 },
  heroSub:   { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  priceTag: {
    backgroundColor: Colors.inputBg, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  priceTagText: { fontSize: 13, fontWeight: '600', color: Colors.warmDark },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10, paddingHorizontal: 2,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 4,
    backgroundColor: Colors.white, borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.softPink + '50',
    alignItems: 'center', justifyContent: 'center', marginRight: 4, flexShrink: 0,
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: Colors.roseDark },
  stepText:    { flex: 1, fontSize: 13, color: Colors.warmDark, lineHeight: 18 },

  selfiePreview: {
    width: 220, height: 280, borderRadius: 20,
    borderWidth: 3, borderColor: Colors.roseDark, marginBottom: 8,
  },

  payCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderRadius: 18,
    padding: 16, width: '100%', marginBottom: 4,
    borderWidth: 1.5, borderColor: Colors.softPink,
  },
  payCardTitle: { fontSize: 15, fontWeight: '700', color: Colors.warmDark },
  payCardSub:   { fontSize: 12, color: Colors.muted, marginTop: 2 },
  payCardPrice: { fontSize: 20, fontWeight: '800', color: Colors.roseDark },

  bigIcon: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  centredTitle: { fontFamily: 'DancingScript_700Bold', fontSize: 33, color: Colors.warmDark, textAlign: 'center', letterSpacing: -0.4 },
  centredSub:   { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 21 },

  primaryBtn: {
    width: '100%', height: 54, backgroundColor: Colors.roseDark,
    borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.white, letterSpacing: -0.2 },
  ghostBtn: {
    paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  legalNote: {
    fontSize: 11, color: Colors.muted, textAlign: 'center',
    lineHeight: 16, marginTop: 8, paddingHorizontal: 8,
  },
})
