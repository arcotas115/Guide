import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listOfferingsForFaculty } from '@/lib/assignments/queries';
import { SignOutButton } from '@/components/sign-out-button';

export const metadata: Metadata = { title: 'Your courses · Campus' };

/**
 * Professor home. A warm greeting and the courses they teach — no stat boxes,
 * no workload tally (BUILD_RULES.md: calm over dense). The per-course hints the
 * spec describes ("16 submissions to grade") arrive with the features that can
 * count them honestly; an invented number would be worse than none.
 */
export default async function FacultyHome() {
  const profile = await requireRole('faculty');
  const offerings = await listOfferingsForFaculty(profile);

  const firstName = profile.fullName.replace(/^Dr\.?\s+/i, '').split(' ')[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-ink text-3xl font-semibold tracking-tight">
            Good to see you, {firstName}.
          </h1>
          <p className="text-subtle mt-1.5 text-sm">{profile.institutionName}</p>
        </div>
        <SignOutButton />
      </header>

      <h2 className="text-subtle mt-12 text-xs font-medium tracking-widest uppercase">
        Your courses
      </h2>

      {offerings.length === 0 ? (
        <p className="text-subtle bg-surface border-hairline mt-4 rounded-xl border px-5 py-8 text-sm">
          You are not assigned to any course yet. Your admin sets this up when
          the term is created.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {offerings.map((o) => (
            <li key={o.offeringId}>
              <Link
                href={`/faculty/courses/${o.offeringId}/assignments`}
                className="course-scope bg-surface-warm border-hairline hover:border-hairline block overflow-hidden rounded-xl border transition-shadow hover:shadow-sm"
                style={
                  { '--course-color': o.courseColor } as React.CSSProperties
                }
              >
                <div className="flex items-stretch">
                  {/* The identity colour, as a left accent bar. */}
                  <div
                    className="w-1.5 shrink-0"
                    style={{ background: 'var(--course-color)' }}
                    aria-hidden
                  />
                  <div className="flex-1 px-5 py-4">
                    <p
                      className="font-mono text-[13px] font-medium tracking-wide"
                      style={{ color: 'var(--course-color)' }}
                    >
                      {o.courseCode}
                    </p>
                    <p className="text-ink mt-0.5 text-lg font-medium">
                      {o.courseTitle}
                    </p>
                    <p className="text-subtle mt-1 text-sm">
                      Section {o.section} · {o.termName} · {o.credits} credits
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
