import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isLocalAuthEnabled,
  LOCAL_SESSION_COOKIE,
  verifyLocalSessionToken,
} from '@/lib/auth/local-session'

const authPaths = ['/login', '/signup', '/forgot-password']
const protectedPaths = [
  '/dashboard',
  '/inbox',
  '/notifications',
  '/contacts',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/flows',
  '/agents',
  '/settings',
]

export async function middleware(request: NextRequest) {
  // Local installations can use a signed, HttpOnly session without
  // contacting Supabase Auth. This is an optimistic route gate; API
  // handlers and data access still keep their own authorization checks.
  if (isLocalAuthEnabled()) {
    const authenticated = await verifyLocalSessionToken(
      request.cookies.get(LOCAL_SESSION_COOKIE)?.value,
    )
    const pathname = request.nextUrl.pathname

    if (authenticated && authPaths.includes(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      url.search = ''
      return NextResponse.redirect(url)
    }

    if (!authenticated && authPaths.includes(pathname) && pathname !== '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      return NextResponse.redirect(url)
    }

    if (!authenticated && protectedPaths.some(path => pathname.startsWith(path))) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }

    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          Object.entries(headersToSet).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value)
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    ;['cache-control', 'expires', 'pragma'].forEach((name) => {
      const value = supabaseResponse.headers.get(name)
      if (value) response.headers.set(name, value)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  return supabaseResponse
}

// `/api/*` is excluded below: every route handler under src/app/api verifies
// its own auth (session cookie, HMAC/webhook signature, API key, or shared
// cron secret — audited route by route), so running this middleware's
// Supabase getUser() network round-trip in front of them too was pure
// overhead — measured at 90-660ms per request, including on requests (like
// inbound WhatsApp webhooks) that carry no user session at all.
// `/icon` is the dynamic favicon (src/app/icon.tsx) — it needs no auth and
// was paying the same round-trip on every page load.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
