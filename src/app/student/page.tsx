import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { listOfferingsForStudent } from '@/lib/assignments/queries';
import { SignOutButton } from '@/components/sign-out-button';
import { CourseCard } from '@/components/student/course-card';
import { EmptyState } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'Home · Campus' };

/**
 * Student home: a vertical scroll of course cards for this term.
 *
 * IDENTITY ONLY — no due counts on the card (SPEC.md §3.1). A badge saying "3
 * due" turns the home screen into a source of low-grade dread every time it is
 * opened. What is due lives in To-Do, where the student goes when they want to
 * know.
 *
 * Mobile-first: designed at ~390px, centred on wider screens rather than
 * stretched.
 */
export default async function StudentHome() {
  const profile = await requireRole('student');
  const offerings = await listOfferingsForStudent(profile);

  const firstName = profile.fullName.split(' ')[0];

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="screen-title text-ink">Hello, {firstName}</h1>
          {/* Explicit separator element between the institution and the roll
              number — never two spans butted together. */}
          <p className="text-ink-soft mt-2 text-[14px]">
            {profile.institutionName}
            {profile.rollNumber ? (
              <>
                <span className="text-ink-faint px-1.5">·</span>
                <span className="font-mono text-[12.5px]">
                  {profile.rollNumber}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <SignOutButton />
      </header>

      <h2 className="eyebrow text-ink-faint mt-9">Your courses</h2>

      {offerings.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No courses yet."
            body="Once your department sets up the term, your courses appear here."
          />
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {offerings.map((o) => (
            <li key={o.offeringId}>
              <CourseCard
                offering={o}
                href={`/student/courses/${o.offeringId}`}
                subtitle={`Section ${o.section} · ${o.credits} credits`}
              />
            </li>
          ))}
        </ul>
      )}

      {/* The five-tab bottom bar (Home · Calendar · To-Do · Notifications ·
          More) arrives with the features behind it. One tab that works beats
          five that mostly do not. */}
    </div>
  );
}
