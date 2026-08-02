import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  listAssignmentsForFaculty,
  getSubmissionCounts,
  type FacultyAssignment,
} from '@/lib/assignments/queries';
import {
  deriveForFaculty,
  facultyGroupFor,
  type FacultyGroup,
} from '@/lib/assignments/state';
import { formatDay } from '@/lib/format';
import { ButtonLink } from '@/components/kit/button';
import { FilterChip } from '@/components/kit/filter-chip';
import {
  DataTable,
  TableGroupHeader,
  TableRow,
  TableCell,
  StatePill,
  type Column,
} from '@/components/kit/data-table';
import { EmptyState } from '@/components/kit/surfaces';

export const metadata: Metadata = { title: 'Assignments · Campus' };

/**
 * The workspace lands here — there is no overview dashboard (SPEC.md §3.5).
 *
 * Grouping and filtering both run off `facultyGroupFor`, which derives state
 * through the same function the student side uses. Nothing here reads `status`
 * to decide where a row belongs.
 *
 * The filter lives in the URL rather than in client state. It costs nothing, it
 * survives a refresh, and a professor can send "look at the drafts" as a link.
 */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'to-grade', label: 'To grade' },
  { key: 'open', label: 'Open' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'closed', label: 'Closed' },
  { key: 'drafts', label: 'Drafts' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function matches(a: FacultyAssignment, filter: FilterKey, now: Date): boolean {
  const group = facultyGroupFor(a, now);

  switch (filter) {
    case 'open':
      return group === 'waiting';
    case 'scheduled':
      return group === 'scheduled';
    case 'closed':
      return group === 'closed';
    case 'drafts':
      return group === 'draft';
    // Anything students can no longer add to, whose marks have not gone out.
    case 'to-grade':
      return (
        group !== 'draft' &&
        group !== 'scheduled' &&
        !a.gradesReleased &&
        (group === 'closed' || a.dueAt < now)
      );
    default:
      return true;
  }
}

const GROUPS: Array<{ key: FacultyGroup; title: string; hint: string | null }> =
  [
    {
      key: 'waiting',
      title: 'Waiting on you',
      hint: 'Open to students, or past due and not yet marked',
    },
    {
      key: 'scheduled',
      title: 'Scheduled',
      hint: 'Published, but not open to students yet',
    },
    { key: 'closed', title: 'Closed and marked', hint: null },
    { key: 'draft', title: 'Drafts', hint: 'Only you can see these' },
  ];

const COLUMNS: Column[] = [
  { label: 'Assignment' },
  { label: 'State', width: '9rem' },
  { label: 'Submitted', width: '8rem' },
  { label: 'Grading', width: '9rem' },
  { label: '', width: '6rem', align: 'right' },
];

export default async function FacultyAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { offeringId } = await params;
  const { filter: rawFilter } = await searchParams;
  const profile = await requireRole('faculty');

  const filter = (FILTERS.find((f) => f.key === rawFilter)?.key ??
    'all') as FilterKey;

  const now = new Date();
  const all = await listAssignmentsForFaculty(profile, offeringId);
  const { byAssignment, enrolled } = await getSubmissionCounts(
    profile,
    offeringId,
    all.map((a) => a.id),
  );

  const visible = all.filter((a) => matches(a, filter, now));
  const tz = profile.timeZone;

  // Every chip carries its own count, computed over ALL assignments — a count
  // that changed with the active filter would be useless.
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f.key,
      all.filter((a) => matches(a, f.key, now)).length,
    ]),
  ) as Record<FilterKey, number>;

  const groups = GROUPS.map((g) => ({
    ...g,
    items: visible.filter((a) => facultyGroupFor(a, now) === g.key),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="screen-title text-ink">Assignments</h1>
          <p className="text-ink-soft mt-2 text-[14px]">
            {all.length === 0
              ? 'Nothing set yet.'
              : `${all.length} in this course`}
          </p>
        </div>
        <ButtonLink
          href={`/faculty/courses/${offeringId}/assignments/new`}
          size="lg"
        >
          New assignment
        </ButtonLink>
      </div>

      {all.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No assignments in this course yet."
            body="Set one up and it appears on your students' phones the moment you publish. Save it as a draft first if you would rather finish the wording later — drafts stay invisible to them."
            action={
              <ButtonLink
                href={`/faculty/courses/${offeringId}/assignments/new`}
              >
                Create the first one
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                href={
                  f.key === 'all'
                    ? `/faculty/courses/${offeringId}/assignments`
                    : `/faculty/courses/${offeringId}/assignments?filter=${f.key}`
                }
                label={f.label}
                count={counts[f.key]}
                active={f.key === filter}
              />
            ))}
            <span className="text-ink-faint ml-auto text-[12.5px]">
              {all.length} total
              <span className="px-1.5">·</span>
              showing {visible.length}
            </span>
          </div>

          <div className="mt-5">
            {visible.length === 0 ? (
              <EmptyState
                title="Nothing matches that filter."
                body="Try All to see everything in this course."
              />
            ) : (
              // ONE table for every group. See data-table.tsx for why this is
              // not one table per group.
              <DataTable columns={COLUMNS}>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <TableGroupHeader
                      title={group.title}
                      hint={group.hint}
                      count={group.items.length}
                      span={COLUMNS.length}
                    />
                    {group.items.map((a) => {
                      const submitted = byAssignment.get(a.id) ?? 0;
                      const notOpenYet = facultyGroupFor(a, now) !== 'waiting';

                      return (
                        <TableRow key={a.id}>
                          <TableCell>
                            <Link
                              href={`/faculty/courses/${offeringId}/assignments/${a.id}/edit`}
                              className="text-ink text-[15px] font-semibold tracking-[-0.02em] hover:underline"
                            >
                              {a.title}
                            </Link>
                            {/* Separate line, explicit separators — never
                                `Page replacement15 marks`. */}
                            <p className="text-ink-soft mt-1 text-[12.5px]">
                              {subtitle(a, now, tz)}
                            </p>
                            {/*
                              The prototype renders this badge in rust. It is
                              not rendered in rust here, deliberately:
                              DESIGN.md §5 reserves rust for overdue work,
                              attendance below threshold and incomplete admin
                              setup, and a penalty rule is none of those — it
                              is a property of an assignment that is otherwise
                              perfectly healthy. Putting rust on it would mean
                              most rows in a normal course carry the attention
                              colour, which is how the signal dies.
                            */}
                            {a.allowLate && a.latePenaltyPctPerDay > 0 ? (
                              <span className="bg-canvas border-card-border text-ink-muted mt-2 inline-block rounded-md border px-2 py-0.5 text-[11.5px] font-medium">
                                {a.latePenaltyPctPerDay}% a day late
                              </span>
                            ) : null}
                          </TableCell>

                          <TableCell>
                            <StatePill tone={pillTone(a, now)}>
                              {pillLabel(a, now, tz)}
                            </StatePill>
                          </TableCell>

                          {/*
                            A real count now that submissions exist. The
                            em-dash survives only where a count genuinely
                            cannot be known — nothing can have been submitted
                            to an assignment students cannot open yet.
                          */}
                          <TableCell>
                            {notOpenYet ? (
                              <>
                                <p className="text-ink-faint font-mono text-[13px]">
                                  —
                                </p>
                                <p className="text-ink-faint mt-1 text-[12px]">
                                  Not open yet
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-ink font-mono text-[13px] tabular-nums">
                                  {submitted}
                                  <span className="text-ink-faint px-1">/</span>
                                  {enrolled}
                                </p>
                                <p className="text-ink-faint mt-1 text-[12px]">
                                  submitted
                                </p>
                              </>
                            )}
                          </TableCell>

                          <TableCell>
                            <p className="text-ink-faint font-mono text-[13px]">
                              {a.gradesReleased ? 'Published' : '—'}
                            </p>
                          </TableCell>

                          <TableCell align="right">
                            <Link
                              href={`/faculty/courses/${offeringId}/assignments/${a.id}/edit`}
                              className="text-ink-muted hover:text-ink text-[13px] underline underline-offset-4 transition-colors"
                            >
                              {a.status === 'draft' ? 'Edit draft' : 'Edit'}
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
              </DataTable>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function pillLabel(a: FacultyAssignment, now: Date, tz: string): string {
  const group = facultyGroupFor(a, now);
  if (group === 'draft') return 'Draft';
  if (group === 'closed') return 'Closed';
  if (group === 'scheduled') return 'Scheduled';
  return deriveForFaculty(a, now, tz).state === 'overdue' ? 'Past due' : 'Open';
}

function pillTone(
  a: FacultyAssignment,
  now: Date,
): 'neutral' | 'course' | 'quiet' {
  const group = facultyGroupFor(a, now);
  if (group === 'draft' || group === 'scheduled') return 'quiet';
  if (group === 'closed') return 'neutral';
  return 'course';
}

/** The one-line summary under the title. Explicit separators throughout. */
function subtitle(a: FacultyAssignment, now: Date, tz: string): string {
  const sep = ' · ';
  const marks = `${a.marks} marks`;
  const group = facultyGroupFor(a, now);

  if (group === 'draft') {
    return a.opensAt
      ? `Opens ${formatDay(a.opensAt, tz, now)}${sep}${marks}`
      : `Not scheduled${sep}${marks}`;
  }
  if (group === 'scheduled' && a.opensAt) {
    return `Opens ${formatDay(a.opensAt, tz, now)}${sep}due ${formatDay(a.dueAt, tz, now)}${sep}${marks}`;
  }
  if (group === 'closed') return `Closed${sep}${marks}`;
  if (a.allowLate && a.lateUntil && a.lateUntil > now) {
    return `Due ${formatDay(a.dueAt, tz, now)}${sep}late accepted till ${formatDay(a.lateUntil, tz, now)}${sep}${marks}`;
  }
  return `Due ${formatDay(a.dueAt, tz, now)}${sep}${marks}`;
}
