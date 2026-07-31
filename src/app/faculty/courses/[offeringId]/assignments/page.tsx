import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  listAssignmentsForFaculty,
  type FacultyAssignment,
} from '@/lib/assignments/queries';
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
 * The filter lives in the URL rather than in client state. It costs nothing, it
 * survives a refresh, and a professor can send "look at the drafts" as a link.
 */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'to-grade', label: 'To grade' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'drafts', label: 'Drafts' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function matches(a: FacultyAssignment, filter: FilterKey, now: Date): boolean {
  switch (filter) {
    case 'open':
      return a.status === 'open';
    case 'closed':
      return a.status === 'closed';
    case 'drafts':
      return a.status === 'draft';
    // "To grade" is anything students can no longer add to but whose marks have
    // not gone out. Once submissions exist (1B) this gains a count; the
    // definition does not change.
    case 'to-grade':
      return (
        a.status !== 'draft' &&
        !a.gradesReleased &&
        (a.status === 'closed' || a.dueAt < now)
      );
    default:
      return true;
  }
}

const COLUMNS: Column[] = [
  { label: 'Assignment' },
  { label: 'State', width: '9rem' },
  { label: 'Submitted', width: '8rem' },
  { label: 'Grading', width: '9rem' },
  { label: '', width: '7rem', align: 'right' },
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
  const visible = all.filter((a) => matches(a, filter, now));

  // Every chip carries its own count, computed over ALL assignments — a count
  // that changed with the active filter would be useless.
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.key, all.filter((a) => matches(a, f.key, now)).length]),
  ) as Record<FilterKey, number>;

  // Groups follow the prototype. An assignment appears in exactly one.
  const groups = [
    {
      title: 'Waiting on you',
      hint: 'Open to students, or past due and not yet marked',
      items: visible.filter((a) => a.status === 'open'),
    },
    {
      title: 'Closed and marked',
      hint: null,
      items: visible.filter((a) => a.status === 'closed'),
    },
    {
      title: 'Drafts',
      hint: 'Only you can see these',
      items: visible.filter((a) => a.status === 'draft'),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="screen-title text-ink">Assignments</h1>
          <p className="text-subtle mt-2 text-[14px]">
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
            <span className="text-faint ml-auto text-[12.5px]">
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
                  <Fragment key={group.title}>
                    <TableGroupHeader
                      title={group.title}
                      hint={group.hint}
                      count={group.items.length}
                      span={COLUMNS.length}
                    />
                    {group.items.map((a) => (
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
                          <p className="text-subtle mt-1 text-[12.5px]">
                            {subtitle(a, now)}
                          </p>
                          {/*
                            The prototype renders this badge in rust. It is not
                            rendered in rust here, deliberately: DESIGN.md §5
                            reserves rust for overdue work, attendance below
                            threshold and incomplete admin setup, and a penalty
                            rule is none of those — it is a property of an
                            assignment that is otherwise perfectly healthy.
                            Putting rust on it would mean most rows in a normal
                            course carry the attention colour, which is exactly
                            how the signal dies. Raised with the spec.
                          */}
                          {a.allowLate && a.latePenaltyPctPerDay > 0 ? (
                            <span className="bg-canvas border-card-border text-ink-muted mt-2 inline-block rounded-md border px-2 py-0.5 text-[11.5px] font-medium">
                              {a.latePenaltyPctPerDay}% a day late
                            </span>
                          ) : null}
                        </TableCell>

                        <TableCell>
                          <StatePill
                            tone={a.status === 'open' ? 'course' : a.status === 'draft' ? 'quiet' : 'neutral'}
                          >
                            {a.status === 'open'
                              ? 'Open'
                              : a.status === 'closed'
                                ? 'Closed'
                                : 'Draft'}
                          </StatePill>
                        </TableCell>

                        {/* Submissions land in 1B. An em-dash says "not yet
                            counted"; a 0 would say "nobody has submitted",
                            which is a different and currently unknowable
                            claim. */}
                        <TableCell>
                          <p className="text-faint font-mono text-[13px]">—</p>
                          <p className="text-faint mt-1 text-[12px]">
                            {a.status === 'draft' ? 'Not open yet' : 'submitted'}
                          </p>
                        </TableCell>

                        <TableCell>
                          <p className="text-faint font-mono text-[13px]">
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
                    ))}
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

/** The professor's view of state: the assignment's own lifecycle, not a
 *  student's derived one. They are different questions about the same row. */
function subtitle(a: FacultyAssignment, now: Date): string {
  const marks = `${a.marks} marks`;
  const sep = ' · ';

  if (a.status === 'draft') {
    return a.opensAt
      ? `Opens ${formatDay(a.opensAt, now)}${sep}${marks}`
      : `Not scheduled${sep}${marks}`;
  }
  if (a.status === 'closed') return `Closed${sep}${marks}`;
  if (a.opensAt && a.opensAt > now) {
    return `Opens ${formatDay(a.opensAt, now)}${sep}${marks}`;
  }
  if (a.allowLate && a.lateUntil && a.lateUntil > now) {
    return `Due ${formatDay(a.dueAt, now)}${sep}late accepted till ${formatDay(a.lateUntil, now)}${sep}${marks}`;
  }
  return `Due ${formatDay(a.dueAt, now)}${sep}${marks}`;
}
