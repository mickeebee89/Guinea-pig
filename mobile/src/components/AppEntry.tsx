import { createContext, useContext, useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useAuth } from '@/context/auth'
import { supabase } from '@/lib/supabase'
import { Colors } from '@/constants/Colors'
import WelcomeScreen    from '@/screens/auth/WelcomeScreen'
import LoginScreen      from '@/screens/auth/LoginScreen'
import SignupScreen     from '@/screens/auth/SignupScreen'
import ConfirmEmailScreen from '@/screens/auth/ConfirmEmailScreen'

type AuthView = 'welcome' | 'login' | 'signup' | 'confirm-email'

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

  // Auth-screen navigation state (only used when !session)
  const [authView,       setAuthView]       = useState<AuthView>('welcome')
  const [signupRole,     setSignupRole]     = useState<'model' | 'provider'>('model')
  const [confirmParams,  setConfirmParams]  = useState<ConfirmParams | null>(null)

  // Role for the authenticated app
  const [role,        setRole]        = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)

  useEffect(() => {
    if (!session) {
      setRole(null)
      setRoleLoading(false)
      return
    }

    setRoleLoading(true)

    const metaRole = session.user.user_metadata?.role as string | undefined
    if (metaRole) {
      setRole(metaRole)
      setRoleLoading(false)
      return
    }

    supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRole(data?.role ?? 'model')
        setRoleLoading(false)
      })
  }, [session?.user.id])

  // Reset auth flow to welcome when session disappears (sign-out)
  useEffect(() => {
    if (!session) {
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
