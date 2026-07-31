import { requireRole } from '@/lib/auth';

export default async function FacultyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('faculty');
  return <div className="flex flex-1 flex-col">{children}</div>;
}
