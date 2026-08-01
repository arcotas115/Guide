import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAccountStatus } from '@/lib/account-status';

/**
 * End the session of an account that may no longer hold one, then forward to
 * the login page with a reason.
 *
 * WHY A ROUTE HANDLER. `requireProfile()` runs inside Server Components, which
 * cannot set cookies — so they cannot sign anyone out. Redirecting such a user
 * straight to /login would leave their session cookie intact, the proxy would
 * bounce them from /login to "/", and "/" would send them here again: a loop
 * that renders nothing. A route handler can write cookies, so the session is
 * actually revoked before the message is shown.
 *
 * GET is correct here despite being a mutation, because it is the target of a
 * redirect rather than something a user or a prefetch can trigger to another
 * person's detriment — the worst case is signing yourself out.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const raw = request.nextUrl.searchParams.get('reason');
  const reason = isAccountStatus(raw) && raw !== 'active' ? raw : null;

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (reason) url.searchParams.set('reason', reason);

  return NextResponse.redirect(url);
}
