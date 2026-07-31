import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { RolePlaceholder } from '@/components/role-placeholder';

export const metadata: Metadata = { title: 'Home · Campus' };

export default async function AdminHome() {
  const profile = await requireRole('admin', 'placement_officer');

  return (
    <RolePlaceholder
      profile={profile}
      surface="Admin"
      upcoming={[
        'People — students and staff, imported in bulk',
        'Courses & offerings — the term’s catalogue and who teaches what',
        'Announcements — targeted at a year, a department or everyone',
        'Settings — attendance threshold, terms, departments',
      ]}
    />
  );
}
