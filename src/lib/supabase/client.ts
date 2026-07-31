import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * Supabase client for Client Components.
 *
 * This runs in the user's browser with the publishable key, which is public by
 * design — every row it can reach is decided by RLS (supabase/migrations/
 * 0002_rls_policies.sql), never by this key being secret.
 */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
