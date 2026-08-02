import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { listOfferingsForFaculty } from '@/lib/assignments/queries';
import { SignOutButton } from '@/components/sign-out-button';
import { CourseCard } from '@/components/student/course-card';
import { DesktopShell, TopBar } from '@/components/kit/app-shell';
import { EmptyState, Eyebrow } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'Your courses · Campus' };

/**
 * Professor home. A warm greeting and the courses they teach — no stat boxes,
 * no workload tally (DESIGN.md §8: calm over dense). The per-course hints the
 * spec describes ("16 submissions to grade") arrive with the features that can
 * count them honestly; an invented number would be worse than none.
 *
 * The course card is the SAME component the student home uses. One card
 * definition means the spine, the radius and the type scale cannot drift apart
 * between the two surfaces.
 */
export default async function FacultyHome() {
  const profile = await requireRole('faculty');
  const offerings = await listOfferingsForFaculty(profile);

  const firstName = profile.fullName.replace(/^Dr\.?\s+/i, '').split(' ')[0];

  return (
    <DesktopShell
      topBar={
        <TopBar
          institutionName={profile.institutionName}
          surface="Faculty"
          personName={profile.fullName}
          action={<SignOutButton />}
        />
      }
    >
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="screen-title text-ink">Good to see you, {firstName}.</h1>
        <p className="text-ink-soft mt-2 text-[14.5px]">
          {profile.institutionName}
        </p>

        <Eyebrow className="mt-10">Your courses</Eyebrow>

        {offerings.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No courses assigned yet."
              body="Your admin sets this up when the term is created. Once a course is yours, it appears here."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {offerings.map((o) => (
              <li key={o.offeringId}>
                <CourseCard
                  offering={o}
                  href={`/faculty/courses/${o.offeringId}/assignments`}
                  subtitle={`Section ${o.section} · ${o.termName} · ${o.credits} credits`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </DesktopShell>
  );
}
