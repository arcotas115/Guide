import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getOfferingForFaculty } from '@/lib/assignments/queries';
import { CourseSidebar } from '@/components/faculty/course-sidebar';
import { DesktopShell, TopBar } from '@/components/kit/app-shell';
import { SignOutButton } from '@/components/sign-out-button';

/**
 * The course workspace shell. Desktop-first: page surround, centred canvas,
 * fixed sidebar rail, and the content column doing the centring.
 *
 * The guard is here rather than on each page so every future section inherits
 * it. getOfferingForFaculty returns null unless a teaching_assignments row ties
 * this professor to this offering, so a guessed id in the URL is a 404 — not a
 * peek at a colleague's course.
 */
export default async function CourseWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('faculty');
  const offering = await getOfferingForFaculty(profile, offeringId);

  if (!offering) notFound();

  return (
    <div
      className="course-scope"
      style={{ '--course-color': offering.courseColor } as React.CSSProperties}
    >
      <DesktopShell
        topBar={
          <TopBar
            institutionName={profile.institutionName}
            surface="Faculty"
            personName={profile.fullName}
            personSubtitle={offering.termName}
            action={<SignOutButton />}
          />
        }
        sidebar={<CourseSidebar offering={offering} />}
      >
        {children}
      </DesktopShell>
    </div>
  );
}
