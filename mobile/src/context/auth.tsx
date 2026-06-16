import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthContextType {
  session: Session | null
  loading: boolean
  role: 'model' | 'provider' | 'both' | null
  setRole: (role: 'model' | 'provider' | 'both') => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  role: null,
  setRole: () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRoleState] = useState<'model' | 'provider' | 'both' | null>(null)
  const isSigningOut = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isSigningOut.current) {
        setSession(session)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

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
    <AuthContext.Provider value={{ session, loading, role, setRole, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
