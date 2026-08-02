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
 *
 * WIDTH. Student screens are designed at 390px and are reviewed on a desktop
 * monitor, so on a wide viewport the whole surface is constrained to a
 * phone-width centred column on the page colour — the same three-layer
 * treatment DesktopShell gives the faculty side. Stretching a 390px design
 * across 2560px does not make it a desktop design; it makes it impossible to
 * judge.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole('student');
  return (
    <div className="bg-page flex min-h-dvh justify-center">
      <div className="bg-canvas border-card-border relative flex min-h-dvh w-full max-w-[430px] flex-1 flex-col sm:border-x">
        <div className="flex-1 pb-24">{children}</div>
        <BottomBar />
      </div>
    </div>
  );
}
