import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { HOME_FOR_ROLE, isRole, type Role } from '@/lib/roles';
import { DEFAULT_TIME_ZONE } from '@/lib/timezone';
import {
  canSignIn,
  isAccountStatus,
  type AccountStatus,
} from '@/lib/account-status';

export type CurrentProfile = {
  id: string;
  institutionId: string;
  role: Role;
  fullName: string;
  email: string;
  rollNumber: string | null;
  institutionName: string;
  /** Config-as-data: read from the institution row, never a hardcoded 75. */
  minAttendancePct: number;
  /**
   * The institution's IANA timezone. Every date this app renders resolves
   * through it — see src/lib/format.ts, where it is a required argument
   * precisely so a screen cannot forget to ask.
   */
  timeZone: string;
  /** Access level. See DELETION_POLICY.md §1 — this is not biography. */
  status: AccountStatus;
};

/**
 * The signed-in user's profile, or null.
 *
 * Always `getUser()`, never `getSession()`. getSession() reads the cookie and
 * trusts it; getUser() revalidates the JWT with the auth server. On a server
 * that is the difference between a real check and a forgeable one.
 *
 * Wrapped in React's `cache()`, so a layout guarding the route and the page
 * inside it rendering the user's name cost one round trip between them, not
 * two. The cache is per-request — it never leaks across users.
 */
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // One tenant at a time (rule 5): this reads exactly one profile row, and RLS
  // would refuse anything outside the caller's own institution regardless.
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, institution_id, role, full_name, email, roll_number, status, institutions(name, min_attendance_pct, timezone)',
    )
    .eq('id', user.id)
    .single();

  if (error || !data) return null;
  if (!isRole(data.role)) return null;

  // The embedded institution arrives as an object (or array, depending on how
  // PostgREST infers the relationship) — normalise both shapes.
  const institution = Array.isArray(data.institutions)
    ? data.institutions[0]
    : data.institutions;

  return {
    id: data.id,
    institutionId: data.institution_id,
    role: data.role,
    fullName: data.full_name,
    email: data.email,
    rollNumber: data.roll_number,
    institutionName: institution?.name ?? 'Campus',
    minAttendancePct: institution?.min_attendance_pct ?? 75,
    timeZone: institution?.timezone ?? DEFAULT_TIME_ZONE,
    // An unrecognised status is treated as inactive rather than active. A
    // status column that fails open is not a guard.
    status: isAccountStatus(data.status) ? data.status : 'inactive',
  };
});

/**
 * Require a signed-in user whose account may hold a session.
 *
 * The status check lives here rather than only at login, because an account
 * deactivated at 10am must stop working at 10am — not whenever its owner next
 * chooses to sign in.
 *
 * It redirects to /auth/blocked rather than straight to /login on purpose. The
 * session cookie is still valid at this point, so sending them to /login would
 * have the proxy bounce them to "/", which lands back here — an infinite loop.
 * /auth/blocked is a route handler, so it can actually revoke the session
 * before forwarding to the message.
 */
export async function requireProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!canSignIn(profile.status)) redirect(`/auth/blocked?reason=${profile.status}`);
  return profile;
}

/**
 * Require one of `allowed`. A user with a valid session but the wrong role is
 * sent to their own home rather than the login page — they are authenticated,
 * just in the wrong place.
 */
export async function requireRole(
  ...allowed: readonly Role[]
): Promise<CurrentProfile> {
  const profile = await requireProfile();
  if (!allowed.includes(profile.role)) {
    redirect(HOME_FOR_ROLE[profile.role]);
  }
  return profile;
}
