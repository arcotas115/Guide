import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import {
  listAssignmentsForFaculty,
  type FacultyAssignment,
} from '@/lib/assignments/queries';
import { formatDateTime } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';

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
        a.status !== 'draft' && !a.gradesReleased && (a.status === 'closed' || a.dueAt < now)
      );
    default:
      return true;
  }
}

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

  // Groups follow the prototype. An assignment appears in exactly one.
  const groups = [
    {
      title: 'Waiting on you',
      hint: 'Open to students, or past due and not yet marked.',
      items: visible.filter((a) => a.status === 'open'),
    },
    {
      title: 'Closed and marked',
      hint: null,
      items: visible.filter((a) => a.status === 'closed'),
    },
    {
      title: 'Drafts',
      hint: 'Only you can see these.',
      items: visible.filter((a) => a.status === 'draft'),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            Assignments
          </h1>
          <p className="text-subtle mt-1 text-sm">
            {all.length === 0
              ? 'Nothing set yet.'
              : `${all.length} in this course.`}
          </p>
        </div>
        <Link
          href={`/faculty/courses/${offeringId}/assignments/new`}
          className={buttonVariants()}
        >
          New assignment
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.key === filter;
          return (
            <Link
              key={f.key}
              href={
                f.key === 'all'
                  ? `/faculty/courses/${offeringId}/assignments`
                  : `/faculty/courses/${offeringId}/assignments?filter=${f.key}`
              }
              aria-current={isActive ? 'true' : undefined}
              className={
                isActive
                  ? 'bg-ink text-canvas rounded-full px-3.5 py-1.5 text-xs font-medium'
                  : 'text-ink-muted border-hairline hover:border-subtle rounded-full border px-3.5 py-1.5 text-xs transition-colors'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {all.length === 0 ? (
        <EmptyState offeringId={offeringId} />
      ) : visible.length === 0 ? (
        <p className="text-subtle border-hairline mt-8 rounded-xl border border-dashed px-5 py-10 text-center text-sm">
          Nothing matches that filter.
        </p>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.map((group) => (
            <section key={group.title}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-ink-muted text-xs font-medium tracking-widest uppercase">
                  {group.title}
                </h2>
                <span className="text-faint font-mono text-xs">
                  {group.items.length}
                </span>
              </div>
              {group.hint ? (
                <p className="text-faint mt-1 text-xs">{group.hint}</p>
              ) : null}

              <table className="mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="text-faint border-hairline border-b text-left text-xs font-normal">
                    <th className="py-2 pr-4 font-normal">Assignment</th>
                    <th className="w-40 py-2 pr-4 font-normal">State</th>
                    <th className="w-28 py-2 pr-4 font-normal">Submitted</th>
                    <th className="w-32 py-2 font-normal">Grading</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((a) => (
                    <tr
                      key={a.id}
                      className="border-hairline-soft hover:bg-hairline-soft/50 border-b transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <Link
                          href={`/faculty/courses/${offeringId}/assignments/${a.id}/edit`}
                          className="text-ink font-medium hover:underline"
                        >
                          {a.title}
                        </Link>
                        <span className="text-faint ml-2 font-mono text-xs">
                          {a.marks} marks
                        </span>
                      </td>
                      <td className="text-ink-muted py-3 pr-4 text-xs">
                        {facultyStateLabel(a, now)}
                      </td>
                      {/* Submissions land in 1B. An em-dash says "not yet
                          counted"; a 0 would say "nobody has submitted", which
                          is a different and currently unknowable claim. */}
                      <td className="text-faint py-3 pr-4 font-mono text-xs">
                        —
                      </td>
                      <td className="text-faint py-3 font-mono text-xs">
                        {a.gradesReleased ? 'Published' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** The professor's view of state: the assignment's own lifecycle, not a
 *  student's derived one. They are different questions about the same row. */
function facultyStateLabel(a: FacultyAssignment, now: Date): string {
  if (a.status === 'draft') return 'Draft';
  if (a.status === 'closed') return 'Closed';
  if (a.opensAt && a.opensAt > now) return `Opens ${formatDateTime(a.opensAt, now)}`;
  if (a.dueAt < now) {
    return a.allowLate && a.lateUntil && a.lateUntil > now
      ? `Past due · late till ${formatDateTime(a.lateUntil, now)}`
      : 'Past due';
  }
  return `Due ${formatDateTime(a.dueAt, now)}`;
}

function EmptyState({ offeringId }: { offeringId: string }) {
  return (
    <div className="border-hairline bg-surface mt-8 rounded-xl border px-6 py-14 text-center">
      <p className="text-ink text-base font-medium">
        No assignments in this course yet.
      </p>
      <p className="text-subtle mx-auto mt-2 max-w-sm text-sm leading-relaxed">
        Set one up and it appears on your students&rsquo; phones the moment you
        publish. Save it as a draft first if you would rather finish the wording
        later — drafts stay invisible to them.
      </p>
      <Link
        href={`/faculty/courses/${offeringId}/assignments/new`}
        className={`${buttonVariants()} mt-6`}
      >
        Create the first one
      </Link>
    </div>
  );
}
