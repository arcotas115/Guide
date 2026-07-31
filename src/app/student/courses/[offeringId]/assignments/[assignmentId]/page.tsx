import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  getAssignmentForStudent,
  getOfferingForStudent,
} from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Assignment · Campus' };

export default async function StudentAssignmentPage({
  params,
}: {
  params: Promise<{ offeringId: string; assignmentId: string }>;
}) {
  const { offeringId, assignmentId } = await params;
  const profile = await requireRole('student');

  const offering = await getOfferingForStudent(profile, offeringId);
  if (!offering) notFound();

  const assignment = await getAssignmentForStudent(
    profile,
    offeringId,
    assignmentId,
  );
  // A draft returns null here — the RLS policy simply does not hand it over —
  // so a student who guesses the URL gets the same 404 as for an id that does
  // not exist. Which is the correct answer: as far as they are concerned, it
  // does not.
  if (!assignment) notFound();

  const { derived } = assignment;

  return (
    <>
      <CourseHeader
        offering={offering}
        title={assignment.title}
        backHref={`/student/courses/${offeringId}/assignments`}
        backLabel={offering.courseTitle}
      />

      <div className="mx-auto w-full max-w-md px-5 py-5">
        {/* State banner. Rust ONLY when overdue; every other state is calm. */}
        <div
          className={
            derived.isUrgent
              ? 'bg-rust-tint text-rust-deep rounded-xl px-4 py-3.5'
              : 'bg-surface border-hairline rounded-xl border px-4 py-3.5'
          }
        >
          <p
            className={
              derived.isUrgent
                ? 'text-sm font-medium'
                : 'text-ink text-sm font-medium'
            }
          >
            {derived.state === 'graded' && assignment.grade !== null
              ? `Graded · ${assignment.grade} / ${assignment.marks}`
              : derived.label}
          </p>

          {derived.state === 'submitted' && assignment.submittedAt ? (
            <p className="text-moss-deep mt-1 text-xs">
              ✓ Received {formatDateTime(assignment.submittedAt)}
            </p>
          ) : null}

          {derived.state !== 'graded' ? (
            <p
              className={`mt-1 text-xs ${derived.isUrgent ? 'text-rust-deep/80' : 'text-subtle'}`}
            >
              Due {formatDateTime(assignment.dueAt)}
              {derived.acceptingUntil
                ? ` · late work accepted till ${formatDateTime(derived.acceptingUntil)}`
                : ''}
            </p>
          ) : null}

          {/* A penalty of 0 is a value, not a missing concept — so it is stated
              rather than left out. "No late penalty" is information. */}
          {derived.acceptingUntil ? (
            <p className="text-rust-deep/80 mt-1 text-xs">
              {assignment.latePenaltyPctPerDay > 0
                ? `${assignment.latePenaltyPctPerDay}% deducted per day late.`
                : 'No late penalty.'}
            </p>
          ) : null}
        </div>

        {assignment.feedback ? (
          <section className="bg-moss-tint mt-4 rounded-xl px-4 py-3.5">
            <h2 className="text-moss-deep text-xs font-medium tracking-widest uppercase">
              Feedback
            </h2>
            <p className="text-ink-soft mt-1.5 text-sm leading-relaxed">
              {assignment.feedback}
            </p>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-subtle text-xs font-medium tracking-widest uppercase">
            What to do
          </h2>
          {assignment.instructions ? (
            <p className="text-ink-soft mt-2 text-sm leading-relaxed whitespace-pre-wrap">
              {assignment.instructions}
            </p>
          ) : (
            <p className="text-subtle mt-2 text-sm">
              Your professor has not added instructions for this one.
            </p>
          )}
        </section>

        <dl className="border-hairline divide-hairline-soft bg-surface mt-6 divide-y rounded-xl border text-sm">
          <Row label="Marks" value={String(assignment.marks)} mono />
          {assignment.opensAt ? (
            <Row label="Opened" value={formatDateTime(assignment.opensAt)} />
          ) : null}
          <Row label="Due" value={formatDateTime(assignment.dueAt)} />
          <Row label="You can submit" value={acceptedTypes(assignment)} />
        </dl>

        {/* No submission UI this session — that is the next step. Saying so
            beats a disabled button with no explanation. */}
        <p className="text-faint mt-4 px-1 text-xs leading-relaxed">
          Handing work in from your phone arrives in the next update.
        </p>
      </div>
    </>
  );
}

function acceptedTypes(a: {
  acceptFile: boolean;
  acceptLink: boolean;
  acceptText: boolean;
}): string {
  const parts = [
    a.acceptFile ? 'files' : null,
    a.acceptLink ? 'a link' : null,
    a.acceptText ? 'typed text' : null,
  ].filter(Boolean) as string[];

  if (parts.length === 0) return '—';
  if (parts.length === 1) return capitalise(parts[0]!);
  return capitalise(
    `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`,
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-subtle">{label}</dt>
      <dd className={`text-ink text-right ${mono ? 'font-mono text-[13px]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
