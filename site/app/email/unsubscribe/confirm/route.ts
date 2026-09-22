import { NextResponse, type NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase-public'

/**
 * Turns notification emails off for the holder of an unsubscribe token.
 * Audit item 74.
 *
 * Two callers, both POST:
 *   * the button on /email/unsubscribe (token in the form body);
 *   * Gmail and Yahoo's one-click unsubscribe, which POSTs to the address in
 *     the List-Unsubscribe header (token in the query).
 *
 * GET only redirects to the page. A mail client or scanner fetching the link
 * must never unsubscribe anyone by accident.
 *
 * ── HOW IT IS ALLOWED TO WRITE WITHOUT A SESSION ───────────────────────────
 * Through public.unsubscribe_email(token), a SECURITY DEFINER function (0047)
 * that looks the token up and can only set the preference to OFF. This route
 * holds no privileged key: it uses the same anonymous client as the public
 * pages. Turning emails back on needs a sign-in.
 */

export const dynamic = 'force-dynamic'

const page = (req: NextRequest, q: string) =>
  NextResponse.redirect(new URL(`/email/unsubscribe${q}`, req.url), { status: 303 })

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? ''
  return page(req, t ? `?t=${encodeURIComponent(t)}` : '')
}

export async function POST(req: NextRequest) {
  let token = req.nextUrl.searchParams.get('t') ?? ''
  if (!token) {
    // The form post. A one-click unsubscribe sends its own body, which has no
    // token in it — hence the query above.
    try {
      const form = await req.formData()
      token = String(form.get('t') ?? '')
    } catch { /* one-click bodies are not always form data */ }
  }

  const { data, error } = await supabase.rpc('unsubscribe_email', { p_token: token })
  if (error) console.error('[unsubscribe] rpc failed', { code: error.code, message: error.message })
  const ok = data === true

  // One-click never follows a redirect and shows nobody a page: answer plainly.
  if (req.nextUrl.searchParams.get('t') && !req.headers.get('accept')?.includes('text/html')) {
    return new NextResponse(ok ? 'Unsubscribed' : 'That link did not work', { status: ok ? 200 : 400 })
  }
  return page(req, ok ? '?done=1' : '?failed=1')
}
