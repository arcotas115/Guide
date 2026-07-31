import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Next 16 renamed the `middleware` file convention to `proxy`. Same runtime,
 * same semantics — it runs before every matched request.
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The session still needs
     * refreshing on ordinary page loads, so we cannot narrow this to just the
     * protected prefixes — an expired token on a public page should still be
     * renewed rather than left to go stale.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
