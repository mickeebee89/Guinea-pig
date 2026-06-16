import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StripeProvider } from '@stripe/stripe-react-native'
import { AuthProvider, useAuth } from '@/context/auth'

function RootRedirect() {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === '(auth)'
    const inOnboarding = segments[0] === '(onboarding)'
    const inApp = segments[0] === '(app)'

    if (!session && !inAuthGroup && segments[0] !== undefined) {
      router.replace('/')
    }
    // Any session-holding user not already in the app gets sent there —
    // covers root, auth screens, and onboarding screen restored by Android task stack
    if (session && segments[0] !== '(app)') {
      router.replace('/(app)')
    }
  }, [session, loading, segments])

  return null
}

const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''

export default function RootLayout() {
  const inner = (
    <AuthProvider>
      <RootRedirect />
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </AuthProvider>
  )

  if (!stripeKey) return inner

  return (
    <StripeProvider
      publishableKey={stripeKey}
      merchantIdentifier="merchant.beauty.guineapig"
      urlScheme="mobile"
    >
      {inner}
    </StripeProvider>
  )
}
