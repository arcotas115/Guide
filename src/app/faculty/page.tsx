import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { RolePlaceholder } from '@/components/role-placeholder';

export const metadata: Metadata = { title: 'Home · Campus' };

export default async function FacultyHome() {
  const profile = await requireRole('faculty');

  return (
    <RolePlaceholder
      profile={profile}
      surface="Professor"
      upcoming={[
        'My courses — the offerings you teach this term',
        'Take attendance — rotating code, or mark the list',
        'Assignments — draft, open, close; release grades separately',
        'Grading — submissions queue, marks and feedback',
      ]}
    />
  );
}
