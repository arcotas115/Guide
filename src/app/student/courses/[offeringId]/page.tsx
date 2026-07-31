import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getOfferingForStudent } from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';

export const metadata: Metadata = { title: 'Course · Campus' };

/**
 * Course detail: a tinted header and a vertical list of sections — Canvas
 * mobile style, NOT top tabs (SPEC.md §3.2). Top tabs on a phone force a
 * horizontal scroll nobody discovers; a list shows all seven at once.
 *
 * Only Assignments works this session. The rest render as visibly inert rows
 * rather than links that 404 — the difference between "not built yet" and
 * "broken", which is the difference between a student trusting the app or not.
 */
const SECTIONS = [
  { slug: 'info', label: 'Info', blurb: 'Outline, professor, mark split' },
  {
    slug: 'assignments',
    label: 'Assignments',
    blurb: 'What is due, and what you have handed in',
    live: true,
  },
  { slug: 'announcements', label: 'Announcements', blurb: 'Posts from your professor' },
  { slug: 'grades', label: 'Grades', blurb: 'Your marks, with the class average' },
  { slug: 'files', label: 'Files', blurb: 'Slides, notes and links' },
  { slug: 'attendance', label: 'Attendance', blurb: 'Your percentage for this course' },
  { slug: 'teams', label: 'Teams', blurb: 'Project groups' },
] as const;

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('student');
  const offering = await getOfferingForStudent(profile, offeringId);
  if (!offering) notFound();

  return (
    <>
      <CourseHeader
        offering={offering}
        backHref="/student"
        backLabel="Your courses"
      />

      <div className="mx-auto w-full max-w-md px-5 py-5">
        <ul className="divide-hairline-soft bg-surface border-hairline divide-y overflow-hidden rounded-xl border">
          {SECTIONS.map((section) => {
            const content = (
              <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div>
                  <p
                    className={
                      'live' in section
                        ? 'text-ink text-sm font-medium'
                        : 'text-faint text-sm font-medium'
                    }
                  >
                    {section.label}
                  </p>
                  <p className="text-subtle mt-0.5 text-xs">{section.blurb}</p>
                </div>
                <span
                  className={'live' in section ? 'text-subtle' : 'text-faint/50'}
                  aria-hidden
                >
                  ›
                </span>
              </div>
            );

            if (!('live' in section)) {
              return (
                // Not a link and not focusable — inert by construction, so it
                // needs no aria-disabled (which listitem does not support).
                <li key={section.slug} className="opacity-55">
                  {content}
                </li>
              );
            }

            return (
              <li key={section.slug}>
                <Link
                  href={`/student/courses/${offeringId}/${section.slug}`}
                  className="active:bg-hairline-soft block transition-colors"
                >
                  {content}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="text-faint mt-4 px-1 text-xs leading-relaxed">
          The greyed sections are on the way. Assignments is live now.
        </p>
      </div>
    </>
  );
}
