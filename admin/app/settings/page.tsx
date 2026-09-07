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

  /**
   * ── THE WRITE NOW REPORTS WHAT THE DATABASE SAID ───────────────────────
   *
   * This used to be `await supabase.from('settings').upsert(...)` with the
   * result thrown away. supabase-js does NOT reject when the database refuses a
   * write — it resolves with `{ error }` — so a rejected upsert was
   * indistinguishable from a successful one, and the page then showed the new
   * value regardless. The same defect `mobile/lib/db.ts` exists to prevent,
   * on the setting that gates publication.
   *
   * `updateLocal` is now called ONLY on success, so a toggle cannot show a
   * state the database refused.
   */
  const handleSave = useCallback(async (
    key: keyof SettingsMap, value: string,
  ): Promise<SaveResult> => {
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value, updated_at: new Date().toISOString() })
    if (error) {
      console.error('[settings] save failed', key, error)
      return { ok: false, error: error.message }
    }
    await logAction('settings_update', { details: { key, value } })
    setSettings(s => ({ ...s, [key]: value }))
    return { ok: true }
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
          initial={settings['verification_price_pence'] ?? ''} onSave={handleSave} />
        <PriceField
          label="Model Subscription Price" settingKey="subscription_price_pence"
          initial={settings['subscription_price_pence'] ?? ''} onSave={handleSave} />
        <PriceField
          label="Founding Provider Slot Limit" settingKey="founding_provider_limit" unit="slots"
          initial={settings['founding_provider_limit'] ?? ''} onSave={handleSave} />

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

type SaveResult = { ok: true } | { ok: false; error: string }
type OnSave = (key: keyof SettingsMap, value: string) => Promise<SaveResult>

/**
 * Every control's save state, in one place.
 *
 * ── A SAVE THAT SAYS NOTHING IS THE OTHER HALF OF ITEM 26 ──────────────
 * Item 26 was silent loss: work disappeared and nothing said so. This is silent
 * success: the write lands and nothing says so either, so the only way to know
 * is to reload the page and look. Both leave the admin guessing, and Banned
 * Words — which had no feedback at all, not even a disabled button — is the
 * setting that gates publication.
 *
 * `saved` persists until the field is edited again rather than fading on a
 * timer: a timer would be a second thing that can be wrong, and "Saved" next to
 * text you have since changed is worse than no message.
 */
function useSave(onSave: OnSave) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)

  return {
    state,
    error,
    /** Call from onChange — a stale "Saved" beside edited text is a lie. */
    touch: () => { setState('idle'); setError(null) },
    save: async (key: keyof SettingsMap, value: string) => {
      setState('saving'); setError(null)
      const res = await onSave(key, value)
      if (res.ok) setState('saved')
      else { setState('failed'); setError(res.error) }
    },
  }
}

/** The one-line answer under a control. Says which of the four states it is in. */
function SaveNote({ state, error }: { state: string; error: string | null }) {
  if (state === 'saving') return <span className="text-xs text-[#3D2E2E]/40">Saving…</span>
  if (state === 'saved')  return <span className="text-xs font-medium text-green-700">Saved</span>
  if (state === 'failed') return (
    <span className="text-xs font-medium text-red-700">
      Not saved{error ? ` — ${error}` : ''}. Nothing has changed.
    </span>
  )
  return null
}

function Toggle({
  settingKey, on, onSave,
}: {
  settingKey: 'founding_provider_offer_enabled' | 'image_review_enabled'
  on: boolean
  onSave: OnSave
}) {
  const { state, error, save } = useSave(onSave)
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => save(settingKey, String(!on))}
        disabled={state === 'saving'}
        className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[#8C4A58]' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : ''}`} />
      </button>
      {/* `on` comes from the parent and the parent only updates on success, so
          a refused write leaves the switch where it was AND says why. */}
      {state !== 'saved' && <SaveNote state={state} error={error} />}
    </div>
  )
}

function PriceField({
  label, settingKey, unit = 'pence', initial, onSave,
}: {
  label: string
  settingKey: 'verification_price_pence' | 'subscription_price_pence' | 'founding_provider_limit'
  unit?: string
  initial: string
  onSave: OnSave
}) {
  const [local, setLocal] = useState(initial)
  const { state, error, touch, save } = useSave(onSave)

  return (
    <div className="flex items-center justify-between py-4 border-b border-black/5 last:border-0">
      <div>
        <div className="font-medium text-[#3D2E2E]">{label}</div>
        <div className="text-xs text-[#3D2E2E]/40">
          {unit === 'pence' && local ? `£${(parseInt(local) / 100).toFixed(2)}` : `${local} slots`}
        </div>
        <SaveNote state={state} error={error} />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={local}
          onChange={e => { setLocal(e.target.value); touch() }}
          className="border border-black/10 rounded-lg px-3 py-2 text-sm w-28 text-right"
        />
        <span className="text-xs text-[#3D2E2E]/40">{unit}</span>
        <button
          onClick={() => save(settingKey, local)}
          disabled={state === 'saving'}
          className="px-3 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#8C4A58' }}>
          {state === 'saving' ? '…' : 'Save'}
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
  onSave: OnSave
}) {
  const [text, setText] = useState(() => {
    try { return (JSON.parse(initial || '[]') as string[]).join('\n') } catch { return '' }
  })
  const { state, error, touch, save } = useSave(onSave)
  const words = text.split('\n').map(w => w.trim()).filter(Boolean)

  return (
    <div className="py-4 border-b border-black/5">
      <div className="font-medium text-[#3D2E2E] mb-1">Banned Words</div>
      <div className="text-xs text-[#3D2E2E]/40 mb-3">
        One word or phrase per line. Messages and reviews containing these are flagged for manual
        review, and since migration 0032 a status post containing one is HELD rather than published.
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); touch() }}
        rows={8}
        placeholder="Enter one word per line…"
        className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full resize-none font-mono"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={async () => {
            setText(words.join('\n'))
            await save('banned_words', JSON.stringify(words))
          }}
          disabled={state === 'saving'}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#8C4A58' }}>
          {state === 'saving' ? 'Saving…' : 'Save Banned Words'}
        </button>
        {/* The count is the confirmation that carries information: "Saved" alone
            does not tell you the list was read the way you meant it. */}
        {state === 'saved'
          ? <span className="text-xs font-medium text-green-700">
              Saved — {words.length} {words.length === 1 ? 'word' : 'words'} now screened
            </span>
          : <SaveNote state={state} error={error} />}
      </div>
    </div>
  )
}
