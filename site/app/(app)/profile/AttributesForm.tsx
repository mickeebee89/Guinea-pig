'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveAttribute, saveBio, saveInstagram } from './actions'
import { ATTRIBUTE_DEFS, BIO_MAX } from '@/lib/queries/my-profile'
import { isValidInstagramHandle } from '@/lib/instagram'
import { attempt } from '@/lib/attempt'

/**
 * The bio, the Instagram handle and the nine attributes. Audit item 99.
 *
 * ── SAVES ONE FIELD AT A TIME, LIKE MOBILE ────────────────────────────────
 * Not one big form with a Save button. Mobile writes each attribute as it is
 * picked, and matching that matters for a reason beyond consistency: a member
 * who fills three fields and closes the tab should have three fields saved.
 * A single Save is how a profile ends up empty because the last step was never
 * reached — and an empty profile is the exact problem this page exists to fix.
 *
 * The bio and the handle are the exceptions and have their own buttons,
 * because a text box that saved on every keystroke would write 200 rows for
 * one sentence.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠️ FEEDBACK BELONGS NEXT TO THE CONTROL THAT CAUSED IT. Item 106.
 * ══════════════════════════════════════════════════════════════════════════
 * The first version of this had ONE shared `error`, rendered at the very
 * bottom of the form — below the nine attributes, under a different heading.
 * So a refused Instagram handle put its message several hundred pixels away
 * from the Instagram box, usually off-screen, and the field looked like it did
 * nothing at all. Reported as "it shows nothing on success either", which is
 * the right description of what it was like to use even though a success
 * message existed: if the first thing you try is refused, you never see either
 * half.
 *
 * It also shared one `pending`, so saving the bio put the word "Saving…" on
 * the Instagram button at the same time.
 *
 * Now: one `feedback` at a time, tagged with the field that produced it and
 * rendered beside that field, and `busy` tracks WHICH field is saving. The
 * rule is that a control must never report on work it did not do.
 */

type Field = 'bio' | 'instagram' | `attr:${string}`
type Feedback = { field: Field; text: string; bad: boolean }

