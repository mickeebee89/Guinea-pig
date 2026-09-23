'use client'

import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConsentGate } from '@/components/ConsentGate'
import { formatPrice } from '@/lib/price'
import type { AcceptedConsent } from '@/lib/queries/consent'
import type { ApplyContext, ApplyPhoto } from '@/lib/queries/apply'
import { submitApplication, uploadApplicationPhoto } from './actions'

/**
 * The seven steps, on the web. Audit item 83.
 *
 * Deliberately mobile's seven (apply-session.tsx:44-52) and not a redesign:
 * choose a date, pick a time, select a treatment, add a note, share photos,
 * agree the terms, review and send.
 *
 * ── WHAT SURVIVES A REFRESH, AND HOW ──────────────────────────────────────
 * A browser reloads. A native wizard does not, which is why mobile can hold
 * everything in memory and this cannot.
 *
 *   step, date, slot, treatment, photos → THE URL. Refresh, back and forward
 *     all work, and the address bar is the state.
 *   the photos themselves → uploaded the moment they are picked, into her
 *     photo library (model_photos), so a reload re-reads them rather than
 *     losing files. A model who has photographed her own hair three times
 *     does not do it a fourth.
 *   the note → sessionStorage, NOT the URL. It is free text about her hair,
 *     her skin or her health, and that does not belong in browser history or
 *     in a link she might paste to a friend.
 *
 * ── THE PRICE SHOWN HERE IS THE SLOT'S ────────────────────────────────────
 * It appears on the time step, again on the treatment step and again on the
 * confirmation, and it is the same number every time: the price belongs to
 * the slot, not the treatment (0050), so choosing a different treatment must
 * never look as though it changed the cost.
 */

const STEPS = [
  'Choose a date',
  'Pick a time',
  'Select a treatment',
  'Add a note',
  'Share photos',
  'Before you apply',
  'Review & send',
] as const

const NOTE_MAX = 300

