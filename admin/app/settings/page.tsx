'use client'

import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLoader } from '@/lib/useLoader'
import { logAction } from '@/lib/audit'

interface Setting { key: string; value: string }

const KEYS = [
  'verification_price_pence',
  'subscription_price_pence',
  'founding_provider_limit',
  'founding_provider_offer_enabled',
  'image_review_enabled',
  // ⚠️ banned_words GATES PUBLICATION as of migration 0032. It is no longer
  // just a search term list for the moderation tab: a BEFORE INSERT trigger on
  // status_posts screens every post against it, and a hit holds the post for
  // review.
  //
  // As of 7 Sep 2026 it holds ["pretty", "hair", "make", "done"] — placeholder
  // test values. "hair" flags nearly every legitimate post a hair stylist will
  // write, so today the screen queues almost everything. Audit item 17.
  //
  // Too broad and every honest post queues; too narrow and the screen is
  // decoration. Both failures are quiet.
  'banned_words',
] as const

type SettingsMap = Record<typeof KEYS[number], string>

export default function SettingsPage() {
  const [settings, setSettings]     = useState<SettingsMap>({} as SettingsMap)
  const [saving, setSaving]         = useState<string | null>(null)
  const [foundingCount, setFoundingCount] = useState<number>(0)

  const { loading } = useLoader('', async stale => {
    const [{ data }, { count }] = await Promise.all([
      supabase.from('settings').select('key, value').in('key', KEYS as unknown as string[]),
      supabase.from('founding_providers').select('*', { count: 'exact', head: true }),
    ])
    if (stale()) return
    const map = Object.fromEntries((data ?? []).map((r: Setting) => [r.key, r.value])) as SettingsMap
    setSettings(map)
    setFoundingCount(count ?? 0)
  })

  async function saveSetting(key: string, value: string) {
    setSaving(key)
    await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    await logAction('settings_update', { details: { key, value } })
    setSaving(null)
  }

  function updateLocal(key: keyof SettingsMap, value: string) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  // One handler for all three children: write, then reflect. useCallback with
  // no deps is safe because everything it reaches is stable — the two setState
  // functions and the module-level supabase client. It captures no props and no
  // state, so there is nothing here to go stale.
  const handleSave = useCallback(async (key: keyof SettingsMap, value: string) => {
    await saveSetting(key, value)
    updateLocal(key, value)
  }, [])

  if (loading) return <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Settings</h1>

      <div className="bg-white rounded-xl border border-black/5 shadow-sm px-6">
        {/* `initial` is a MOUNT-TIME SEED, not a controlled value. These stay
            mounted across a parent render now, so the field keeps what is being
            typed and does not snap back when something else on the page saves.
            That is the fix; the prop only supplies the starting text. */}
        <PriceField
          label="Provider Verification Price" settingKey="verification_price_pence"
          initial={settings['verification_price_pence'] ?? ''} saving={saving}
          onSave={handleSave} />
        <PriceField
          label="Model Subscription Price" settingKey="subscription_price_pence"
          initial={settings['subscription_price_pence'] ?? ''} saving={saving}
          onSave={handleSave} />
        <PriceField
          label="Founding Provider Slot Limit" settingKey="founding_provider_limit" unit="slots"
          initial={settings['founding_provider_limit'] ?? ''} saving={saving}
          onSave={handleSave} />

        <div className="flex items-center justify-between py-4 border-b border-black/5">
          <div>
            <div className="font-medium text-[#3D2E2E]">Founding Provider Offer</div>
            <div className="text-xs text-[#3D2E2E]/40">{foundingCount} / {settings['founding_provider_limit'] ?? '—'} slots used</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${settings['founding_provider_offer_enabled'] === 'true' ? 'text-[#8C4A58]' : 'text-gray-400'}`}>
              {settings['founding_provider_offer_enabled'] === 'true' ? 'ON' : 'OFF'}
            </span>
            <Toggle settingKey="founding_provider_offer_enabled"
              on={settings['founding_provider_offer_enabled'] === 'true'} onSave={handleSave} />
          </div>
        </div>

        <div className="flex items-center justify-between py-4 border-b border-black/5">
          <div>
            <div className="font-medium text-[#3D2E2E]">Image Review Required</div>
            <div className="text-xs text-[#3D2E2E]/40">When ON, portfolio images are held for admin approval before going live</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${settings['image_review_enabled'] === 'true' ? 'text-[#8C4A58]' : 'text-gray-400'}`}>
              {settings['image_review_enabled'] === 'true' ? 'ON' : 'OFF'}
            </span>
            <Toggle settingKey="image_review_enabled"
              on={settings['image_review_enabled'] === 'true'} onSave={handleSave} />
          </div>
        </div>

        <BannedWords initial={settings['banned_words'] ?? ''} onSave={handleSave} />
      </div>
    </div>
  )
}

