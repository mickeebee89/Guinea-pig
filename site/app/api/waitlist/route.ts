import { NextResponse } from 'next/server'

/**
 * Server-side proxy to the waitlist-signup edge function.
 *
 * WHY A PROXY RATHER THAN CALLING THE FUNCTION FROM THE BROWSER
 * The edge function's CORS allowlist contains only the two guineapigapp.co.uk
 * origins, and it does NOT reject others — it simply omits the
 * Access-Control-Allow-Origin header. Called from cavybeauty.com in a browser,
 * that means the row IS still inserted server-side while the visitor sees a
 * network error and retries. Proxying server-to-server sends no Origin header
 * at all, so CORS never applies and the edge function needs no redeploy.
 *
 * Validation is duplicated here deliberately: the function is the authority,
 * but validating at the edge of our own system gives the visitor a useful
 * message instead of a generic failure.
 */

const ENDPOINT = 'https://ptluekkhiopowuyvkgnd.supabase.co/functions/v1/waitlist-signup'

const MAX = { first_name: 80, email: 200, city: 120, social_handle: 120 } as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Optional field: blank becomes null, over-length is rejected. */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.length > max) return null
  return t
}

/**
 * Required field. Distinguishes missing from too-long so the message can say
 * which one actually happened — "please tell us your first name" is wrong and
 * confusing when the name was given but ran over the limit.
 */
function required(v: unknown, max: number): { value: string } | { error: 'missing' | 'too_long' } {
  if (typeof v !== 'string' || v.trim() === '') return { error: 'missing' }
  const t = v.trim()
  if (t.length > max) return { error: 'too_long' }
  return { value: t }
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // Honeypot. A real person never fills this — bots fill every field they find.
  // Mirror the edge function: pretend it worked, store nothing.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const name = required(payload.first_name, MAX.first_name)
  if ('error' in name) {
    return NextResponse.json(
      {
        ok: false,
        error:
          name.error === 'missing'
            ? 'Please tell us your first name.'
            : `Please use ${MAX.first_name} characters or fewer for your first name.`,
      },
      { status: 400 },
    )
  }
  const first_name = name.value

  const mail = required(payload.email, MAX.email)
  if ('error' in mail) {
    return NextResponse.json(
      {
        ok: false,
        error:
          mail.error === 'missing'
            ? 'Please enter your email address.'
            : `Please use ${MAX.email} characters or fewer for your email address.`,
      },
      { status: 400 },
    )
  }
  if (!EMAIL_RE.test(mail.value)) {
    return NextResponse.json(
      { ok: false, error: 'That email address doesn’t look right.' },
      { status: 400 },
    )
  }
  const emailRaw = mail.value

  const role = payload.role
  if (role !== 'stylist' && role !== 'model') {
    return NextResponse.json({ ok: false, error: 'Please choose stylist or model.' }, { status: 400 })
  }

  if (payload.consent !== true) {
    return NextResponse.json(
      { ok: false, error: 'We need your permission to email you.' },
      { status: 400 },
    )
  }

  const body = {
    first_name,
    email: emailRaw.toLowerCase(),
    role,
    consent: true,
    city: clean(payload.city, MAX.city),
    social_handle: clean(payload.social_handle, MAX.social_handle),
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await res.text()
    let data: { ok?: boolean; duplicate?: boolean; error?: string } = {}
    try {
      data = JSON.parse(text)
    } catch {
      /* fall through to the status check */
    }

    if (!res.ok || data.ok !== true) {
      // Never surface the upstream body — it may carry internal detail.
      console.error('waitlist-signup failed', res.status, text.slice(0, 300))
      return NextResponse.json(
        { ok: false, error: 'Something went wrong at our end. Please try again in a moment.' },
        { status: 502 },
      )
    }

    // duplicate: true is a success — the edge function is idempotent on email so
    // the form never reveals whether an address is already on the list.
    return NextResponse.json({ ok: true, duplicate: data.duplicate === true })
  } catch (err) {
    console.error('waitlist-signup unreachable', err)
    return NextResponse.json(
      { ok: false, error: 'We couldn’t reach the waitlist just now. Please try again in a moment.' },
      { status: 502 },
    )
  }
}
