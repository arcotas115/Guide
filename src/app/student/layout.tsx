import { requireRole } from '@/lib/auth';

/**
 * The guard lives in the layout, so it covers every current and future page
 * under /student without anyone having to remember to add it. Middleware only
 * checks "is there a session"; this checks "is this the right person".
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('student');
  return <div className="flex flex-1 flex-col">{children}</div>;
}
