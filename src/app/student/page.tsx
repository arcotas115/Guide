import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { RolePlaceholder } from '@/components/role-placeholder';

export const metadata: Metadata = { title: 'Home · Campus' };

export default async function StudentHome() {
  // Deduped with the layout's call by React cache() — one query, not two.
  const profile = await requireRole('student');

  return (
    <RolePlaceholder
      profile={profile}
      surface="Student"
      upcoming={[
        'Today — next class, what is due, one thing that needs attention',
        'Courses — one card per enrolled offering, in its own colour',
        'Calendar — timetable and deadlines on one surface',
        'Attendance — per course, against your institution’s threshold',
      ]}
    />
  );
}
