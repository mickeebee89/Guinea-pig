import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  Quicksand_400Regular,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand'
import { DancingScript_700Bold } from '@expo-google-fonts/dancing-script'
import { StripeProvider } from '@stripe/stripe-react-native'
import * as Updates from 'expo-updates'
import { AuthProvider, useAuth } from '@/context/auth'
import AppEntry from '@/components/AppEntry'
import { Colors } from '@/constants/Colors'

// Keep the native splash visible until fonts are ready.
SplashScreen.preventAutoHideAsync()

function OtaUpdater() {
  useEffect(() => {
    if (!Updates.isEnabled) return
    ;(async () => {
      try {
        const check = await Updates.checkForUpdateAsync()
        if (!check.isAvailable) return
        await Updates.fetchUpdateAsync()
        await Updates.reloadAsync()
      } catch {}
    })()
  }, [])
  return null
}

function Root() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream }}>
        <ActivityIndicator color={Colors.rose} size="large" />
      </View>
    )
  }

  return <AppEntry />
}

const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Quicksand_400Regular,
    Quicksand_700Bold,
    DancingScript_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync()
  }, [fontsLoaded, fontError])

  const inner = (
    <AuthProvider>
      <OtaUpdater />
      <StatusBar style="dark" />
      <Root />
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
