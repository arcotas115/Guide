import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CurrentProfile } from '@/lib/auth';
import { penaltyFor, type PenaltySuggestion } from '@/lib/submissions/penalty';

/**
 * The Submissions table — SPEC.md §3.5.
 *
 * EVERY ENROLLED STUDENT APPEARS, not just the ones who submitted. That is the
 * whole point of the screen: "12 / 14 submitted" is only useful if you can see
 * WHICH two are missing. So this is a left join FROM enrolments, never a list
 * of submissions.
 */

export type SubmissionState =
  | 'not_submitted'
  | 'submitted'
  | 'graded_unpublished'
  | 'published';

export type SubmissionAttemptRow = {
  attempt: number;
  submittedAt: Date;
  /** Per attempt, derived. Attempt 1 on time and attempt 2 late are both true. */
  isLate: boolean;
  /** Stated, never applied. Null when on time or the assignment has no penalty. */
  penalty: PenaltySuggestion | null;
};

export type SubmissionRow = {
  studentId: string;
  /**
   * NULL when the assignment is in anonymous mode and this row is not yet
   * graded. Not "hidden in the UI" — absent from the object. See the note on
   * getSubmissionsForAssignment.
   */
  fullName: string | null;
  rollNumber: string | null;
  state: SubmissionState;
  attempts: SubmissionAttemptRow[];
  latestAttempt: SubmissionAttemptRow | null;
  grade: number | null;
};

export type SubmissionsOverview = {
  rows: SubmissionRow[];
  /** Real counts, over the same rows the table renders. */
  counts: {
    enrolled: number;
    submitted: number;
    graded: number;
    published: number;
    notSubmitted: number;
  };
  anonymous: boolean;
};

type EnrolmentRow = {
  student_id: string;
  profiles: { full_name: string; roll_number: string | null } | null;
};

type SubmissionQueryRow = {
  id: string;
  student_id: string | null;
  submission_attempts: Array<{ attempt: number; submitted_at: string }> | null;
  submission_grades: { grade: string | number } | null;
};

/**
 * TWO QUERIES, joined in TypeScript — and that is not an N+1.
 *
 * PostgREST cannot express a LEFT JOIN from enrolments to submissions, and the
 * alternative is a database function, which this session is not adding. So:
 * one query for the roll, one for the submissions, joined by student id. Two
 * round trips for a class of any size — thirteen students or three hundred.
 *
 * ANONYMOUS MODE IS APPLIED HERE, not in the component.
 *
 * SPEC §3.7 describes hide_names_while_grading as a SpeedGrader behaviour, but
 * it has to bind to this table as well: a professor who can read the names here
 * simply reads them here first, and the anonymity in SpeedGrader is theatre.
 * So the name is dropped from the object before it leaves this function —
 * `fullName` is genuinely null, not merely unrendered, and nothing downstream
 * can leak what it never received.
 *
 * WHAT THIS IS AND IS NOT. It stops the grading surfaces handing a professor a
 * name they asked not to see. It does not make the name unobtainable — the same
 * professor can open the Roster, and should be able to. Anonymity here is
 * INTEGRITY, not secrecy, and no database mechanism could make it secrecy while
 * a roster exists. Worth being plain about rather than overclaiming.
 */
export async function getSubmissionsForAssignment(
  profile: CurrentProfile,
  offeringId: string,
  assignment: {
    id: string;
    dueAt: Date;
    latePenaltyPctPerDay: number;
    hideNamesWhileGrading: boolean;
    gradesReleased: boolean;
  },
): Promise<SubmissionsOverview | null> {
  const supabase = await createClient();

  // The roll. RLS on enrolments admits these only to staff who teach the
  // offering (or an admin in the institution), so a professor who does not
  // teach it gets an empty list rather than a filtered one.
  const [{ data: enrolments, error: enrolError }, { data: submissions }] =
    await Promise.all([
      supabase
        .from('enrolments')
        .select('student_id, profiles ( full_name, roll_number )')
        .eq('institution_id', profile.institutionId)
        .eq('offering_id', offeringId),
      supabase
        .from('submissions')
        .select(
          `id, student_id,
           submission_attempts ( attempt, submitted_at ),
           submission_grades ( grade )`,
        )
        .eq('institution_id', profile.institutionId)
        .eq('assignment_id', assignment.id),
    ]);

  if (enrolError || !enrolments) return null;

  const byStudent = new Map<string, SubmissionQueryRow>();
  for (const s of (submissions ?? []) as unknown as SubmissionQueryRow[]) {
    if (s.student_id) byStudent.set(s.student_id, s);
  }

  const rows: SubmissionRow[] = (enrolments as unknown as EnrolmentRow[])
    .map((e) => {
      const person = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
      const sub = byStudent.get(e.student_id) ?? null;

      const attempts: SubmissionAttemptRow[] = (sub?.submission_attempts ?? [])
        // Newest first, and by attempt NUMBER rather than timestamp: the number
        // is a total order by construction (unique per submission), whereas two
        // timestamps can tie. That is what makes ordering stable across reloads.
        .slice()
        .sort((a, b) => b.attempt - a.attempt)
        .map((a) => {
          const submittedAt = new Date(a.submitted_at);
          return {
            attempt: a.attempt,
            submittedAt,
            isLate: submittedAt > assignment.dueAt,
            penalty: penaltyFor(
              submittedAt,
              assignment.dueAt,
              assignment.latePenaltyPctPerDay,
            ),
          };
        });

      const gradeRow = Array.isArray(sub?.submission_grades)
        ? sub?.submission_grades[0]
        : sub?.submission_grades;
      const grade = gradeRow ? Number(gradeRow.grade) : null;

      const state: SubmissionState =
        attempts.length === 0
          ? 'not_submitted'
          : grade === null
            ? 'submitted'
            : assignment.gradesReleased
              ? 'published'
              : 'graded_unpublished';

      const isGraded = grade !== null;

      return {
        studentId: e.student_id,
        // The redaction. An ungraded row in anonymous mode carries no name at
        // all; a graded one does, because the mark is already committed and
        // there is nothing left to bias.
        fullName:
          assignment.hideNamesWhileGrading && !isGraded
            ? null
            : (person?.full_name ?? null),
        rollNumber: person?.roll_number ?? null,
        state,
        attempts,
        latestAttempt: attempts[0] ?? null,
        grade,
      };
    })
    .sort(sortRows);

  return {
    rows,
    counts: {
      enrolled: rows.length,
      submitted: rows.filter((r) => r.state !== 'not_submitted').length,
      graded: rows.filter(
        (r) => r.state === 'graded_unpublished' || r.state === 'published',
      ).length,
      published: rows.filter((r) => r.state === 'published').length,
      notSubmitted: rows.filter((r) => r.state === 'not_submitted').length,
    },
    anonymous: assignment.hideNamesWhileGrading,
  };
}

/**
 * Roll number order, always — including when names are visible.
 *
 * Sorting by name would reorder the table the moment a row is graded in
 * anonymous mode, because that row gains a name. A roll number is present for
 * every student either way, so the order is stable through grading.
 */
function sortRows(a: SubmissionRow, b: SubmissionRow): number {
  return (a.rollNumber ?? '').localeCompare(b.rollNumber ?? '');
}
