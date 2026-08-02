import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listAssignmentsForFaculty } from '@/lib/assignments/queries';
import { formatDay } from '@/lib/format';
import { Card, EmptyState } from '@/components/kit/surfaces';
import { StatePill } from '@/components/kit/data-table';

export const metadata: Metadata = { title: 'Submissions · Campus' };

/**
 * Submissions is per assignment, so this is the chooser.
 *
 * Drafts are excluded: nothing can have been handed in to an assignment
 * students cannot see, so a row here would only ever read "0 / 13" and invite
 * the professor to click it.
 */
export default async function SubmissionsIndexPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('faculty');
  const all = await listAssignmentsForFaculty(profile, offeringId);
  const assignments = all.filter((a) => a.status !== 'draft');
  const now = new Date();

  return (
    <div>
      <h1 className="screen-title text-ink">Submissions</h1>
      <p className="text-ink-soft mt-2 text-[14px]">
        Pick an assignment to see who has handed in.
      </p>

      {assignments.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing published yet."
            body="Once an assignment is open to students, this is where you will see who has handed in and who has not."
          />
        </div>
      ) : (
        <Card className="mt-7">
          <ul className="divide-card-border divide-y">
            {assignments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/faculty/courses/${offeringId}/submissions/${a.id}`}
                  className="hover:bg-canvas flex items-center justify-between gap-4 px-5 py-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-ink text-[15px] font-semibold tracking-[-0.02em]">
                      {a.title}
                    </p>
                    <p className="text-ink-soft mt-1 text-[12.5px]">
                      {a.status === 'closed' ? 'Closed' : 'Due'}
                      <span className="px-1">·</span>
                      {formatDay(a.dueAt, profile.timeZone, now)}
                      <span className="px-1.5">·</span>
                      {a.marks} marks
                    </p>
                  </div>
                  <StatePill tone={a.gradesReleased ? 'neutral' : 'quiet'}>
                    {a.gradesReleased ? 'Published' : 'Not published'}
                  </StatePill>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
