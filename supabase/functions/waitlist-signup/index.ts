// Supabase Edge Function — waitlist-signup
// Public, ANONYMOUS endpoint the pre-launch landing page POSTs one signup to.
// There is no auth gate on purpose — instead the table is fully locked by RLS
// (no anon/authenticated write policy) and the ONLY writer is this function's
// service-role client. The landing page needs nothing but this URL.
// Deploy: supabase functions deploy waitlist-signup --no-verify-jwt
//   (--no-verify-jwt is REQUIRED so anonymous callers aren't rejected by the platform)

import { createClient } from 'npm:@supabase/supabase-js@2'

// ── Client ──────────────────────────────────────────────────────────────────
// Service-role — bypasses RLS to insert into the otherwise write-locked table.
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── CORS ────────────────────────────────────────────────────────────────────
// Open origin for now (matches the other functions). Optional hardening: swap '*'
// for the landing-page domain once it's known.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Validation helpers ──────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Trim, coerce empty → null, cap length. Used for the optional fields.
function optional(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length === 0 ? null : s.slice(0, max)
}

// ── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return respond({ error: 'Invalid JSON' }, 400)
  }

  // Honeypot: real users never see/fill `company`. A filled value = a bot —
  // absorb it silently (pretend success, insert nothing).
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return respond({ ok: true })
  }

  // first_name — required, ≤ 80
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  if (!firstName) return respond({ error: 'First name required' }, 400)
  if (firstName.length > 80) return respond({ error: 'First name too long' }, 400)

  // email — required, valid, normalized to lowercase, ≤ 200
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email) || email.length > 200) {
    return respond({ error: 'Valid email required' }, 400)
  }

  // role — required, exactly one of the two
  const role = body.role
  if (role !== 'stylist' && role !== 'model') {
    return respond({ error: 'Role must be stylist or model' }, 400)
  }

  // consent — must be strictly true (never store a non-consenting contact)
  if (body.consent !== true) return respond({ error: 'Consent required' }, 400)

  // optional
  const city = optional(body.city, 120)
  const socialHandle = optional(body.social_handle, 120)

  const { error } = await db.from('waitlist').insert({
    first_name:    firstName,
    email,
    role,
    city,
    social_handle: socialHandle,
    consent:       true,
  })

  if (error) {
    // 23505 = unique_violation on lower(email): they're already signed up. Treat as
    // an idempotent success so the form UX stays clean and existence isn't leaked.
    if ((error as { code?: string }).code === '23505') {
      return respond({ ok: true, duplicate: true })
    }
    console.error('[waitlist-signup] insert failed', error)
    return respond({ error: 'Could not sign up' }, 500)
  }

  return respond({ ok: true })
})
