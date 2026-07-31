import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Still the publishable key, so RLS applies exactly as it does in the browser —
 * server code gets no ambient privilege. `cookies()` is async in Next 16, hence
 * the await.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. That is fine and expected:
            // middleware refreshes the session on every request, so the tokens
            // are already current by the time we get here.
          }
        },
      },
    },
  );
}
