import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/Colors'
import { supabase } from '@/lib/supabase'
import { pendingAuth } from '@/lib/pendingAuth'

interface Props {
  email: string
  role: string
  first: string
  initial: string
  onBack: () => void
}

export default function ConfirmEmailScreen({ email, role, first, initial, onBack }: Props) {
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
      setErrorMsg('Session expired — tap "Use a different email address" below to go back, then log in with your email and password.')
      return
    }

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
            const { data: existingProv } = await supabase
              .from('providers')
              .select('id')
              .eq('user_id', uid)
              .maybeSingle()
            if (!existingProv) {
              const handle = `${first ?? ''}${initial ? '-' + initial : ''}`
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || 'stylist'
              const displayName = `${first ?? ''}${initial ? ' ' + initial + '.' : ''}`.trim() || 'Stylist'

              const { error: provInsertErr } = await supabase
                .from('providers')
                .insert({
                  user_id:       uid,
                  shop_handle:   handle,
                  level:         'beginner',
                  region:        'UK',
                  name:          displayName,
                  is_published:  true,
                  location_text: '',
                })
              if (provInsertErr) {
                console.log('[ConfirmEmail] providers insert error:', provInsertErr.code, provInsertErr.message)
                Alert.alert(
                  'Provider row insert failed',
                  `code: ${provInsertErr.code}\nmessage: ${provInsertErr.message}\ndetails: ${provInsertErr.details ?? '—'}\nhint: ${provInsertErr.hint ?? '—'}`,
                )
              }
            }
          }
        } catch (e) {
          console.log('[ConfirmEmail] profile upsert error:', e)
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        // onAuthStateChange fires SIGNED_IN → AppEntry renders the app Stack automatically.
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
    onBack()
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="mail" size={48} color={Colors.roseDark} />
          </View>

          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.body}>
            We've sent a confirmation link to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.hint}>
            Tap the link in the email, then come back to this screen and tap the button below.
            If the link opened a blank page in your browser, just come back here — your email is still confirmed.
          </Text>

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

          {!!errorMsg && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}

          {resent && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#1D9E75" />
              <Text style={styles.successText}>Confirmation email resent!</Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, checking && { opacity: 0.7 }]}
            onPress={handleContinue}
            disabled={checking}
            activeOpacity={0.9}
          >
            {checking
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.primaryBtnText}>I've confirmed my email — sign in</Text>
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
    fontFamily: 'DancingScript_700Bold',
    fontSize: 39, color: Colors.warmDark,
    letterSpacing: -0.5, textAlign: 'center', marginBottom: 12,
  },
  body: {
    fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 23, marginBottom: 8,
  },
  emailHighlight: { fontWeight: '700', color: Colors.warmDark },
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

  actions: { paddingBottom: 12, gap: 10 },
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
