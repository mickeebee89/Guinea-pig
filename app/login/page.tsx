'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      // Generic message — never reveal which field was wrong.
      setError('Invalid email or password')
      setLoading(false)
      return
    }

    // Invalidate the Router Cache so the just-set session cookie is picked up —
    // without this the soft-nav to '/' serves the stale pre-login segment and hangs.
    router.replace('/')
    router.refresh()
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ backgroundColor: '#F7F1EC' }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-black/5 p-8"
      >
        <div className="mb-6">
          <div className="text-lg font-bold" style={{ color: '#3D2E2E' }}>Guinea Pig</div>
          <div className="text-sm" style={{ color: '#C8788A' }}>Admin Console — sign in</div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <label className="block text-xs font-medium text-black/60 mb-1">Email</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="w-full mb-4 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#8C4A58]"
        />

        <label className="block text-xs font-medium text-black/60 mb-1">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="w-full mb-6 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#8C4A58]"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: '#8C4A58' }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
