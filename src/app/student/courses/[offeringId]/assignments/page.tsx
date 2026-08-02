import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  getOfferingForStudent,
  listAssignmentsForStudent,
  type StudentAssignment,
} from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';
import { Card, Chevron, EmptyState } from '@/components/kit/surfaces';
import { SubmittedTick } from '@/components/student/submitted-tick';
import { STATE_STYLES } from '@/lib/assignments/state';
import { formatDay } from '@/lib/format';

export const metadata: Metadata = { title: 'Assignments · Campus' };

export default async function StudentAssignmentsPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('student');

  const offering = await getOfferingForStudent(profile, offeringId);
  if (!offering) notFound();

  // Drafts never arrive here — the RLS policy on `assignments` excludes them
  // for enrolled students. There is deliberately no `.neq('status', 'draft')`
  // below: a filter in application code can be forgotten, and the point of
  // enforcing it in the database is that it cannot.
  const assignments = await listAssignmentsForStudent(profile, offeringId);
  const now = new Date();

  return (
    <>
      <CourseHeader
        offering={offering}
        variant="wash"
        title="Assignments"
        backHref={`/student/courses/${offeringId}`}
        backLabel={offering.courseTitle}
      />

      <div
        className="course-scope mx-auto w-full max-w-md px-5 py-5"
        style={{ '--course-color': offering.courseColor } as React.CSSProperties}
      >
        {assignments.length === 0 ? (
          <EmptyState
            title="All caught up."
            body="When your professor posts an assignment for this course, it shows up here and in your To-Do."
          />
        ) : (
          <Card>
            <ul className="divide-card-border divide-y">
              {assignments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/student/courses/${offeringId}/assignments/${a.id}`}
                    className="active:bg-canvas block transition-colors"
                  >
                    <div
                      className={`flex items-center gap-3 px-4 py-3.5 ${
                        a.derived.state === 'upcoming' ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-ink text-[15.5px] leading-tight font-semibold tracking-[-0.02em]">
                          {a.title}
                        </p>
                        {/* One line of state — the derived label, not a status
                            word. "Due 12 Aug" beats "OPEN". */}
                        <p
                          className={`mt-1 text-[13.5px] leading-snug ${STATE_STYLES[a.derived.state]}`}
                        >
                          {rowSubtitle(a, now, profile.timeZone)}
                        </p>
                      </div>

                      {a.derived.state === 'graded' && a.grade !== null ? (
                        <span
                          className="shrink-0 rounded-lg px-2.5 py-1.5 font-mono text-[13px] font-medium"
                          style={{
                            background: 'var(--course-tint)',
                            color: 'var(--course-color)',
                          }}
                        >
                          {a.grade}/{a.marks}
                        </span>
                      ) : a.submittedAt ? (
                        // One component, used on every surface — see
                        // submitted-tick.tsx for why it is not three
                        // conditionals in three files.
                        <SubmittedTick state={a.derived.state} />
                      ) : a.derived.state === 'upcoming' ? (
                        <span className="eyebrow text-ink-faint shrink-0">
                          Upcoming
                        </span>
                      ) : null}

                      <Chevron />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

/** The derived label, with marks appended where they add something. */
function rowSubtitle(a: StudentAssignment, now: Date, tz: string): string {
  if (a.derived.state === 'graded') {
    // Only claim feedback exists when it does — the prototype's "feedback
    // attached" line is a promise, and an empty feedback box would break it.
    return a.feedback ? 'Graded · feedback attached' : 'Graded';
  }
  if (a.derived.state === 'open') {
    return `${a.marks} marks · due ${formatDay(a.dueAt, tz, now)}`;
  }
  return a.derived.label;
}
