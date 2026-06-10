import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStripe } from '@stripe/stripe-react-native'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SubscribeScreen() {
  const router  = useRouter()
  const insets  = useSafeAreaInsets()
  const { session } = useAuth()
  const { providerId, providerName } = useLocalSearchParams<{
    providerId:   string
    providerName: string
  }>()
  const { initPaymentSheet, presentPaymentSheet } = useStripe()

  const [step,    setStep]    = useState<'benefits' | 'success'>('benefits')
  const [loading, setLoading] = useState(false)

  const handleSubscribe = useCallback(async () => {
    setLoading(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      // Ask edge function to create (or retrieve) subscription
      const { data, error: fnErr } = await supabase.functions.invoke('stripe-payment', {
        body: { action: 'create_subscription' },
      })
      if (fnErr) throw new Error(fnErr.message ?? 'Could not start subscription. Please try again.')

      // Already active — skip payment sheet
      if (data?.alreadyActive) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setLoading(false)
        setStep('success')
        return
      }

      if (!data?.clientSecret) throw new Error('Could not start subscription. Please try again.')

      // Init payment sheet
      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: 'Guinea Pig',
        paymentIntentClientSecret: data.clientSecret,
        returnURL: 'mobile://stripe-return',
        defaultBillingDetails: { email: session?.user?.email },
        appearance: {
          colors:  { primary: Colors.roseDark },
          shapes:  { borderRadius: 14 },
        },
      })
      if (initErr) throw new Error(initErr.message)

      setLoading(false)

      // Present payment sheet
      const { error: presentErr } = await presentPaymentSheet()
      if (presentErr) {
        if (presentErr.code === 'Canceled') return
        throw new Error(presentErr.message)
      }

      // Confirm server-side
      setLoading(true)
      const { error: confirmErr } = await supabase.functions.invoke('stripe-payment', {
        body: {
          action:         'confirm_subscription',
          subscriptionId: data.subscriptionId,
          customerId:     data.customerId,
        },
      })
      if (confirmErr) {
        // Subscription active in Stripe; webhook will sync DB — proceed
        console.warn('[subscribe] confirm_subscription failed:', confirmErr.message)
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setLoading(false)
      setStep('success')
    } catch (err: any) {
      setLoading(false)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Subscription failed', err.message ?? 'Please try again or contact support.')
    }
  }, [initPaymentSheet, presentPaymentSheet, session])

  const goToSession = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    router.replace({
      pathname: '/(app)/apply-session' as any,
      params:   { providerId, providerName },
    })
  }, [router, providerId, providerName])

  return (
    <View style={styles.container}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.roseDark} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          {step === 'success' ? 'Subscribed' : 'Unlock Premium'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* ── BENEFITS ── */}
      {step === 'benefits' && (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroIconRing}>
              <Ionicons name="sparkles" size={40} color={Colors.white} />
            </View>
            <Text style={styles.heroTitle}>Guinea Pig Premium</Text>
            <Text style={styles.heroSub}>
              Unlock unlimited session applications and exclusive features with a monthly subscription.
            </Text>

            {/* Price badge */}
            <View style={styles.priceBadge}>
              <Text style={styles.priceAmount}>£2.99</Text>
              <Text style={styles.pricePeriod}> / month</Text>
            </View>
            <Text style={styles.cancelNote}>Cancel anytime · No hidden fees</Text>
          </View>

          {/* What's included */}
          <Text style={styles.sectionLabel}>What's included</Text>
          <View style={styles.benefitsCard}>
            {BENEFITS.map(b => (
              <View key={b.title} style={styles.benefitRow}>
                <View style={styles.benefitIconWrap}>
                  <Ionicons name={b.icon as any} size={20} color={Colors.roseDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.benefitTitle}>{b.title}</Text>
                  <Text style={styles.benefitDesc}>{b.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Why subscribe */}
          <View style={styles.nudgeCard}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.roseDark} style={{ marginTop: 1 }} />
            <Text style={styles.nudgeText}>
              You tried to apply for a session with{' '}
              <Text style={{ fontWeight: '700' }}>{providerName || 'this provider'}</Text>.
              {' '}A subscription lets you apply to any session — instantly.
            </Text>
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleSubscribe}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <>
                  <Ionicons name="card-outline" size={20} color={Colors.white} />
                  <Text style={styles.primaryBtnText}>Subscribe for £2.99/month</Text>
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.8}
          >
            <Text style={styles.ghostBtnText}>Not now</Text>
          </TouchableOpacity>

          <Text style={styles.legalNote}>
            Secured by Stripe · Your subscription renews monthly until cancelled · Cancel from Settings
          </Text>
        </ScrollView>
      )}

      {/* ── SUCCESS ── */}
      {step === 'success' && (
        <View style={styles.centred}>
          <View style={styles.successIconRing}>
            <Ionicons name="sparkles" size={52} color={Colors.roseDark} />
          </View>
          <Text style={styles.successTitle}>Subscription active! 🎉</Text>
          <Text style={styles.successSub}>
            You now have unlimited session applications. Your card will be charged £2.99 on the same date each month.
          </Text>

          <View style={styles.successPerks}>
            {BENEFITS.slice(0, 3).map(b => (
              <View key={b.title} style={styles.successPerkRow}>
                <Ionicons name="checkmark-circle" size={18} color="#1D9E75" />
                <Text style={styles.successPerkText}>{b.title}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={goToSession}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>Continue to session</Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.white} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back() }}
            activeOpacity={0.8}
          >
            <Text style={styles.ghostBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BENEFITS = [
  {
    icon:  'infinite-outline',
    title: 'Unlimited applications',
    desc:  'Apply to as many sessions as you like — no cap.',
  },
  {
    icon:  'star-outline',
    title: 'Priority matching',
    desc:  'Your applications appear at the top of provider inboxes.',
  },
  {
    icon:  'shield-checkmark-outline',
    title: 'Exclusive session access',
    desc:  'Some providers accept Premium subscribers only.',
  },
  {
    icon:  'chatbubble-ellipses-outline',
    title: 'Direct messaging',
    desc:  'Message providers before committing to a booking.',
  },
  {
    icon:  'analytics-outline',
    title: 'Session insights',
    desc:  'Track your history, earnings, and review scores.',
  },
]

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

  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 0 },

  // Hero
  heroCard: {
    backgroundColor: Colors.roseDark, borderRadius: 24, padding: 24,
    alignItems: 'center', gap: 10, marginBottom: 24,
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 6,
  },
  heroIconRing: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: { fontSize: 24, fontWeight: '900', color: Colors.white, letterSpacing: -0.5 },
  heroSub:   { fontSize: 14, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 20 },

  priceBadge:   { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  priceAmount:  { fontSize: 38, fontWeight: '900', color: Colors.white, letterSpacing: -1 },
  pricePeriod:  { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  cancelNote:   { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },

  // Benefits
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10, paddingHorizontal: 2,
  },
  benefitsCard: {
    backgroundColor: Colors.white, borderRadius: 18,
    padding: 4, gap: 0, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  benefitRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  benefitIconWrap: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.softPink + '40',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  benefitTitle: { fontSize: 14, fontWeight: '700', color: Colors.warmDark, marginBottom: 2 },
  benefitDesc:  { fontSize: 12, color: Colors.muted, lineHeight: 17 },

  // Nudge
  nudgeCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: Colors.softPink + '30',
    borderRadius: 14, padding: 14, marginBottom: 20,
    borderWidth: 1, borderColor: Colors.softPink,
  },
  nudgeText: { flex: 1, fontSize: 13, color: Colors.warmDark, lineHeight: 19 },

  // Buttons
  primaryBtn: {
    width: '100%', height: 54, backgroundColor: Colors.roseDark,
    borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.white, letterSpacing: -0.2 },
  ghostBtn: {
    width: '100%', height: 48, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  ghostBtnText:  { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  legalNote: {
    fontSize: 11, color: Colors.muted, textAlign: 'center',
    lineHeight: 16, marginTop: 12, paddingHorizontal: 8,
  },

  // Success
  successIconRing: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: Colors.softPink + '40',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  successTitle: {
    fontSize: 24, fontWeight: '900', color: Colors.warmDark,
    textAlign: 'center', letterSpacing: -0.5,
  },
  successSub: {
    fontSize: 14, color: Colors.muted, textAlign: 'center',
    lineHeight: 21, marginBottom: 4,
  },
  successPerks: {
    backgroundColor: Colors.white, borderRadius: 16,
    padding: 16, gap: 12, width: '100%',
    borderWidth: 1, borderColor: Colors.border, marginBottom: 8,
  },
  successPerkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  successPerkText: { fontSize: 14, fontWeight: '500', color: Colors.warmDark },
})
