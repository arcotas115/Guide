'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { HOME_FOR_ROLE, isRole } from '@/lib/roles';
import { blockedMessage, isAccountStatus } from '@/lib/account-status';

/**
 * "Validate at the door" (BUILD_RULES.md). Nothing from the form is trusted; it
 * is parsed here, on the server, before it reaches Supabase.
 */
const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginState = { error: string | null };

/**
 * Only same-origin, single-slash paths are allowed as a post-login destination.
 * Without this check, `/login?next=https://evil.example` would turn our own
 * login page into an open redirect — a phishing primitive, handed over free.
 */
function safeNext(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Deliberately one message for both "no such user" and "wrong password".
    // Distinguishing them turns the login form into an account enumerator.
    return { error: 'That email and password do not match an account.' };
  }

  // The session cookie is now set, so this select runs as the signed-in user and
  // RLS applies. `.single()` on their own id — one tenant, one row.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', data.user.id)
    .single();

  const next = safeNext(formData.get('next'));

  // A profile row is created by the seed/admin import, not by signup. If auth
  // succeeded but no profile exists, the account is half-provisioned — say so
  // rather than dropping them somewhere confusing.
  if (!profile || !isRole(profile.role)) {
    await supabase.auth.signOut();
    return {
      error:
        'Your account is not set up for any institution yet. Contact your admin.',
    };
  }

  // Access level, checked after identity. An unrecognised status is treated as
  // inactive — a guard that fails open is not a guard.
  const status = isAccountStatus(profile.status) ? profile.status : 'inactive';
  const blocked = blockedMessage(status);
  if (blocked) {
    // The credentials were correct, so a session now exists. End it before
    // returning, or the browser holds a session for an account that may not
    // sign in.
    await supabase.auth.signOut();
    return { error: blocked };
  }

  // redirect() works by throwing, so it must sit outside any try/catch.
  redirect(next ?? HOME_FOR_ROLE[profile.role]);
}
