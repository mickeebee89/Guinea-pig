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
  Linking,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStripe } from '@stripe/stripe-react-native'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// Full refund policy lives in Terms section 9.
const TERMS_URL = 'https://guineapigapp.co.uk/terms'

type Step = 'loading' | 'instructions' | 'camera' | 'uploading' | 'submitted' | 'confirming' | 'confirm-failed' | 'success' | 'rejected'

export default function VerifyPaymentScreen() {
  const router  = useRouter()
  // Optional provider context — passed only by the model-facing gate callers
  // (subscribe / apply-session) so the pending screen can offer "add to favourites".
  const { providerId, providerName } = useLocalSearchParams<{ providerId?: string; providerName?: string }>()
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
  const [hasPaid,        setHasPaid]        = useState(false)   // provider paid (pay-first)
  const [feeOnly,        setFeeOnly]        = useState(false)   // already identity-verified provider who only owes the £14.99 fee (skip selfie)
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null)   // set when a charge succeeded but recording it failed → Retry target
  const [favourited,     setFavourited]     = useState(false)   // added this provider to favourites
  const [favLoading,     setFavLoading]     = useState(false)

  // ── Check existing request ─────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const { data: ud } = await supabase
        .from('users')
        .select('is_verified, is_founding_provider, provider_fee_waived')
        .eq('id', userId)
        .single()

      // Pay-first (providers only): have they already paid? Used to avoid a second
      // charge on the instructions / resubmit paths.
      let paid = false
      if (isProvider) {
        const { data: payRow } = await supabase
          .from('verification_payments')
          .select('id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle()
        paid = !!payRow
        setHasPaid(paid)
      }

      const feeCovered = paid || !!(ud as any)?.is_founding_provider || !!(ud as any)?.provider_fee_waived

      if ((ud as any)?.is_verified) {
        // A verified provider who still owes the £14.99 can pay it here — identity is
        // already done, so skip the selfie. Everyone else verified is fully finished.
        if (isProvider && !feeCovered) {
          setFeeOnly(true)
          setStep('instructions')
          return
        }
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

      if (existing) {
        const status = (existing as any).status as string
        if (status === 'pending') { setStep('submitted'); return }
        if (status === 'approved') {
          // Approval is the unlock. Models auto-verify here; providers were already
          // verified by admin approve(). Either way, done.
          if (!isProvider) {
            await supabase.from('users').update({ is_verified: true }).eq('id', userId)
          }
          setStep('success')
          return
        }
        if (status === 'rejected') {
          setRequestNotes((existing as any).notes ?? null)
          setStep('rejected')
          return
        }
      }

      // No usable request. A provider who already paid goes straight to the camera
      // (don't charge again); everyone else sees instructions (provider: "Pay £14.99").
      if (isProvider && paid) setStep('camera')
      else setStep('instructions')
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

      // Delete any previous rejected request so we can submit fresh
      await supabase.from('verification_requests').delete().eq('user_id', userId)

      // Store the STORAGE PATH (bucket is private). The admin generates a short-lived
      // signed URL at render time — a public URL would 403.
      const { error: insertErr } = await supabase.from('verification_requests').insert({
        user_id:    userId,
        selfie_url: up.path,
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

  // ── Add stylist to favourites (pending screen) ─────────────────────────────
  // Reuses the same favourites row as the provider profile's heart button:
  // { user_id, provider_id }. Guards against a duplicate (unique constraint) by
  // checking first, and treats a duplicate-insert error as already-favourited.

  const addToFavourites = async () => {
    if (!userId || !providerId || favLoading || favourited) return
    setFavLoading(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const { data: existing } = await supabase
        .from('favourites')
        .select('id')
        .eq('user_id', userId)
        .eq('provider_id', providerId)
        .maybeSingle()

      if (!existing) {
        const { error } = await supabase
          .from('favourites')
          .insert({ user_id: userId, provider_id: providerId })
        // 23505 = unique_violation → already favourited on another device; treat as success.
        if (error && (error as any).code !== '23505') throw error
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setFavourited(true)
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Could not add to favourites', e?.message ?? 'Please try again.')
    } finally {
      setFavLoading(false)
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
      // Server says this user already paid → don't charge again; move straight on.
      if ((intentData as { alreadyPaid?: boolean } | null)?.alreadyPaid) {
        setPaymentLoading(false)
        setHasPaid(true)
        setStep(feeOnly ? 'success' : 'camera')
        return
      }
      if (fnErr || !intentData?.clientSecret || !intentData?.paymentIntentId) {
        throw new Error(fnErr?.message ?? 'Could not start payment. Please try again.')
      }
      const paymentIntentId = intentData.paymentIntentId as string

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

      // Payment has ALREADY succeeded on Stripe here. Recording it must not silently
      // fail — if it does we hold on a retry screen (never advance, never re-charge).
      await finalisePayment(paymentIntentId)
    } catch (err: any) {
      setPaymentLoading(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Payment failed', err.message ?? 'Please try a different card or contact support.')
    }
  }

  // Records a SUCCEEDED payment via the edge fn and only then advances. If recording
  // fails (network / server), the money is already taken, so we DON'T re-charge or
  // advance — we surface a Retry that re-runs this same confirm for the same intent.
  const finalisePayment = async (intentId: string) => {
    setStep('confirming')
    const { data, error } = await supabase.functions.invoke('stripe-payment', {
      body: { action: 'confirm_verification', paymentIntentId: intentId },
    })
    if (error || (data as { success?: boolean } | null)?.success === false) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setPendingIntentId(intentId)
      setStep('confirm-failed')
      return
    }
    setPendingIntentId(null)
    setHasPaid(true)
    if (feeOnly) {
      // Already identity-verified — the fee was the only outstanding step, so they're
      // done: no selfie, no admin re-approval. Returning to the dashboard enables the
      // shop toggle (its focus re-sync re-derives fee-settled).
      setStep('success')
    } else {
      // Pay-first: payment recorded → now take the verification photo. No is_verified
      // here — verification/unlock happens when the admin approves.
      setStep('camera')
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
            <Text style={styles.heroTitle}>{feeOnly ? 'Verification fee' : 'Identity check'}</Text>
            <Text style={styles.heroSub}>
              {feeOnly
                ? 'You\'re already identity-verified. Pay the one-off £14.99 fee to make your shop live — no selfie needed.'
                : <>Take a selfie holding a piece of paper with your first name and <Text style={{ fontWeight: '800', color: Colors.warmDark }}>"Guinea Pig"</Text> written on it. Our team reviews within 24 hours.</>}
            </Text>
            {isProvider && !hasPaid && (
              <View style={styles.priceTag}>
                <Text style={styles.priceTagText}>£14.99 one-off verification fee</Text>
              </View>
            )}
          </View>

          {!feeOnly && <Text style={styles.sectionLabel}>What to do</Text>}
          {!feeOnly && [
            { icon: 'person-circle-outline',    step: '1', text: 'Make sure your profile picture clearly shows your face — we compare it to this selfie' },
            { icon: 'pencil-outline',          step: '2', text: 'Write your first name and "Guinea Pig" on a piece of paper' },
            { icon: 'camera-outline',           step: '3', text: 'Take a clear selfie holding the paper — face and writing both visible' },
            { icon: 'cloud-upload-outline',     step: '4', text: 'Submit — our team reviews within 24 hours' },
            { icon: 'notifications-outline',    step: '5', text: isProvider ? 'Get notified when approved — your verified badge and profile go live' : 'Get notified when approved — badge activates automatically (included in your subscription)' },
          ].map(item => (
            <View key={item.step} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{item.step}</Text>
              </View>
              <Ionicons name={item.icon as any} size={22} color={Colors.roseDark} style={{ marginRight: 12 }} />
              <Text style={styles.stepText}>{item.text}</Text>
            </View>
          ))}

          {/* Refund terms shown BEFORE the charge (full policy: Terms section 9). */}
          {isProvider && !hasPaid && (
            <Text style={styles.refundNote}>
              This one-off fee covers processing your verification and is non-refundable
              once your verification has been completed. See{' '}
              <Text style={styles.termsLink} onPress={() => Linking.openURL(TERMS_URL)}>Terms</Text>
              {' '}for details.
            </Text>
          )}

          {isProvider && !hasPaid ? (
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
                    <Text style={styles.primaryBtnText}>Pay £14.99</Text>
                  </>
              }
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.primaryBtn} onPress={takeSelfie} activeOpacity={0.9}>
              <Ionicons name="camera" size={20} color={Colors.white} />
              <Text style={styles.primaryBtnText}>Take selfie</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.legalNote}>
            {feeOnly
              ? 'Secured by Stripe. Paying makes your shop eligible to go live.'
              : isProvider && !hasPaid
              ? 'Secured by Stripe. After payment you\'ll take your verification selfie.'
              : 'Your selfie is stored securely and only used for identity verification.'}
          </Text>
        </ScrollView>
      )}

      {/* ── CAMERA (no selfie yet — e.g. provider just paid) ── */}
      {step === 'camera' && !selfieUri && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.softPink + '40' }]}>
            <Ionicons name="camera-outline" size={44} color={Colors.roseDark} />
          </View>
          <Text style={styles.centredTitle}>Take your selfie</Text>
          <Text style={styles.centredSub}>
            Hold up the paper with your first name and "Guinea Pig" written on it — face and writing both clearly visible.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={takeSelfie} activeOpacity={0.9}>
            <Ionicons name="camera" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Take selfie</Text>
          </TouchableOpacity>
        </View>
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

          {providerId ? (
            <>
              <Text style={styles.centredSub}>
                Add {providerName || 'this stylist'} to your favourites so you can apply as soon as you're approved.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, (favourited || favLoading) && { opacity: 0.7 }]}
                onPress={addToFavourites}
                disabled={favourited || favLoading}
                activeOpacity={0.9}
              >
                {favLoading ? (
                  <ActivityIndicator color={Colors.white} />
                ) : favourited ? (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                    <Text style={styles.primaryBtnText}>Added to favourites ✓</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="heart" size={20} color={Colors.white} />
                    <Text style={styles.primaryBtnText}>Add {providerName || 'this stylist'} to favourites</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : null}

          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.85}
          >
            <Text style={styles.ghostBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── CONFIRMING ── */}
      {step === 'confirming' && (
        <View style={styles.centred}>
          <ActivityIndicator color={Colors.roseDark} size="large" />
          <Text style={styles.centredTitle}>Payment received — finalising…</Text>
        </View>
      )}

      {/* ── CONFIRM FAILED (paid, but recording failed) ── */}
      {step === 'confirm-failed' && (
        <View style={styles.centred}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.softPink + '50', width: 100, height: 100, borderRadius: 50 }]}>
            <Ionicons name="time-outline" size={52} color={Colors.roseDark} />
          </View>
          <Text style={styles.centredTitle}>Payment received</Text>
          <Text style={styles.centredSub}>
            We&apos;ve taken your payment but couldn&apos;t finish setting up your verification. Tap retry — you won&apos;t be charged again.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { if (pendingIntentId) finalisePayment(pendingIntentId) }}
            activeOpacity={0.9}
          >
            <Ionicons name="refresh" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
          <Text style={styles.legalNote}>If this keeps happening, contact support@guineapigapp.co.uk — your payment is safe.</Text>
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
            <Text style={styles.primaryBtnText}>Done</Text>
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
    backgroundColor: Colors.softPink,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  topBarTitle: {
    fontFamily: Fonts.heading,
    flex: 1, textAlign: 'center', fontSize: 18,
    color: Colors.warmDark, letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  heroCard: {
    backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 24,
    alignItems: 'center', gap: 12, marginBottom: 24,
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.soft,
  },
  heroIconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.rose,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontFamily: Fonts.display, fontSize: 30, color: Colors.rose, letterSpacing: -0.4 },
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
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: Colors.border,
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.softPink,
    alignItems: 'center', justifyContent: 'center', marginRight: 4, flexShrink: 0,
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: Colors.roseDark },
  stepText:    { flex: 1, fontSize: 13, color: Colors.warmDark, lineHeight: 18 },

  selfiePreview: {
    width: 220, height: 280, borderRadius: Radius.lg,
    borderWidth: 3, borderColor: Colors.rose, marginBottom: 8,
  },

  payCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: 16, width: '100%', marginBottom: 4,
    borderWidth: 1.5, borderColor: Colors.softPink,
  },
  payCardTitle: { fontSize: 15, fontWeight: '700', color: Colors.warmDark },
  payCardSub:   { fontSize: 12, color: Colors.muted, marginTop: 2 },
  payCardPrice: { fontSize: 20, fontWeight: '800', color: Colors.rose },

  bigIcon: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  centredTitle: { fontFamily: Fonts.display, fontSize: 30, color: Colors.rose, textAlign: 'center', letterSpacing: -0.4 },
  centredSub:   { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 21 },

  primaryBtn: {
    width: '100%', height: 54, backgroundColor: Colors.rose,
    borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...Shadow.card, marginTop: 4,
  },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.white, letterSpacing: -0.2 },
  ghostBtn: {
    paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  legalNote: {
    fontSize: 11, color: Colors.muted, textAlign: 'center',
    lineHeight: 16, marginTop: 8, paddingHorizontal: 8,
  },
  // Refund terms for the one-off £14.99 fee, shown before the charge.
  refundNote: {
    fontSize: 12, color: Colors.muted, textAlign: 'center',
    lineHeight: 17, marginBottom: 12, paddingHorizontal: 6,
  },
  termsLink: {
    color: Colors.roseDark,
    fontFamily: Fonts.bodyBold,
    textDecorationLine: 'underline',
  },
})
