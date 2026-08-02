import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getAssignmentForFaculty } from '@/lib/assignments/queries';
import {
  getSubmissionsForAssignment,
  type SubmissionRow,
  type SubmissionState,
} from '@/lib/submissions/faculty-queries';
import { penaltyLabel } from '@/lib/submissions/penalty';
import { formatDateTime } from '@/lib/format';
import {
  DataTable,
  TableCell,
  TableGroupHeader,
  TableRow,
  StatePill,
  type Column,
} from '@/components/kit/data-table';
import { FilterChip } from '@/components/kit/filter-chip';
import { EmptyState, Eyebrow } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'Submissions · Campus' };

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'to-grade', label: 'To grade' },
  { key: 'missing', label: 'Not submitted' },
  { key: 'graded', label: 'Graded' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function matches(row: SubmissionRow, filter: FilterKey): boolean {
  switch (filter) {
    case 'to-grade':
      return row.state === 'submitted';
    case 'missing':
      return row.state === 'not_submitted';
    case 'graded':
      return row.state === 'graded_unpublished' || row.state === 'published';
    default:
      return true;
  }
}

const STATE_LABEL: Record<SubmissionState, string> = {
  not_submitted: 'Not submitted',
  submitted: 'Submitted',
  graded_unpublished: 'Graded',
  published: 'Published',
};

const COLUMNS: Column[] = [
  { label: 'Student' },
  { label: 'State', width: '10rem' },
  { label: 'Latest attempt', width: '15rem' },
  { label: 'Attempts', width: '6rem' },
  { label: 'Mark', width: '6rem', align: 'right' },
];

export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; assignmentId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { offeringId, assignmentId } = await params;
  const { filter: rawFilter } = await searchParams;
  const profile = await requireRole('faculty');

  const assignment = await getAssignmentForFaculty(
    profile,
    offeringId,
    assignmentId,
  );
  if (!assignment) notFound();

  const overview = await getSubmissionsForAssignment(profile, offeringId, {
    id: assignment.id,
    dueAt: assignment.dueAt,
    latePenaltyPctPerDay: assignment.latePenaltyPctPerDay,
    hideNamesWhileGrading: assignment.hideNamesWhileGrading,
    gradesReleased: assignment.gradesReleased,
  });
  if (!overview) notFound();

  const filter = (FILTERS.find((f) => f.key === rawFilter)?.key ??
    'all') as FilterKey;
  const visible = overview.rows.filter((r) => matches(r, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f.key,
      overview.rows.filter((r) => matches(r, f.key)).length,
    ]),
  ) as Record<FilterKey, number>;

  const tz = profile.timeZone;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <Link
            href={`/faculty/courses/${offeringId}/submissions`}
            className="text-ink-soft hover:text-ink text-[13px] transition-colors"
          >
            ← All assignments
          </Link>
          <h1 className="screen-title text-ink mt-2">{assignment.title}</h1>
          {/* The real counts, over exactly the rows the table renders. */}
          <p className="text-ink-soft mt-2 text-[14px]">
            {overview.counts.submitted} of {overview.counts.enrolled} submitted
            <span className="px-1.5">·</span>
            {overview.counts.graded} graded
            {overview.counts.published > 0 ? (
              <>
                <span className="px-1.5">·</span>
                {overview.counts.published} published
              </>
            ) : null}
          </p>
        </div>
      </div>

      {overview.anonymous ? (
        <div className="border-card-border bg-canvas mt-6 rounded-lg border px-4 py-3">
          <Eyebrow className="text-ink-muted">Anonymous grading</Eyebrow>
          <p className="text-ink-soft mt-1.5 text-[13px] leading-relaxed">
            Names are hidden until a mark is saved, here and in grading. Roll
            numbers are shown instead. This changes nothing that is stored.
          </p>
        </div>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            href={
              f.key === 'all'
                ? `/faculty/courses/${offeringId}/submissions/${assignmentId}`
                : `/faculty/courses/${offeringId}/submissions/${assignmentId}?filter=${f.key}`
            }
            label={f.label}
            count={counts[f.key]}
            active={f.key === filter}
          />
        ))}
      </div>

      <div className="mt-5">
        {visible.length === 0 ? (
          <EmptyState
            title="Nothing matches that filter."
            body="Try All to see everyone on the roll."
          />
        ) : (
          <DataTable columns={COLUMNS}>
            <TableGroupHeader
              title={FILTERS.find((f) => f.key === filter)?.label ?? 'All'}
              hint={
                filter === 'all'
                  ? 'Everyone enrolled, including those who have not handed in'
                  : null
              }
              count={visible.length}
              span={COLUMNS.length}
            />
            {visible.map((row) => (
              <Fragment key={row.studentId}>
                <TableRow>
                  <TableCell>
                    {/*
                      In anonymous mode an ungraded row has NO name to render —
                      it never arrived. The roll number is the identity, and it
                      is shown for every row regardless, so the column does not
                      change shape when a row is graded.
                    */}
                    <p className="text-ink text-[15px] font-semibold tracking-[-0.02em]">
                      {row.fullName ?? (
                        <span className="font-mono text-[14px]">
                          {row.rollNumber ?? '—'}
                        </span>
                      )}
                    </p>
                    {row.fullName && row.rollNumber ? (
                      <p className="text-ink-faint mt-1 font-mono text-[12px]">
                        {row.rollNumber}
                      </p>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    <StatePill tone={toneFor(row.state)}>
                      {STATE_LABEL[row.state]}
                    </StatePill>
                  </TableCell>

                  <TableCell>
                    {row.latestAttempt ? (
                      <>
                        <p className="text-ink-muted text-[13px]">
                          {formatDateTime(row.latestAttempt.submittedAt, tz)}
                        </p>
                        {/*
                          SHOWN, NEVER APPLIED. The professor types whatever
                          number they mean — see lib/submissions/penalty.ts for
                          why silently altering a mark is the wrong trade.
                        */}
                        {row.latestAttempt.isLate ? (
                          <p className="text-rust mt-1 text-[12.5px]">
                            {row.latestAttempt.penalty
                              ? penaltyLabel(row.latestAttempt.penalty)
                              : 'Late'}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      // Calm, not alarming. A student who has not handed in
                      // before the deadline is not in trouble.
                      <p className="text-ink-faint text-[13px]">—</p>
                    )}
                  </TableCell>

                  <TableCell>
                    {row.attempts.length > 0 ? (
                      <p className="text-ink-muted font-mono text-[13px] tabular-nums">
                        {row.attempts.length}
                      </p>
                    ) : (
                      <p className="text-ink-faint font-mono text-[13px]">—</p>
                    )}
                    {row.attempts.length > 1 ? (
                      <p className="text-ink-faint mt-1 text-[11.5px]">
                        resubmitted
                      </p>
                    ) : null}
                  </TableCell>

                  <TableCell align="right">
                    <p className="text-ink font-mono text-[14px] tabular-nums">
                      {row.grade !== null ? `${row.grade}` : '—'}
                    </p>
                  </TableCell>
                </TableRow>

                {/*
                  Every attempt, newest first, inline. The count is on the row
                  above so "did they resubmit" is scannable without expanding;
                  this is for when the answer is yes and the professor wants the
                  times. Late-ness is PER ATTEMPT — attempt 1 on time and
                  attempt 2 late is a real and common pair, and both are shown.
                */}
                {row.attempts.length > 1 ? (
                  <TableRow className="bg-canvas/40">
                    <TableCell className="py-2" />
                    <TableCell className="py-2" />
                    <TableCell className="py-2" colSpan={COLUMNS.length - 2}>
                      <ul className="space-y-1">
                        {row.attempts.map((a) => (
                          <li
                            key={a.attempt}
                            className="flex items-baseline gap-2 text-[12.5px]"
                          >
                            <span className="text-ink-muted font-mono">
                              #{a.attempt}
                            </span>
                            {a.attempt === row.latestAttempt?.attempt ? (
                              <span className="bg-moss-bg text-moss-deep rounded px-1.5 py-0.5 text-[11px] font-medium">
                                marked
                              </span>
                            ) : null}
                            <span className="text-ink-soft">
                              {formatDateTime(a.submittedAt, tz)}
                            </span>
                            {a.isLate ? (
                              <span className="text-rust">
                                {a.penalty ? penaltyLabel(a.penalty) : 'late'}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </DataTable>
        )}
      </div>

      <p className="text-ink-faint mt-5 text-[12.5px] leading-relaxed">
        Marking happens in the next update. This screen is read-only.
      </p>
    </div>
  );
}

function toneFor(state: SubmissionState): 'neutral' | 'course' | 'quiet' {
  if (state === 'not_submitted') return 'quiet';
  if (state === 'submitted') return 'course';
  return 'neutral';
}
