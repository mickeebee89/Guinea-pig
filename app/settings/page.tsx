'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface Setting { key: string; value: string }

const KEYS = [
  'verification_price_pence',
  'subscription_price_pence',
  'founding_provider_limit',
  'founding_provider_offer_enabled',
  'image_review_enabled',
  'materials_cost_cap_pence',
  'banned_words',
] as const

type SettingsMap = Record<typeof KEYS[number], string>

export default function SettingsPage() {
  const [settings, setSettings]     = useState<SettingsMap>({} as SettingsMap)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState<string | null>(null)
  const [foundingCount, setFoundingCount] = useState<number>(0)

  async function load() {
    const [{ data }, { count }] = await Promise.all([
      supabase.from('settings').select('key, value').in('key', KEYS as unknown as string[]),
      supabase.from('founding_providers').select('*', { count: 'exact', head: true }),
    ])
    const map = Object.fromEntries((data ?? []).map((r: Setting) => [r.key, r.value])) as SettingsMap
    setSettings(map)
    setFoundingCount(count ?? 0)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveSetting(key: string, value: string) {
    setSaving(key)
    await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    await logAction('settings_update', { details: { key, value } })
    setSaving(null)
  }

  async function updateLocal(key: keyof SettingsMap, value: string) {
    setSettings(s => ({ ...s, [key]: value }))
  }

  if (loading) return <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>

  const Toggle = ({ settingKey }: { settingKey: 'founding_provider_offer_enabled' | 'image_review_enabled' }) => {
    const on = settings[settingKey] === 'true'
    const toggle = async () => {
      const next = String(!on)
      updateLocal(settingKey, next)
      await saveSetting(settingKey, next)
    }
    return (
      <button onClick={toggle}
        className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-[#8C4A58]' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
      </button>
    )
  }

  const PriceField = ({ label, settingKey, unit = 'pence' }: { label: string; settingKey: 'verification_price_pence' | 'subscription_price_pence' | 'materials_cost_cap_pence' | 'founding_provider_limit'; unit?: string }) => {
    const [local, setLocal] = useState(settings[settingKey] ?? '')
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
            onClick={async () => { await saveSetting(settingKey, local); updateLocal(settingKey, local) }}
            disabled={saving === settingKey}
            className="px-3 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#8C4A58' }}>
            {saving === settingKey ? '…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  const BannedWords = () => {
    const current = (() => {
      try { return JSON.parse(settings['banned_words'] ?? '[]').join('\n') } catch { return '' }
    })()
    const [text, setText] = useState(current)
    return (
      <div className="py-4 border-b border-black/5">
        <div className="font-medium text-[#3D2E2E] mb-1">Banned Words</div>
        <div className="text-xs text-[#3D2E2E]/40 mb-3">One word or phrase per line. Messages and reviews containing these are flagged for manual review.</div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder="Enter one word per line…"
          className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none font-mono"
        />
        <button
          onClick={async () => {
            const words = text.split('\n').map((w: string) => w.trim()).filter(Boolean)
            const json = JSON.stringify(words)
            setText(words.join('\n'))
            await saveSetting('banned_words', json)
            updateLocal('banned_words', json)
          }}
          className="mt-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={{ backgroundColor: '#8C4A58' }}>
          Save Banned Words
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#3D2E2E] mb-6">Settings</h1>

      <div className="bg-white rounded-xl border border-black/5 shadow-sm px-6">
        <PriceField label="Provider Verification Price" settingKey="verification_price_pence" />
        <PriceField label="Model Subscription Price"    settingKey="subscription_price_pence" />
        <PriceField label="Materials Cost Cap"          settingKey="materials_cost_cap_pence" />
        <PriceField label="Founding Provider Slot Limit" settingKey="founding_provider_limit" unit="slots" />

        <div className="flex items-center justify-between py-4 border-b border-black/5">
          <div>
            <div className="font-medium text-[#3D2E2E]">Founding Provider Offer</div>
            <div className="text-xs text-[#3D2E2E]/40">{foundingCount} / {settings['founding_provider_limit'] ?? '—'} slots used</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${settings['founding_provider_offer_enabled'] === 'true' ? 'text-[#8C4A58]' : 'text-gray-400'}`}>
              {settings['founding_provider_offer_enabled'] === 'true' ? 'ON' : 'OFF'}
            </span>
            <Toggle settingKey="founding_provider_offer_enabled" />
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
            <Toggle settingKey="image_review_enabled" />
          </div>
        </div>

        <BannedWords />
      </div>
    </div>
  )
}
