import { createContext, useContext, useEffect, useState } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Colors } from '@/constants/Colors'

const RoleContext = createContext<string>('model')
export const useAppRole = () => useContext(RoleContext)

export default function RoleRouter({ session }: { session: Session }) {
  /**
   * ── THE COMMON CASE IS NOT A FETCH, SO IT IS NOT STATE ───────────────
   *
   * The role is usually sitting in the session metadata we were handed, and
   * copying it into state through an effect meant one guaranteed extra render
   * with `loading` true — a spinner flashed for a value we already had.
   *
   * Derived here instead. The effect now runs ONLY in the case that genuinely
   * needs a query: metadata with no role on it.
   */
  const metaRole = session.user.user_metadata?.role as string | undefined
  const [fetchedRole, setFetchedRole] = useState<string | null>(null)
  const role = metaRole ?? fetchedRole
  const loading = !role

  useEffect(() => {
    if (metaRole) return
    let cancelled = false
    supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        // Cancellation added with the rewrite: without it a fast sign-out and
        // sign-in as the other role could land the first answer last.
        if (!cancelled) setFetchedRole(data?.role ?? 'model')
      })
    return () => { cancelled = true }
  }, [session.user.id, metaRole])

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
