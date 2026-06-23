import { createContext, useContext, useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Colors } from '@/constants/Colors'

const RoleContext = createContext<string>('model')
export const useAppRole = () => useContext(RoleContext)

export default function RoleRouter({ session }: { session: Session }) {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const metaRole = session.user.user_metadata?.role as string | undefined
    if (metaRole) {
      setRole(metaRole)
      setLoading(false)
      return
    }
    supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRole(data?.role ?? 'model')
        setLoading(false)
      })
  }, [session.user.id])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream }}>
        <ActivityIndicator color={Colors.roseDark} size="large" />
      </View>
    )
  }

  return (
    <RoleContext.Provider value={role ?? 'model'}>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(onboarding)" />
      </Stack>
    </RoleContext.Provider>
  )
}
