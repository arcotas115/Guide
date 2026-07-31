'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * A server action, not a GET route. Sign-out mutates state, and a GET endpoint
 * that logs you out can be fired by a prefetch, an <img src>, or a link in
 * someone else's page.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
