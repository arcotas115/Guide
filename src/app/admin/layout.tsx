import { requireRole } from '@/lib/auth';

/**
 * placement_officer is deferred in v1 and shares the admin surface for now
 * (see HOME_FOR_ROLE), so it is allowed through here too.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('admin', 'placement_officer');
  return <div className="flex flex-1 flex-col">{children}</div>;
}