const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`
}
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

export function ApplyWizard({ ctx }: { ctx: ApplyContext }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sentId, setSentId] = useState<string | null>(null)
  const [consent, setConsent] = useState<AcceptedConsent | null>(null)
  /** Which layer refused, so a report can name it. See actions.ts. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [photos, setPhotos] = useState<ApplyPhoto[]>(ctx.photos)
  const [uploading, setUploading] = useState(false)

  // ── The URL is the state ──────────────────────────────────────────────────
  const step = Math.min(7, Math.max(1, Number(params.get('step') ?? 1) || 1))
  const date = params.get('date')
  const slotId = params.get('slot')
  const treatmentId = params.get('treatment')
  const chosenPhotoIds = useMemo(
    () => (params.get('photos') ?? '').split(',').filter(Boolean),
    [params],
  )

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      router.replace(`?${next.toString()}`, { scroll: false })
    },
    [params, router],
  )

  // ── The note, kept out of the URL ─────────────────────────────────────────
  //
  // ⚠️ READ AS AN EXTERNAL STORE, NOT RESTORED IN AN EFFECT. The obvious
  // version — useState('') plus an effect that reads sessionStorage — is a
  // setState inside an effect, which this repo lints against and which causes
  // the cascading render the rule exists to stop. sessionStorage IS an
  // external system, so useSyncExternalStore is the thing meant for it: the
  // server snapshot is empty, the client's is whatever she had typed, and
  // React reconciles the two itself instead of us doing it a frame late.
  const noteKey = `cavy-apply-note:${ctx.provider.id}`
  const noteStore = useMemo(() => makeNoteStore(noteKey), [noteKey])
  const note = useSyncExternalStore(noteStore.subscribe, noteStore.get, noteStore.getServer)
  const changeNote = (v: string) => noteStore.set(v.slice(0, NOTE_MAX))

  const slot = ctx.slots.find(s => s.id === slotId) ?? null
  const slotsForDate = ctx.slots.filter(s => s.date === date)
  const dates = useMemo(
    () => [...new Set(ctx.slots.filter(s => !s.isTaken).map(s => s.date))].sort(),
    [ctx.slots],
  )
  // Only the treatments this SLOT offers — the array on the slot is the
  // stylist's own per-slot choice, and ignoring it would offer a treatment
  // they did not put in that hour.
  const treatmentsForSlot = slot
    ? ctx.treatments.filter(t => slot.treatmentIds.includes(t.id))
    : []
  const treatment = treatmentsForSlot.find(t => t.id === treatmentId) ?? null

  const price = formatPrice(slot?.pricePence)
  const priceLine = price ?? 'Price not set — agree it in the chat'

  const go = (n: number) => setParams({ step: String(n) })

  const addPhoto = async (file: File) => {
    setError(null)
    setUploading(true)
    const fd = new FormData()
    fd.append('photo', file)
    const res = await uploadApplicationPhoto(fd)
    setUploading(false)
    if (!res.ok) { setError(res.error); return }
    setPhotos(prev => [{ id: res.id, path: res.path, url: res.url }, ...prev])
    setParams({ photos: [res.id, ...chosenPhotoIds].join(',') })
  }

  const togglePhoto = (id: string) => {
    const next = chosenPhotoIds.includes(id)
      ? chosenPhotoIds.filter(p => p !== id)
      : [...chosenPhotoIds, id]
    setParams({ photos: next.length > 0 ? next.join(',') : null })
  }

  const send = () => {
    if (!slot || !treatment || !consent) return
    setError(null)
    start(async () => {
      const fd = new FormData()
      fd.append('provider_id', ctx.provider.id)
      fd.append('availability_id', slot.id)
      fd.append('treatment_id', treatment.id)
      fd.append('date', slot.date)
      fd.append('start_time', slot.startTime)
      fd.append('end_time', slot.endTime)
      fd.append('note', note)
      fd.append(
        'photo_paths',
        photos.filter(p => chosenPhotoIds.includes(p.id)).map(p => p.path).join(','),
      )
      fd.append('consent_document_id', consent.consent_document_id)
      fd.append('consent_hash', consent.content_hash)
      fd.append('consent_payload', JSON.stringify(consent))

      const res = await submitApplication(fd)
      if (!res.ok) {
        setError(res.error)
        setRefusal(res.code)
        // ⚠️ HER TICKS ARE ONLY THROWN AWAY FOR A CONSENT REASON.
        //
        // This used to clear them on EVERY refusal that asked for fresh data —
        // including a slot race, which has nothing to do with consent. The
        // result was that a booking lost to someone else came back as "please
        // read and tick the terms first", and that is exactly how a submit
        // failure got reported on 23 Sep as a consent failure. Six ticks are
        // not ours to discard because a stylist's diary moved.
        if (res.code === 'consent_moved' || res.code === 'consent_missing' || res.code === 'consent_unreadable') {
          setConsent(null)
        }
        if (res.refresh) router.refresh()
        return
      }
      noteStore.clear()
      setSentId(res.sessionId)
    })
  }

  if (sentId) {
    return (
      <section className="rounded-lg border border-hairline bg-white p-5">
        <h2 className="font-display text-xl text-warm-dark">Application sent</h2>
        <p className="mt-2 text-sm text-muted">
          {ctx.provider.name} has been told. They choose who to take, so this isn’t confirmed yet —
          you’ll get a notification either way, and a message thread opens if they accept.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/bookings"
            className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
          >
            See my bookings
          </Link>
          <Link
            href={`/stylist/${ctx.provider.id}`}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-6 text-sm font-bold text-rose"
          >
            Back to {ctx.provider.name}
          </Link>
        </div>
      </section>
    )
  }

  return (
    <div>
      {/* Progress, and a way back. Step 7 of 7 with no way to change the time
          is how a model sends the wrong hour rather than starting again. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">
          Step {step} of 7
        </p>
        {step > 1 && (
          <button onClick={() => go(step - 1)} className="text-sm font-bold text-rose hover:underline">
            ← Back
          </button>
        )}
      </div>
      <div className="mb-5 h-1 w-full rounded-full bg-input-bg" aria-hidden="true">
        <div className="h-1 rounded-full bg-rose transition-all" style={{ width: `${(step / 7) * 100}%` }} />
      </div>

      <h2 className="mb-4 font-display text-xl text-warm-dark">{STEPS[step - 1]}</h2>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{error}</p>
          {/* The code, said out loud. Three refusals read almost identically
              to a person — "the terms weren't ticked" could be this action,
              the database, or the note below — and without this, a report of
              one cannot be told from a report of another. */}
          {refusal && (
            <p className="mt-1 text-xs text-red-800/70">
              If this keeps happening, tell us this: {refusal}
            </p>
          )}
        </div>
      )}

      {/* 1 ── date */}
      {step === 1 && (
        <ul className="space-y-2">
          {dates.map(d => (
            <li key={d}>
              <button
                onClick={() => setParams({ date: d, slot: null, treatment: null, step: '2' })}
                className={`flex min-h-11 w-full items-center justify-between rounded-md border px-4 text-sm ${
                  date === d ? 'border-rose bg-soft-pink font-bold text-rose' : 'border-hairline text-warm-dark'
                }`}
              >
                <span>{fmtDate(d)}</span>
                <span className="text-xs text-muted">
                  {ctx.slots.filter(s => s.date === d && !s.isTaken).length} free
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 2 ── time, with the price */}
      {step === 2 && (
        <ul className="space-y-2">
          {slotsForDate.map(s => {
            const p = formatPrice(s.pricePence)
            return (
              <li key={s.id}>
                <button
                  disabled={s.isTaken}
                  onClick={() => setParams({ slot: s.id, treatment: null, step: '3' })}
                  className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm disabled:opacity-50 ${
                    slotId === s.id ? 'border-rose bg-soft-pink font-bold text-rose' : 'border-hairline text-warm-dark'
                  }`}
                >
                  <span>{fmtTime(s.startTime)} – {fmtTime(s.endTime)}</span>
                  {s.isTaken ? (
                    <span className="text-xs text-muted">Booked</span>
                  ) : (
                    <span className={p ? 'text-sm font-bold text-rose-dark' : 'text-xs text-muted'}>
                      {p ?? 'Price not set'}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* 3 ── treatment. Same price, restated, because it did not change. */}
      {step === 3 && slot && (
        <>
          <p className="mb-3 text-sm text-muted">
            {fmtDate(slot.date)}, {fmtTime(slot.startTime)} · <span className="font-bold text-warm-dark">{priceLine}</span>
          </p>
          {treatmentsForSlot.length === 0 ? (
            <p className="text-sm text-muted">
              This slot has no treatments on it. Pick another time, or ask {ctx.provider.name} in a
              message.
            </p>
          ) : (
            <ul className="space-y-2">
              {treatmentsForSlot.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => setParams({ treatment: t.id, step: '4' })}
                    className={`min-h-11 w-full rounded-md border px-4 text-left text-sm ${
                      treatmentId === t.id ? 'border-rose bg-soft-pink font-bold text-rose' : 'border-hairline text-warm-dark'
                    }`}
                  >
                    {t.name?.trim() || t.category}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* 4 ── note */}
      {step === 4 && (
        <>
          <label htmlFor="apply-note" className="text-sm text-muted">
            Anything {ctx.provider.name} should know? Optional.
          </label>
          <textarea
            id="apply-note"
            value={note}
            onChange={e => changeNote(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded-md border border-hairline p-3 text-sm"
            placeholder="Hair past my shoulders, never been coloured…"
          />
          <p className="mt-1 text-xs text-muted">{note.length}/{NOTE_MAX}</p>
          <button
            onClick={() => go(5)}
            className="mt-4 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
          >
            {note.trim() ? 'Next' : 'Skip'}
          </button>
        </>
      )}

      {/* 5 ── photos */}
      {step === 5 && (
        <>
          <p className="text-sm text-muted">
            Photos help {ctx.provider.name} prepare. Optional, and only they see them.
          </p>
          <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-[999px] bg-input-bg px-5 text-sm font-bold text-rose">
            {uploading ? 'Uploading…' : 'Add a photo'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void addPhoto(f)
                e.target.value = ''
              }}
            />
          </label>

          {photos.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map(p => {
                const on = chosenPhotoIds.includes(p.id)
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => togglePhoto(p.id)}
                      aria-pressed={on}
                      className={`block w-full overflow-hidden rounded-md border-2 ${on ? 'border-rose' : 'border-transparent'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="aspect-square w-full object-cover" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <button
            onClick={() => go(6)}
            className="mt-5 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
          >
            {chosenPhotoIds.length > 0 ? `Next with ${chosenPhotoIds.length} photo${chosenPhotoIds.length === 1 ? '' : 's'}` : 'Skip'}
          </button>
        </>
      )}

      {/* 6 ── consent. The document, whole, from the database. */}
      {step === 6 && ctx.consent && (
        <ConsentGate
          doc={ctx.consent}
          submitLabel="Agree and continue"
          onAccept={accepted => { setConsent(accepted); go(7) }}
        />
      )}

      {/* 7 ── review and send */}
      {step === 7 && slot && treatment && (
        <section className="rounded-lg border border-hairline bg-white p-5">
          <dl className="space-y-2 text-sm">
            <Row label="Stylist" value={ctx.provider.name} />
            <Row label="Date" value={fmtDate(slot.date)} />
            <Row label="Time" value={`${fmtTime(slot.startTime)} – ${fmtTime(slot.endTime)}`} />
            <Row label="Treatment" value={treatment.name?.trim() || treatment.category || '—'} />
            {/* The same figure as step 2, from the same slot. */}
            <Row label="Cost" value={priceLine} />
            <Row label="Note" value={note.trim() || 'None'} />
            <Row
              label="Photos"
              value={chosenPhotoIds.length > 0 ? `${chosenPhotoIds.length} shared` : 'None'}
            />
          </dl>

          {!consent && (
            <p className="mt-4 rounded-md bg-input-bg px-3 py-2 text-sm text-muted">
              {/* Worded so it cannot be mistaken for the server's refusal of a
                  submit. This one means "you have not been through step 6 on
                  this page yet", nothing more. */}
              You haven’t agreed the terms on this device yet.{' '}
              <button onClick={() => go(6)} className="font-bold text-rose hover:underline">
                Go back
              </button>
            </p>
          )}

          <button
            onClick={send}
            disabled={pending || !consent}
            className="mt-5 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
          >
            {pending ? 'Sending…' : 'Send my application'}
          </button>

          <p className="mt-3 text-xs text-muted">
            {ctx.provider.name} decides who to take, so this isn’t confirmed yet. Any cost is
            agreed with them in the chat and paid in person — Cavy doesn’t handle payments for
            treatments.
          </p>
        </section>
      )}

      {/* A step whose earlier choice has gone — a refreshed URL pointing at a
          slot that is now booked, say. Say so rather than rendering nothing. */}
      {((step === 3 && !slot) || (step === 7 && (!slot || !treatment))) && (
        <p className="text-sm text-muted">
          That time isn’t available any more.{' '}
          <button onClick={() => setParams({ step: '1', slot: null, treatment: null })} className="font-bold text-rose hover:underline">
            Start from the date
          </button>
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-hairline pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold text-warm-dark">{value}</dd>
    </div>
  )
}

/**
 * The note, in sessionStorage, read the way React wants an external store read.
 *
 * Deliberately sessionStorage and not localStorage: a half-written note about
 * your own hair or skin should not outlive the tab it was typed in. And
 * deliberately not the URL — see the component header.
 *
 * Every access is wrapped: in a private window, or with site data blocked,
 * these throw rather than return null, and an unwritable note must degrade to
 * an empty one rather than take the page down.
 */
function makeNoteStore(key: string) {
  let listeners: (() => void)[] = []
  let cached: string | null = null
  const emit = () => { for (const l of listeners) l() }
  return {
    subscribe(l: () => void) {
      listeners.push(l)
      return () => { listeners = listeners.filter(x => x !== l) }
    },
    // Cached, because getSnapshot must return the SAME value until something
    // changes — reading storage on every render would hand React a new string
    // each time and loop.
    get() {
      if (cached === null) {
        try { cached = sessionStorage.getItem(key) ?? '' } catch { cached = '' }
      }
      return cached
    },
    getServer() { return '' },
    set(v: string) {
      cached = v
      try { sessionStorage.setItem(key, v) } catch { /* nothing to persist to */ }
      emit()
    },
    clear() {
      cached = ''
      try { sessionStorage.removeItem(key) } catch { /* nothing to clean up */ }
      emit()
    },
  }
}
