import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
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
    if (session && (inAuthGroup || segments[0] === undefined || segments[0] === '')) {
      router.replace('/(onboarding)/profile-pic')
    }
  }, [session, loading, segments])

  return null
}

export default function RootLayout() {
  return (
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
}
