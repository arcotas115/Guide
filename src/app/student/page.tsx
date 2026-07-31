import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listOfferingsForStudent } from '@/lib/assignments/queries';
import { SignOutButton } from '@/components/sign-out-button';

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
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            Hello, {firstName}
          </h1>
          <p className="text-subtle mt-1 text-sm">
            {profile.institutionName}
            {profile.rollNumber ? (
              <>
                {' · '}
                <span className="font-mono text-xs">{profile.rollNumber}</span>
              </>
            ) : null}
          </p>
        </div>
        <SignOutButton />
      </header>

      <h2 className="text-subtle mt-9 text-xs font-medium tracking-widest uppercase">
        Your courses
      </h2>

      {offerings.length === 0 ? (
        <p className="text-subtle bg-surface border-hairline mt-3 rounded-xl border px-5 py-8 text-sm leading-relaxed">
          You are not enrolled in anything yet. Once your department sets up the
          term, your courses appear here.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {offerings.map((o) => (
            <li key={o.offeringId}>
              <Link
                href={`/student/courses/${o.offeringId}`}
                className="course-scope bg-surface-warm border-hairline block overflow-hidden rounded-xl border active:scale-[0.995] active:transition-transform"
                style={
                  { '--course-color': o.courseColor } as React.CSSProperties
                }
              >
                <div className="flex items-stretch">
                  <div
                    className="w-1.5 shrink-0"
                    style={{ background: 'var(--course-color)' }}
                    aria-hidden
                  />
                  <div className="flex-1 px-4 py-4">
                    <p
                      className="font-mono text-[13px] font-medium tracking-wide"
                      style={{ color: 'var(--course-color)' }}
                    >
                      {o.courseCode}
                    </p>
                    <p className="text-ink mt-0.5 text-base font-medium">
                      {o.courseTitle}
                    </p>
                    <p className="text-subtle mt-1 text-xs">
                      Section {o.section} · {o.credits} credits
                    </p>
                  </div>
                </div>
              </Link>
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
