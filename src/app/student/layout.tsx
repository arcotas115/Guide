import { requireRole } from '@/lib/auth';
import { BottomBar } from '@/components/student/bottom-bar';

/**
 * The guard lives in the layout, so it covers every current and future page
 * under /student without anyone having to remember to add it. Middleware only
 * checks "is there a session"; this checks "is this the right person".
 *
 * The bottom bar lives here for the same reason — every student screen gets it,
 * and none of them has to remember. `pb-24` reserves room for it: a fixed bar
 * over the last row of a list is the classic way a "submit" button becomes
 * unreachable on a small phone.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('student');
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <div className="flex-1 pb-24">{children}</div>
      <BottomBar />
    </div>
  );
}
