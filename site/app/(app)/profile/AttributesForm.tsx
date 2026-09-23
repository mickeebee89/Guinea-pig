'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveAttribute, saveBio } from './actions'
import { ATTRIBUTE_DEFS, BIO_MAX } from '@/lib/queries/my-profile'

/**
 * The nine attributes and the bio. Audit item 99.
 *
 * ── SAVES ONE FIELD AT A TIME, LIKE MOBILE ────────────────────────────────
 * Not one big form with a Save button. Mobile writes each attribute as it is
 * picked, and matching that matters for a reason beyond consistency: a member
 * who fills three fields and closes the tab should have three fields saved.
 * A single Save is how a profile ends up empty because the last step was never
 * reached — and an empty profile is the exact problem this page exists to fix.
 *
 * The bio is the exception: it has its own button, because a text box that
 * saved on every keystroke would write 200 rows for one sentence.
 */
export function AttributesForm({
  initial, initialBio,
}: {
  initial: Record<string, string>
  initialBio: string | null
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [bio, setBio] = useState(initialBio ?? '')
  const [pending, start] = useTransition()
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bioMsg, setBioMsg] = useState<string | null>(null)

  const pick = (key: string, value: string) => {
    const previous = values[key] ?? ''
    setValues(v => ({ ...v, [key]: value }))   // optimistic
    setError(null)
    setSavedKey(null)
    start(async () => {
      const res = await saveAttribute(key, value)
      if (!res.ok) {
        setValues(v => ({ ...v, [key]: previous }))   // and back
        setError(res.error)
        return
      }
      setSavedKey(key)
      router.refresh()
    })
  }

  const submitBio = () => {
    setBioMsg(null); setError(null)
    start(async () => {
      const res = await saveBio(bio)
      if (!res.ok) { setError(res.error); return }
      setBioMsg('Saved.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-warm-dark">About you</h2>
        <p className="mt-1 text-sm text-muted">
          A stylist reads this when deciding who to take. Nothing here is required.
        </p>
        <label htmlFor="bio" className="mt-4 block text-sm font-bold text-warm-dark">
          Your bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={e => setBio(e.target.value.slice(0, BIO_MAX))}
          rows={3}
          maxLength={BIO_MAX}
          placeholder="Tell stylists a bit about yourself…"
          className="mt-1 w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-warm-dark placeholder:text-muted"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={submitBio}
            disabled={pending || bio === (initialBio ?? '')}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
          >
            {pending ? 'Saving…' : 'Save bio'}
          </button>
          {/* Only shown near the limit. A permanent "0/200" under an empty box
              reads as a target to hit — the same rule as the shop form. */}
          {bio.length > BIO_MAX - 40 && (
            <span className="text-xs text-muted">{bio.length}/{BIO_MAX}</span>
          )}
          {bioMsg && <span className="text-sm text-muted">{bioMsg}</span>}
        </div>
      </div>

      <div>
        <h2 className="font-display text-xl text-warm-dark">Your look</h2>
        <p className="mt-1 text-sm text-muted">
          This is what stylists search on to find models for a particular treatment. Each one
          saves as you pick it, and you can leave any of them blank.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ATTRIBUTE_DEFS.map(def => (
            <div key={def.key}>
              <label htmlFor={`attr-${def.key}`} className="block text-sm font-bold text-warm-dark">
                {def.label}
              </label>
              <select
                id={`attr-${def.key}`}
                value={values[def.key] ?? ''}
                onChange={e => pick(def.key, e.target.value)}
                disabled={pending}
                className="mt-1 min-h-11 w-full rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark"
              >
                {/* "Not set" is a real choice, not a prompt: it is how she
                    clears one, and mobile has the same Clear action. */}
                <option value="">Not set</option>
                {def.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              {savedKey === def.key && !error && (
                <p className="mt-1 text-xs text-muted">Saved.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
