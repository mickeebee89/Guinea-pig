import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthContextType {
  session: Session | null
  loading: boolean
  roleLoaded: boolean
  role: 'model' | 'provider' | 'both' | null
  setRole: (role: 'model' | 'provider' | 'both') => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  roleLoaded: false,
  role: null,
  setRole: () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [role, setRoleState] = useState<'model' | 'provider' | 'both' | null>(null)
  const isSigningOut = useRef(false)

  const fetchRole = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
      setRoleState((data?.role ?? null) as any)
    } catch {
      setRoleState(null)
    }
    setRoleLoaded(true)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user?.id) {
        await fetchRole(session.user.id)
      } else {
        setRoleLoaded(true)
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isSigningOut.current) {
        setRoleLoaded(false)
        setSession(session)
        if (session?.user?.id) {
          await fetchRole(session.user.id)
        } else {
          setRoleState(null)
          setRoleLoaded(true)
        }
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchRole])

  const setRole = (r: 'model' | 'provider' | 'both') => setRoleState(r)

  const signOut = async () => {
    isSigningOut.current = true
    setSession(null)
    setRoleState(null)
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise<void>(resolve => setTimeout(resolve, 5000)),
      ])
    } catch {}
    isSigningOut.current = false
  }

  return (
    <AuthContext.Provider value={{ session, loading, roleLoaded, role, setRole, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
