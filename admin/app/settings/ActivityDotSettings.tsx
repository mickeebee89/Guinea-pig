'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import {
  ACTIVITY_KEYS, KEY_LABEL, KEY_NOTE, fetchActivityCounts, type ActivityKey,
} from '@/lib/activity'

/**
 * Which sidebar dots this admin wants to see.
 *
 * ── ⚠️⚠️ THESE CHANGE NOTHING ABOUT THE DATA ────────────────────────────
 * A mute hides a dot. It does not stop an ID check arriving, hold a report, or
 * make anything invisible anywhere else in the console — the queues still fill
 * and the pages still list them. That sentence is on screen, not just here,
 * because a toggle in a settings page that sits under "Image Review Required"
 * could very reasonably be read as doing something to the product.
 *
 * ── ⚠️ PER ADMIN, NOT GLOBAL ────────────────────────────────────────────
 * `admin_activity_seen` is keyed on (admin_user_id, key) and its RLS is
 * `admin_user_id = auth.uid() and is_admin()`. Muting here is this admin's
 * choice and is invisible to the other one.
 *
 * ── ⚠️ WHY THIS WRITES THE TABLE DIRECTLY AND THE WATERMARK DOES NOT ────
 * 0104 grants the client INSERT and UPDATE on exactly (admin_user_id, key,
 * muted) — and deliberately NOT on last_seen_at, which only
 * `admin_mark_activity_seen` may move. So this upsert can change a mute and
 * cannot silently advance or rewind what counts as new.
 */
export function ActivityDotSettings() {
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const { loading } = useLoader('activity-mutes', async stale => {
    // ⚠️ READ THROUGH THE RPC, NOT THE TABLE. A first-ever visit has no rows at
    // all, and admin_activity_counts seeds them. Reading the table directly
    // would show eleven unset toggles that silently differ from what the
    // sidebar is already using.
    const rows = await fetchActivityCounts()
    if (stale()) return
    setMuted(Object.fromEntries(rows.map(r => [r.key, r.muted])))
  })

  async function toggle(key: ActivityKey) {
    const next = !muted[key]
    setSaving(key)
    setProblem(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setProblem('Could not tell who you are signed in as. Nothing was changed.')
      setSaving(null)
      return
    }

    const { error } = await supabase
      .from('admin_activity_seen')
      .upsert({ admin_user_id: user.id, key, muted: next }, { onConflict: 'admin_user_id,key' })

    if (error) {
      // ⚠️ SAID, NOT SWALLOWED. A toggle that flips back on its own and
      // explains nothing is how someone concludes the console is broken.
      setProblem(`Couldn't save that: ${error.message}`)
    } else {
      setMuted(m => ({ ...m, [key]: next }))
    }
    setSaving(null)
  }

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 mt-6">
      <h2 className="font-semibold text-[#3D2E2E]">Sidebar dots</h2>
      <p className="mt-1 text-sm text-[#3D2E2E]/60">
        A red dot means something new since you last looked. Muting one hides
        that dot <strong>for you only</strong> — it changes nothing about the data, and the
        queues still fill exactly as they do now.
      </p>

      {problem && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-[#3D2E2E]/60">Loading…</p>
      ) : (
        <ul className="mt-3">
          {ACTIVITY_KEYS.map(key => (
            <li key={key} className="flex items-start justify-between gap-4 border-b border-black/5 py-3 last:border-0">
              <div className="min-w-0">
                <div className="font-medium text-[#3D2E2E]">{KEY_LABEL[key]}</div>
                <div className="text-xs text-[#3D2E2E]/40">{KEY_NOTE[key]}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-xs font-medium ${muted[key] ? 'text-gray-400' : 'text-[#8C4A58]'}`}>
                  {muted[key] ? 'MUTED' : 'ON'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!muted[key]}
                  aria-label={`${KEY_LABEL[key]} dot`}
                  disabled={saving === key}
                  onClick={() => void toggle(key)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    muted[key] ? 'bg-gray-300' : 'bg-[#8C4A58]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      muted[key] ? 'left-0.5' : 'left-[1.375rem]'
                    }`}
                  />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