export function AttributesForm({
  initial, initialBio, initialInstagram,
}: {
  initial: Record<string, string>
  initialBio: string | null
  initialInstagram: string | null
}) {
  const router = useRouter()
  const [values, setValues] = useState(initial)
  const [bio, setBio] = useState(initialBio ?? '')
  const [insta, setInsta] = useState(initialInstagram ?? '')
  const [, start] = useTransition()
  const [busy, setBusy] = useState<Field | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  /** The message for one field, or nothing. Never another field's. */
  const say = (field: Field) => (feedback?.field === field ? feedback : null)

  const run = (field: Field, work: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setFeedback(null)
    setBusy(field)
    start(async () => {
      try {
        // attempt(), not a bare await: a server action can THROW as well as
        // return { ok: false }, and an unhandled rejection here rendered
        // nothing at all — the control just appeared dead (item 107).
        const res = await attempt(work, `profile:${field}`)
        setFeedback({
          field,
          text: res.ok ? done : (res.error ?? 'That didn’t save.'),
          bad: !res.ok,
        })
        if (res.ok) router.refresh()
      } finally {
        setBusy(null)
      }
    })
  }

  const pick = (key: string, value: string) => {
    const previous = values[key] ?? ''
    setValues(v => ({ ...v, [key]: value }))   // optimistic
    const field: Field = `attr:${key}`
    setFeedback(null)
    setBusy(field)
    start(async () => {
      try {
        const res = await attempt(() => saveAttribute(key, value), `profile:${field}`)
        if (!res.ok) {
          setValues(v => ({ ...v, [key]: previous }))   // and back
          setFeedback({ field, text: res.error ?? 'That didn’t save.', bad: true })
          return
        }
        setFeedback({ field, text: 'Saved.', bad: false })
        router.refresh()
      } finally {
        setBusy(null)
      }
    })
  }

  // ⚠️ SHOWN EVEN WHEN IT FAILS THE RULE, which is the opposite of what
  // /model/[id] does — deliberately. The profile REFUSES to render a bad
  // value; this screen has to show it, because a value she cannot see is one
  // she cannot clear. An email address sat in this column for four months
  // (item 102) and a web-only model had no way to remove it.
  const storedIsBad = !!initialInstagram && !isValidInstagramHandle(initialInstagram)

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
            onClick={() => run('bio', () => saveBio(bio), 'Saved.')}
            disabled={!!busy || bio === (initialBio ?? '')}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
          >
            {busy === 'bio' ? 'Saving…' : 'Save bio'}
          </button>
          {/* Only shown near the limit. A permanent "0/200" under an empty box
              reads as a target to hit — the same rule as the shop form. */}
          {bio.length > BIO_MAX - 40 && (
            <span className="text-xs text-muted">{bio.length}/{BIO_MAX}</span>
          )}
          <FieldNote note={say('bio')} />
        </div>

        <label htmlFor="instagram" className="mt-5 block text-sm font-bold text-warm-dark">
          Instagram
        </label>
        <p className="mt-0.5 text-xs text-muted">
          Optional. Just your username, or paste the link to your profile. Anyone who opens your
          profile can see it, so don’t put an email address or a phone number here.
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-sm text-muted">@</span>
          <input
            id="instagram"
            value={insta}
            onChange={e => setInsta(e.target.value)}
            placeholder="your_username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={120}
            className="min-h-11 w-56 rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark placeholder:text-muted"
          />
          <button
            onClick={() => run('instagram', () => saveInstagram(insta), 'Saved.')}
            disabled={!!busy || insta === (initialInstagram ?? '')}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-rose disabled:text-muted"
          >
            {busy === 'instagram' ? 'Saving…' : 'Save'}
          </button>
          {initialInstagram && (
            /* Clearing has its own control rather than "save an empty box",
               which nobody finds. It is how the bad value already in the
               column gets removed. */
            <button
              onClick={() => { setInsta(''); run('instagram', () => saveInstagram(''), 'Removed.') }}
              disabled={!!busy}
              className="min-h-11 px-2 text-sm font-bold text-muted hover:text-warm-dark hover:underline"
            >
              Remove
            </button>
          )}
        </div>
        {/* Under the row rather than inside it: the refusal explains a rule and
            is three lines long, and a three-line message wrapping inside a row
            of controls pushes the buttons around as it appears. */}
        <FieldNote note={say('instagram')} block />

        {storedIsBad && !say('instagram') && (
          <p role="alert" className="mt-2 max-w-md text-sm text-danger">
            What’s saved here isn’t a username, so it isn’t being shown on your profile.
            Replace it with your Instagram username, or remove it.
          </p>
        )}
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
                disabled={busy === `attr:${def.key}`}
                className="mt-1 min-h-11 w-full rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark"
              >
                {/* "Not set" is a real choice, not a prompt: it is how she
                    clears one, and mobile has the same Clear action. */}
                <option value="">Not set</option>
                {def.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <FieldNote note={say(`attr:${def.key}`)} block small />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * One field's answer, in its place.
 *
 * `role="alert"` only when it is bad — announcing every "Saved." interrupts a
 * screen reader nine times while she works down the list, which is worse than
 * silence. A failure is worth interrupting for.
 */
function FieldNote({
  note, block = false, small = false,
}: {
  note: { text: string; bad: boolean } | null
  block?: boolean
  small?: boolean
}) {
  if (!note) return null
  const tone = note.bad ? 'text-danger' : 'text-muted'
  const size = small ? 'text-xs' : 'text-sm'
  if (!block) {
    return (
      <span {...(note.bad ? { role: 'alert' as const } : {})} className={`${size} ${tone}`}>
        {note.text}
      </span>
    )
  }
  return (
    <p {...(note.bad ? { role: 'alert' as const } : {})} className={`mt-1 max-w-md ${size} ${tone}`}>
      {note.text}
    </p>
  )
}
