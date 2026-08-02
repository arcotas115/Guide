import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  getOfferingForStudent,
  listAssignmentsForStudent,
} from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';
import { Card, SectionRow } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'Course · Campus' };

/**
 * Course detail: the full-colour course hub header and a vertical list of
 * sections — Canvas mobile style, NOT top tabs (SPEC.md §3.2). Top tabs on a
 * phone force a horizontal scroll nobody discovers; a list shows all seven.
 *
 * Only Assignments works this session. The rest render dimmed and chevron-less
 * rather than as links that 404 — the difference between "not built yet" and
 * "broken", which is the difference between a student trusting the app or not.
 */
const SECTIONS = [
  { slug: 'info', label: 'Info', blurb: 'Outline, professor, mark split' },
  { slug: 'assignments', label: 'Assignments', live: true },
  {
    slug: 'announcements',
    label: 'Announcements',
    blurb: 'Posts from your professor',
  },
  {
    slug: 'grades',
    label: 'Grades',
    blurb: 'Your marks, with the class average',
  },
  { slug: 'files', label: 'Files', blurb: 'Slides, notes and links' },
  {
    slug: 'attendance',
    label: 'Attendance',
    blurb: 'Your percentage for this course',
  },
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

  // The Assignments row carries live state, per DESIGN.md §6's section row.
  // Counted from the same derived states the list itself renders, so the row
  // and the screen behind it can never disagree.
  const assignments = await listAssignmentsForStudent(profile, offeringId);
  const overdue = assignments.filter(
    (a) => a.derived.state === 'overdue',
  ).length;
  const open = assignments.filter((a) => a.derived.state === 'open').length;

  const assignmentsSubtitle =
    assignments.length === 0
      ? 'Nothing set yet'
      : [
          overdue > 0 ? `${overdue} overdue` : null,
          open > 0 ? `${open} open` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Nothing due right now';

  return (
    <>
      <CourseHeader
        offering={offering}
        variant="hub"
        backHref="/student"
        backLabel="Courses"
      />

      <div
        className="course-scope mx-auto w-full max-w-md px-5 py-5"
        style={{ '--course-color': offering.courseColor } as React.CSSProperties}
      >
        <Card>
          <ul className="divide-card-border divide-y">
            {SECTIONS.map((section) => {
              const live = 'live' in section;

              if (!live) {
                return (
                  <li key={section.slug} className="opacity-55">
                    <SectionRow
                      title={section.label}
                      subtitle={section.blurb}
                      muted
                    />
                  </li>
                );
              }

              return (
                <li key={section.slug}>
                  <Link
                    href={`/student/courses/${offeringId}/${section.slug}`}
                    className="active:bg-canvas block transition-colors"
                  >
                    <SectionRow
                      title={section.label}
                      subtitle={assignmentsSubtitle}
                      // Rust here ONLY because something is genuinely overdue.
                      urgent={overdue > 0}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <p className="text-ink-faint mt-4 px-1 text-[12.5px] leading-relaxed">
          The dimmed sections are on the way. Assignments is live now.
        </p>
      </div>
    </>
  );
}
