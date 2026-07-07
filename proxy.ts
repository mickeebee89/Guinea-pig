import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Next 16 renamed the `middleware` convention to `proxy` (function must be named
// `proxy` or be the default export). Same Step-4 gate as middleware.ts.bak. Proxy
// runs on the Node.js runtime, so createServerClient / getUser() / rpc all work here.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Response we can attach any refreshed auth cookies to.
  let response = NextResponse.next({ request })

  // Server client that reads/writes the session from request cookies (the cookie
  // session written by the browser client at login).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser() revalidates the JWT against Supabase Auth (don't trust getSession alone).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Admin check runs with the caller's session so is_admin() sees auth.uid()
  // (public.admins). Fail closed: any error ⇒ treated as not-admin.
  let isAdmin = false
  if (user) {
    const { data, error } = await supabase.rpc('is_admin')
    isAdmin = !error && data === true
  }

  // Redirect helper that carries over any refreshed auth cookies.
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    const res = NextResponse.redirect(url)
    response.cookies.getAll().forEach(c => res.cookies.set(c))
    return res
  }

  // /login is always reachable — except a logged-in admin gets bounced to the dashboard.
  if (pathname === '/login') {
    return user && isAdmin ? redirectTo('/') : response
  }

  // Every other matched route requires an authenticated admin.
  if (!user || !isAdmin) return redirectTo('/login')

  return response
}

export const config = {
  matcher: [
    // All routes EXCEPT Next internals and static files (any path with a dot).
    // /login IS matched so a logged-in admin can be redirected to '/'.
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