/* ===========================================================================
   THE THREE CONTROLS — MODULE SCOPE, AND THAT IS THE POINT.

   All three used to be declared inside SettingsPage's render body. A component
   created during render has a NEW FUNCTION IDENTITY on every render, so React
   does not re-render it — it unmounts the old one and mounts a new one, and
   the new one's useState starts from its initial value again.

   SettingsPage re-renders whenever settings, saving or foundingCount change.
   So flipping either toggle, or pressing Save on any field, threw away every
   unsaved edit in every other field, with no error and nothing on screen.

   The worst case was Banned Words. Paste a list, flip Image Review before
   saving, and the list is gone — and since 0032 that list GATES PUBLICATION.
   The stored value was never at risk; the editing was.

   Found by react-hooks/static-components when the lint gate went on (audit
   item 26). Nothing else would have found it: it produces no error, no warning
   and no wrong data — only work quietly disappearing.
   =========================================================================== */

function Toggle({
  settingKey, on, onSave,
}: {
  settingKey: 'founding_provider_offer_enabled' | 'image_review_enabled'
  on: boolean
  onSave: (key: keyof SettingsMap, value: string) => Promise<void>
}) {
  return (
    <button onClick={() => onSave(settingKey, String(!on))}
      className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-[#8C4A58]' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  )
}

function PriceField({
  label, settingKey, unit = 'pence', initial, saving, onSave,
}: {
  label: string
  settingKey: 'verification_price_pence' | 'subscription_price_pence' | 'founding_provider_limit'
  unit?: string
  initial: string
  saving: string | null
  onSave: (key: keyof SettingsMap, value: string) => Promise<void>
}) {
  const [local, setLocal] = useState(initial)
  return (
    <div className="flex items-center justify-between py-4 border-b border-black/5 last:border-0">
      <div>
        <div className="font-medium text-[#3D2E2E]">{label}</div>
        <div className="text-xs text-[#3D2E2E]/40">
          {unit === 'pence' && local ? `£${(parseInt(local) / 100).toFixed(2)}` : `${local} slots`}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={local}
          onChange={e => setLocal(e.target.value)}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm w-28 text-right"
        />
        <span className="text-xs text-[#3D2E2E]/40">{unit}</span>
        <button
          onClick={() => onSave(settingKey, local)}
          disabled={saving === settingKey}
          className="px-3 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#8C4A58' }}>
          {saving === settingKey ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function BannedWords({
  initial, onSave,
}: {
  /** The raw JSON string from settings. Parsed here, once, into the textarea. */
  initial: string
  onSave: (key: keyof SettingsMap, value: string) => Promise<void>
}) {
  const [text, setText] = useState(() => {
    try { return (JSON.parse(initial || '[]') as string[]).join('\n') } catch { return '' }
  })
  return (
    <div className="py-4 border-b border-black/5">
      <div className="font-medium text-[#3D2E2E] mb-1">Banned Words</div>
      <div className="text-xs text-[#3D2E2E]/40 mb-3">
        One word or phrase per line. Messages and reviews containing these are flagged for manual
        review, and since migration 0032 a status post containing one is HELD rather than published.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        placeholder="Enter one word per line…"
        className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none font-mono"
      />
      <button
        onClick={async () => {
          const words = text.split('\n').map(w => w.trim()).filter(Boolean)
          setText(words.join('\n'))
          await onSave('banned_words', JSON.stringify(words))
        }}
        className="mt-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
        style={{ backgroundColor: '#8C4A58' }}>
        Save Banned Words
      </button>
    </div>
  )
}
