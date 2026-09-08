import { createContext, useContext, useEffect, useState } from 'react'
import { View, ActivityIndicator, Alert } from 'react-native'
import { Stack } from 'expo-router'
import { useAuth } from '@/context/auth'
import { ensureProfile } from '@/lib/ensureProfile'
import { usePushRegistration } from '@/lib/push'
import { Colors } from '@/constants/Colors'
import WelcomeScreen    from '@/screens/auth/WelcomeScreen'
import LoginScreen      from '@/screens/auth/LoginScreen'
import SignupScreen     from '@/screens/auth/SignupScreen'
import ConfirmEmailScreen from '@/screens/auth/ConfirmEmailScreen'
import ForgotPasswordScreen from '@/screens/auth/ForgotPasswordScreen'

type AuthView = 'welcome' | 'login' | 'signup' | 'confirm-email' | 'forgot-password'

interface ConfirmParams {
  email:   string
  role:    string
  first:   string
  initial: string
}

const RoleContext = createContext<string>('model')
export const useAppRole = () => useContext(RoleContext)

export default function AppEntry() {
  const { session } = useAuth()

  // Register this device for push once signed in (no-op when signed out / on emulators).
  usePushRegistration(session?.user?.id)

  // Auth-screen navigation state (only used when !session)
  const [authView,       setAuthView]       = useState<AuthView>('welcome')
  const [signupRole,     setSignupRole]     = useState<'model' | 'provider'>('model')
  const [confirmParams,  setConfirmParams]  = useState<ConfirmParams | null>(null)
  const [forgotEmail,    setForgotEmail]    = useState('')

  // Role for the authenticated app.
  //
  // ── THE ANSWER IS STORED WITH THE USER IT IS FOR ───────────────────
  // `roleLoading` used to be a flag set true synchronously in the effect and
  // cleared in two places, which meant the flag and the answer could disagree
  // for a render — and on sign-out the effect existed only to undo state. It is
  // a comparison instead: the role I hold is not for the user I am looking at.
  // Same fix as SuspensionGate, and the same one admin's useLoader is built on.
  const uid = session?.user.id ?? null
  const [roleAnswer, setRoleAnswer] =
    useState<{ forUser: string; role: string | null } | null>(null)
  const roleLoading = uid !== null && roleAnswer?.forUser !== uid
  const role = roleLoading ? null : (roleAnswer?.role ?? null)

  useEffect(() => {
    if (!session) return

    // Resolve the role AND self-heal any half-created account in one pass: this
    // checks whether the users (and providers) row exists and recreates only the
    // missing ones. Healthy accounts incur a SELECT or two and no writes. We can't
    // short-circuit on metaRole here — an account can have role in metadata yet be
    // missing its users row (that's exactly the half-created case we heal).
    let cancelled = false
    ensureProfile(session).then(({ role: resolvedRole, error }) => {
      if (cancelled) return
      if (error) {
        Alert.alert(
          'Account setup issue',
          "We couldn't finish loading your account, please try again.",
        )
      }
      setRoleAnswer({ forUser: session.user.id, role: resolvedRole })
    })

    return () => { cancelled = true }
    // Keyed on the user id, not the session object: the session identity changes
    // on every token refresh (roughly hourly) and re-running ensureProfile then
    // would be pointless work. The closure's session is stale only in its token,
    // which is not what ensureProfile reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  /**
   * ⚠️ DOCUMENTED EXCEPTION — react-hooks/set-state-in-effect, 8 Sep 2026.
   *
   * Reset the auth flow to welcome when the session disappears (sign-out).
   * Without it, signing out of an account you reached via the login screen
   * drops you back on that login screen with stale confirm params.
   *
   * THE HONEST FIX IS A RESTRUCTURE, NOT A REWORDING. `authView`,
   * `confirmParams` and `forgotEmail` all live in this component and are read
   * only in the signed-out branch. Moving them into a child keyed on
   * `session?.user.id` would make the reset a remount and remove this effect
   * entirely — which is the correct answer and is a refactor of the component
   * that gates the whole app.
   *
   * It is NOT done here, and NOT silenced by hiding the call behind a ref: the
   * rule is right, and a ref would leave the anti-pattern in place while making
   * it invisible. Recorded as an exception so the next person sees a judgement
   * rather than a clean report.
   */
  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthView('welcome')
      setConfirmParams(null)
    }
  }, [session])

  if (!session) {
    if (authView === 'login') {
      return (
        <LoginScreen
          onBack={() => setAuthView('welcome')}
          onGoSignup={() => setAuthView('signup')}
          onGoForgot={(e) => { setForgotEmail(e); setAuthView('forgot-password') }}
        />
      )
    }

    if (authView === 'signup') {
      return (
        <SignupScreen
          role={signupRole}
          onBack={() => setAuthView('welcome')}
          onGoLogin={() => setAuthView('login')}
          onNeedConfirmation={params => {
            setConfirmParams(params)
            setAuthView('confirm-email')
          }}
        />
      )
    }

    if (authView === 'forgot-password') {
      return (
        <ForgotPasswordScreen
          initialEmail={forgotEmail}
          onBack={() => setAuthView('login')}
          onGoLogin={() => setAuthView('login')}
        />
      )
    }

    if (authView === 'confirm-email' && confirmParams) {
      return (
        <ConfirmEmailScreen
          email={confirmParams.email}
          role={confirmParams.role}
          first={confirmParams.first}
          initial={confirmParams.initial}
          onBack={() => setAuthView('signup')}
        />
      )
    }

    // Default: welcome
    return (
      <WelcomeScreen
        onSelectRole={r => {
          setSignupRole(r)
          setAuthView('signup')
        }}
        onGoLogin={() => setAuthView('login')}
      />
    )
  }

  if (roleLoading || !role) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream }}>
        <ActivityIndicator color={Colors.roseDark} size="large" />
      </View>
    )
  }

  return (
    <RoleContext.Provider value={role}>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(onboarding)" />
      </Stack>
    </RoleContext.Provider>
  )
}
