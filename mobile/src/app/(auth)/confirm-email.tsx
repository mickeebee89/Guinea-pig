import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'
import { supabase } from '@/lib/supabase'
import { pendingAuth } from '@/lib/pendingAuth'
import { useAuth } from '@/context/auth'

export default function ConfirmEmailScreen() {
  const router = useRouter()
  const { setRole } = useAuth()
  const { email, role, first, initial } = useLocalSearchParams<{ email: string; role: string; first: string; initial: string }>()

  const [checking,  setChecking]  = useState(false)
  const [resending, setResending] = useState(false)
  const [resent,    setResent]    = useState(false)
  const [errorMsg,  setErrorMsg]  = useState('')

  const handleContinue = async () => {
    setErrorMsg('')
    setChecking(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    const creds = pendingAuth.get()
    if (!creds) {
      setChecking(false)
      setErrorMsg('Session expired. Please log in with your email and password.')
      return
    }

    // 10s timeout so the spinner can never hang forever
    const timeoutId = setTimeout(() => {
      setChecking(false)
      setErrorMsg('Request timed out. Please check your connection and try again.')
    }, 10000)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email:    creds.email,
        password: creds.password,
      })

      clearTimeout(timeoutId)

      if (error) {
        setChecking(false)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        if (error.message.toLowerCase().includes('not confirmed') || error.message.toLowerCase().includes('email')) {
          setErrorMsg("Your email hasn't been confirmed yet. Please tap the link in your inbox.")
        } else {
          setErrorMsg(error.message)
        }
        return
      }

      if (data.session) {
        pendingAuth.clear()
        if (role) setRole(role as 'model' | 'provider')

        // Ensure profile rows exist — they may have failed during signUp() if email
        // confirmation was required (no session at that point, so RLS blocked the inserts)
        try {
          const uid = data.session.user.id
          await supabase.from('users').upsert({
            id:           uid,
            email:        data.session.user.email ?? email ?? '',
            role:         role || 'model',
            first_name:   first || '',
            last_initial: initial || null,
            region:       'UK',
          }, { onConflict: 'id', ignoreDuplicates: true })

          if (role === 'provider') {
            const displayName = first && initial ? `${first} ${initial}.` : (first || 'Stylist')
            await supabase.from('providers').upsert({
              user_id:      uid,
              name:         displayName,
              is_published: false,
              is_verified:  false,
              rating:       0,
              review_count: 0,
            }, { onConflict: 'user_id', ignoreDuplicates: true })
          }
        } catch (e) {
          console.log('[ConfirmEmail] profile upsert error:', e)
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        if (role === 'provider') {
          router.replace('/(app)/provider-dashboard' as any)
        } else {
          router.replace('/(app)')
        }
      } else {
        setChecking(false)
        setErrorMsg("Your email hasn't been confirmed yet. Please tap the link in your inbox.")
      }
    } catch {
      clearTimeout(timeoutId)
      setChecking(false)
      setErrorMsg('Something went wrong. Please try again.')
    }
  }

  const handleResend = async () => {
    setResending(true)
    setResent(false)
    setErrorMsg('')
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    const { error } = await supabase.auth.resend({
      type:  'signup',
      email: email ?? '',
    })

    setResending(false)
    if (error) {
      setErrorMsg(error.message)
    } else {
      setResent(true)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    pendingAuth.clear()
    router.replace('/(auth)/signup')
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="mail" size={48} color={Colors.roseDark} />
          </View>

          {/* Heading */}
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.body}>
            We've sent a confirmation link to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.hint}>
            Tap the link in the email to activate your account, then come back here.
          </Text>

          {/* Steps */}
          <View style={styles.steps}>
            {[
              { n: '1', text: 'Open the email from Guinea Pig' },
              { n: '2', text: 'Tap the "Confirm your email" link' },
              { n: '3', text: 'Return here and tap Continue' },
            ].map(s => (
              <View key={s.n} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{s.n}</Text>
                </View>
                <Text style={styles.stepText}>{s.text}</Text>
              </View>
            ))}
          </View>

          {/* Error */}
          {!!errorMsg && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {/* Resent confirmation */}
          {resent && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#1D9E75" />
              <Text style={styles.successText}>Confirmation email resent!</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, checking && { opacity: 0.7 }]}
            onPress={handleContinue}
            disabled={checking}
            activeOpacity={0.9}
          >
            {checking
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.primaryBtnText}>I've confirmed — continue</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={handleResend}
            disabled={resending}
            activeOpacity={0.8}
          >
            {resending
              ? <ActivityIndicator color={Colors.roseDark} size="small" />
              : <Text style={styles.ghostBtnText}>Resend confirmation email</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={handleBack} activeOpacity={0.7} style={styles.backLink}>
            <Text style={styles.backLinkText}>Use a different email address</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream },
  safe:      { flex: 1, paddingHorizontal: 28 },
  content:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: Colors.softPink + '50',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },

  title: {
    fontSize: 26, fontWeight: '800', color: Colors.warmDark,
    letterSpacing: -0.5, textAlign: 'center', marginBottom: 12,
  },
  body: {
    fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 23, marginBottom: 8,
  },
  emailHighlight: {
    fontWeight: '700', color: Colors.warmDark,
  },
  hint: {
    fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19, marginBottom: 28,
  },

  steps: {
    width: '100%', backgroundColor: Colors.white,
    borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 20,
  },
  stepRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.softPink + '60',
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: Colors.roseDark },
  stepText:    { flex: 1, fontSize: 14, color: Colors.warmDark, lineHeight: 19 },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12,
    width: '100%', marginBottom: 4,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },

  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#ECFDF5', borderRadius: 12, padding: 12,
    width: '100%', marginBottom: 4,
  },
  successText: { fontSize: 13, color: '#1D9E75', fontWeight: '500' },

  actions: {
    paddingBottom: 12, gap: 10,
  },
  primaryBtn: {
    height: 54, backgroundColor: Colors.roseDark, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.roseDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.white, letterSpacing: -0.2 },
  ghostBtn: {
    height: 50, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: Colors.warmDark },
  backLink:     { alignItems: 'center', paddingVertical: 6 },
  backLinkText: { fontSize: 13, color: Colors.muted, textDecorationLine: 'underline' },
})
