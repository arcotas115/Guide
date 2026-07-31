import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import {
  getAssignmentForStudent,
  getOfferingForStudent,
} from '@/lib/assignments/queries';
import { CourseHeader } from '@/components/student/course-header';
import { Card, Eyebrow } from '@/components/kit/surfaces';
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
  const tz = profile.timeZone;

  return (
    <>
      <CourseHeader
        offering={offering}
        variant="wash"
        title={assignment.title}
        backHref={`/student/courses/${offeringId}/assignments`}
        backLabel={offering.courseTitle}
      />

      <div
        className="course-scope mx-auto w-full max-w-md px-5 py-5"
        style={{ '--course-color': offering.courseColor } as React.CSSProperties}
      >
        {/* State banner. Rust ONLY when overdue; every other state is calm. */}
        <div
          className={
            derived.isUrgent
              ? 'bg-rust-bg rounded-xl px-4 py-4'
              : 'bg-card border-card-border rounded-xl border px-4 py-4'
          }
        >
          <p
            className={`text-[15.5px] font-semibold tracking-[-0.02em] ${
              derived.isUrgent ? 'text-rust-deep' : 'text-ink'
            }`}
          >
            {derived.state === 'graded' && assignment.grade !== null
              ? `Graded · ${assignment.grade} / ${assignment.marks}`
              : derived.label}
          </p>

          {derived.state === 'submitted' && assignment.submittedAt ? (
            <p className="text-moss-deep mt-1.5 text-[13.5px]">
              ✓ Received {formatDateTime(assignment.submittedAt, tz)}
            </p>
          ) : null}

          {derived.state !== 'graded' ? (
            <p
              className={`mt-1.5 text-[13.5px] leading-relaxed ${
                derived.isUrgent ? 'text-rust-deep/85' : 'text-subtle'
              }`}
            >
              Due {formatDateTime(assignment.dueAt, tz)}
              {derived.acceptingUntil
                ? ` · late work accepted till ${formatDateTime(derived.acceptingUntil, tz)}`
                : ''}
            </p>
          ) : null}

          {/* A penalty of 0 is a value, not a missing concept — so it is stated
              rather than left out. "No late penalty" is information. */}
          {derived.acceptingUntil ? (
            <p
              className={`mt-1 text-[13px] ${
                derived.isUrgent ? 'text-rust-deep/70' : 'text-subtle'
              }`}
            >
              {assignment.latePenaltyPctPerDay > 0
                ? `${assignment.latePenaltyPctPerDay}% comes off the mark for every day late.`
                : 'No late penalty.'}
            </p>
          ) : null}
        </div>

        {assignment.feedback ? (
          <section className="bg-moss-bg mt-4 rounded-xl px-4 py-4">
            <Eyebrow className="text-moss-deep/70">Feedback</Eyebrow>
            <p className="text-ink-soft mt-2 text-[14.5px] leading-relaxed">
              {assignment.feedback}
            </p>
          </section>
        ) : null}

        <section className="mt-7">
          <Eyebrow>What to do</Eyebrow>
          {assignment.instructions ? (
            <p className="text-ink-soft body-text mt-2.5 whitespace-pre-wrap">
              {assignment.instructions}
            </p>
          ) : (
            <p className="text-subtle body-text mt-2.5">
              Your professor has not added instructions for this one.
            </p>
          )}
        </section>

        <section className="mt-7">
          <Eyebrow>Marks and dates</Eyebrow>
          <Card className="mt-2.5">
            <dl className="divide-card-border divide-y text-[14px]">
              <Row label="Marks" value={String(assignment.marks)} mono />
              {assignment.opensAt ? (
                <Row
                  label="Opened"
                  value={formatDateTime(assignment.opensAt, tz)}
                />
              ) : null}
              <Row label="Due" value={formatDateTime(assignment.dueAt, tz)} />
              <Row label="You can submit" value={acceptedTypes(assignment)} />
            </dl>
          </Card>
        </section>

        {/* No submission UI this session — that is the next step. Saying so
            beats a disabled button with no explanation. */}
        <p className="text-faint mt-5 px-1 text-[12.5px] leading-relaxed">
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
      <dt className="text-subtle shrink-0">{label}</dt>
      <dd
        className={`text-ink text-right ${mono ? 'font-mono text-[13px]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
