import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StripeProvider } from '@stripe/stripe-react-native'
import { AuthProvider, useAuth } from '@/context/auth'

function RootRedirect() {
  const { session, loading, roleLoaded, role } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading || !roleLoaded) return
    const inAuthGroup = segments[0] === '(auth)'

    if (!session && !inAuthGroup && segments[0] !== undefined) {
      router.replace('/')
    }
    if (session && segments[0] !== '(app)') {
      if (role === 'provider') {
        router.replace('/(app)/provider-dashboard' as any)
      } else {
        router.replace('/(app)')
      }
    }
  }, [session, loading, roleLoaded, role, segments])

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
