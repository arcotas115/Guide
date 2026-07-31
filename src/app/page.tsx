import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/lib/auth';
import { HOME_FOR_ROLE } from '@/lib/roles';

/**
 * "/" is a router, not a page. Middleware refreshes the session but never
 * queries the database (it runs on every request); this is where the role is
 * resolved, once, and turned into a destination.
 */
export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) redirect('/login');

  redirect(HOME_FOR_ROLE[profile.role]);
}
