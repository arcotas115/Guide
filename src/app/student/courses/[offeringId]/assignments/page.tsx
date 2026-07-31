import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  getOfferingForStudent,
  listAssignmentsForStudent,
} from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';
import { STATE_STYLES } from '@/lib/assignments/state';

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

  return (
    <>
      <CourseHeader
        offering={offering}
        title="Assignments"
        backHref={`/student/courses/${offeringId}`}
        backLabel={offering.courseTitle}
      />

      <div className="mx-auto w-full max-w-md px-5 py-5">
        {assignments.length === 0 ? (
          <div className="bg-surface border-hairline rounded-xl border px-5 py-12 text-center">
            <p className="text-ink text-sm font-medium">Nothing set yet.</p>
            <p className="text-subtle mx-auto mt-1.5 max-w-[16rem] text-xs leading-relaxed">
              When your professor posts an assignment for this course, it shows
              up here and in your To-Do.
            </p>
          </div>
        ) : (
          <ul className="divide-hairline-soft bg-surface border-hairline divide-y overflow-hidden rounded-xl border">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/student/courses/${offeringId}/assignments/${a.id}`}
                  className="active:bg-hairline-soft block px-4 py-3.5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-medium">{a.title}</p>
                      {/* One line of state — the derived label, not a status
                          word. "Due 12 Aug" beats "OPEN". */}
                      <p
                        className={`mt-1 text-xs ${STATE_STYLES[a.derived.state]}`}
                      >
                        {a.derived.state === 'graded' && a.grade !== null
                          ? `Graded · ${a.grade} / ${a.marks}`
                          : a.derived.label}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      {a.submittedAt ? (
                        // The persistent ✓ (SPEC.md §3.3) — quiet, green, and
                        // everywhere the assignment appears, so nobody has to
                        // wonder whether it went through.
                        <span
                          className="text-moss text-sm"
                          title="Submitted"
                          aria-label="Submitted"
                        >
                          ✓
                        </span>
                      ) : null}
                      <span className="text-faint font-mono text-xs">
                        {a.marks}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
