import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isProtectedPath } from '@/lib/roles';

/**
 * Refresh the auth session on every request, and gate protected routes.
 *
 * THE SUBTLE PART — why the response is built the way it is:
 * Supabase rotates the access token on refresh. The new cookies must reach the
 * browser, so they have to be written onto the *exact* response object that is
 * returned. Creating a fresh NextResponse afterwards, or returning a different
 * one, silently drops them; the symptom is a user who appears logged in until a
 * random request an hour later logs them out. Hence: whenever setAll fires we
 * rebuild `response` and re-apply the cookies to it, and any redirect below
 * copies those cookies across before being returned.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Revalidates the JWT with Supabase (not just cookie-reading) and triggers
  // the refresh that setAll above captures. Do not replace with getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /** Redirect while preserving any refreshed auth cookies. */
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    for (const [k, v] of Object.entries(params ?? {})) {
      url.searchParams.set(k, v);
    }
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  if (!user && isProtectedPath(pathname)) {
    // Remember where they were headed so login can return them there.
    return redirectTo('/login', { next: pathname });
  }

  if (user && pathname === '/login') {
    // Send them to "/", which resolves the role and forwards to the right home.
    // Middleware deliberately does NOT query the database for the role: it runs
    // on every request including assets, and a per-request round trip there is
    // a latency tax the layouts can pay once instead.
    return redirectTo('/');
  }

  return response;
}
