import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CurrentProfile } from '@/lib/auth';
import {
  deriveAssignmentState,
  type DerivedState,
  type AssignmentStateInput,
} from '@/lib/assignments/state';
import { live, type DeletedOption } from '@/lib/soft-delete';

/**
 * Reads for the assignment screens.
 *
 * TENANCY. Every query below filters on institution_id explicitly even though
 * RLS already would. That is not superstition: RLS is the guarantee, but a
 * query that only works because a policy saved it is a query nobody can read
 * and reason about, and it silently becomes a cross-tenant query the day
 * somebody runs it with the service-role key (a seed, a migration, a cron job)
 * where no policy applies. The filter states the intent; the policy enforces it.
 */

export type OfferingSummary = {
  offeringId: string;
  section: string;
  courseCode: string;
  courseTitle: string;
  courseColor: string;
  credits: number;
  termName: string;
};

export type FacultyAssignment = {
  id: string;
  title: string;
  instructions: string | null;
  marks: number;
  opensAt: Date | null;
  dueAt: Date;
  allowLate: boolean;
  lateUntil: Date | null;
  latePenaltyPctPerDay: number;
  hideNamesWhileGrading: boolean;
  acceptFile: boolean;
  acceptLink: boolean;
  acceptText: boolean;
  allowMultipleAttempts: boolean;
  status: 'draft' | 'open' | 'closed';
  gradesReleased: boolean;
};

export type StudentAssignment = FacultyAssignment & {
  derived: DerivedState;
  submittedAt: Date | null;
  grade: number | null;
  feedback: string | null;
};

const OFFERING_SELECT = `
  id, section, deleted_at,
  courses ( code, title, color, credits, deleted_at ),
  terms ( name )
` as const;

const ASSIGNMENT_COLUMNS = `
  id, title, instructions, marks, opens_at, due_at, allow_late, late_until,
  late_penalty_pct_per_day, hide_names_while_grading,
  accept_file, accept_link, accept_text, allow_multiple_attempts,
  status, grades_released
` as const;

/** PostgREST returns an embedded to-one as an object or a single-element array
 *  depending on how it infers the relationship. Normalise both. */
function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Pull the embedded offering out of a join row.
 *
 * Takes `unknown` deliberately. Without generated database types, the client
 * infers embedded relations as arrays of `any`-shaped objects, and asserting
 * across that mismatch needs a double cast at every call site. One narrow,
 * commented conversion here beats four scattered ones.
 */
function embeddedOffering(row: unknown): OfferingRow | null {
  const r = row as { course_offerings: OfferingRow | OfferingRow[] | null };
  return one(r.course_offerings);
}

type OfferingRow = {
  id: string;
  section: string;
  deleted_at: string | null;
  courses: {
    code: string;
    title: string;
    color: string;
    credits: number;
    deleted_at: string | null;
  } | null;
  terms: { name: string } | null;
};

/**
 * An offering is only live if BOTH it and its course are. Deleting a course
 * should take its offerings out of view without needing a second write, and
 * without leaving an offering that renders a title it can no longer resolve.
 */
function toOfferingSummary(
  row: OfferingRow,
  options: DeletedOption = {},
): OfferingSummary | null {
  const course = one(row.courses);
  const term = one(row.terms);
  if (!course) return null;
  if (!options.includeDeleted && (row.deleted_at || course.deleted_at)) {
    return null;
  }
  return {
    offeringId: row.id,
    section: row.section,
    courseCode: course.code,
    courseTitle: course.title,
    // Config-as-data: the identity colour is a column, never a constant keyed
    // off the course code.
    courseColor: course.color,
    credits: course.credits,
    termName: term?.name ?? '',
  };
}

type AssignmentRow = {
  id: string;
  title: string;
  instructions: string | null;
  marks: string | number;
  opens_at: string | null;
  due_at: string;
  allow_late: boolean;
  late_until: string | null;
  late_penalty_pct_per_day: string | number;
  hide_names_while_grading: boolean;
  accept_file: boolean;
  accept_link: boolean;
  accept_text: boolean;
  allow_multiple_attempts: boolean;
  status: 'draft' | 'open' | 'closed';
  grades_released: boolean;
};

// numeric columns arrive from PostgREST as strings — Number() them once, here,
// rather than in every component that shows a mark.
function toAssignment(row: AssignmentRow): FacultyAssignment {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    marks: Number(row.marks),
    opensAt: toDate(row.opens_at),
    dueAt: new Date(row.due_at),
    allowLate: row.allow_late,
    lateUntil: toDate(row.late_until),
    latePenaltyPctPerDay: Number(row.late_penalty_pct_per_day),
    hideNamesWhileGrading: row.hide_names_while_grading,
    acceptFile: row.accept_file,
    acceptLink: row.accept_link,
    acceptText: row.accept_text,
    allowMultipleAttempts: row.allow_multiple_attempts,
    status: row.status,
    gradesReleased: row.grades_released,
  };
}

// ---------------------------------------------------------------------------
// Faculty
// ---------------------------------------------------------------------------

/** The offerings this professor teaches, this term and every other. */
export async function listOfferingsForFaculty(
  profile: CurrentProfile,
): Promise<OfferingSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('teaching_assignments')
    .select(`course_offerings ( ${OFFERING_SELECT} )`)
    .eq('institution_id', profile.institutionId)
    .eq('faculty_id', profile.id);

  if (error || !data) return [];

  return data
    .map(embeddedOffering)
    .filter((r): r is OfferingRow => r !== null)
    .map((r) => toOfferingSummary(r))
    .filter((r): r is OfferingSummary => r !== null)
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/**
 * An offering, but only if this professor teaches it.
 *
 * Returns null rather than throwing so callers can notFound(). The
 * teaching_assignments check is what turns "wrong id in the URL" into a 404
 * instead of someone else's course workspace — RLS would refuse the writes
 * anyway, but a professor should never see another's roster at all.
 */
export async function getOfferingForFaculty(
  profile: CurrentProfile,
  offeringId: string,
): Promise<OfferingSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('teaching_assignments')
    .select(`course_offerings ( ${OFFERING_SELECT} )`)
    .eq('institution_id', profile.institutionId)
    .eq('faculty_id', profile.id)
    .eq('offering_id', offeringId)
    .maybeSingle();

  if (error || !data) return null;
  const offering = embeddedOffering(data);
  return offering ? toOfferingSummary(offering) : null;
}

/** Every assignment in the offering, drafts included — this is the author's view. */
export async function listAssignmentsForFaculty(
  profile: CurrentProfile,
  offeringId: string,
  options: DeletedOption = {},
): Promise<FacultyAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await live(
    supabase
      .from('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('institution_id', profile.institutionId)
      .eq('offering_id', offeringId),
    options,
  ).order('due_at', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as AssignmentRow[]).map(toAssignment);
}

/**
 * How many submissions each assignment in this offering has, and how many
 * students are enrolled — the numerator and denominator of "12 / 14".
 *
 * WHY THIS COUNTS IN JAVASCRIPT rather than with a Postgres aggregate: the
 * embedded-aggregate syntax (`submissions(count)`) depends on the PostgREST
 * version the project happens to be running, and a silent shape change there
 * would put a wrong number in front of a professor. Fetching the id column and
 * counting is version-proof, and the volume is one row per submission in one
 * course — a few hundred at most, over an indexed column.
 *
 * If a course ever gets large enough for that to matter, this becomes an RPC
 * with a GROUP BY; the call site does not change.
 *
 * RLS does the scoping: a professor sees submissions only for offerings they
 * teach, so this cannot count another course's work even if the id list were
 * wrong.
 */
export async function getSubmissionCounts(
  profile: CurrentProfile,
  offeringId: string,
  assignmentIds: string[],
): Promise<{ byAssignment: Map<string, number>; enrolled: number }> {
  const supabase = await createClient();

  const [subs, enrolled] = await Promise.all([
    assignmentIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('submissions')
          .select('assignment_id')
          .eq('institution_id', profile.institutionId)
          .in('assignment_id', assignmentIds),
    supabase
      .from('enrolments')
      .select('student_id', { count: 'exact', head: true })
      .eq('institution_id', profile.institutionId)
      .eq('offering_id', offeringId),
  ]);

  const byAssignment = new Map<string, number>();
  if (!subs.error && subs.data) {
    for (const row of subs.data as Array<{ assignment_id: string }>) {
      byAssignment.set(
        row.assignment_id,
        (byAssignment.get(row.assignment_id) ?? 0) + 1,
      );
    }
  }

  return { byAssignment, enrolled: enrolled.count ?? 0 };
}

export async function getAssignmentForFaculty(
  profile: CurrentProfile,
  offeringId: string,
  assignmentId: string,
  options: DeletedOption = {},
): Promise<FacultyAssignment | null> {
  const supabase = await createClient();
  const { data, error } = await live(
    supabase
      .from('assignments')
      .select(ASSIGNMENT_COLUMNS)
      .eq('institution_id', profile.institutionId)
      .eq('offering_id', offeringId)
      .eq('id', assignmentId),
    options,
  ).maybeSingle();

  if (error || !data) return null;
  return toAssignment(data as unknown as AssignmentRow);
}

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

export async function listOfferingsForStudent(
  profile: CurrentProfile,
): Promise<OfferingSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrolments')
    .select(`course_offerings ( ${OFFERING_SELECT} )`)
    .eq('institution_id', profile.institutionId)
    .eq('student_id', profile.id);

  if (error || !data) return [];

  return data
    .map(embeddedOffering)
    .filter((r): r is OfferingRow => r !== null)
    .map((r) => toOfferingSummary(r))
    .filter((r): r is OfferingSummary => r !== null)
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

export async function getOfferingForStudent(
  profile: CurrentProfile,
  offeringId: string,
): Promise<OfferingSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('enrolments')
    .select(`course_offerings ( ${OFFERING_SELECT} )`)
    .eq('institution_id', profile.institutionId)
    .eq('student_id', profile.id)
    .eq('offering_id', offeringId)
    .maybeSingle();

  if (error || !data) return null;
  const offering = embeddedOffering(data);
  return offering ? toOfferingSummary(offering) : null;
}

type StudentAssignmentRow = AssignmentRow & {
  submissions:
    | Array<{
        submitted_at: string;
        submission_grades:
          | Array<{ grade: string | number; feedback: string | null }>
          | { grade: string | number; feedback: string | null }
          | null;
      }>
    | null;
};

/**
 * The student's assignments for one offering, each with its derived state.
 *
 * TWO RLS POLICIES DO THE HARD WORK HERE, and neither is re-implemented:
 *   - `assignments`: a draft is not returned at all. The list below never has
 *     to filter for it, and could not leak one if it tried.
 *   - `submission_grades`: a grade row is only returned once the assignment's
 *     grades_released is true. So `hasVisibleGrade` below is exactly right by
 *     construction — an unpublished mark never reaches this process.
 * The embedded `submissions` likewise comes back scoped to this student.
 */
export async function listAssignmentsForStudent(
  profile: CurrentProfile,
  offeringId: string,
  now: Date = new Date(),
): Promise<StudentAssignment[]> {
  const supabase = await createClient();
  // RLS already hides deleted assignments from a student; live() is what keeps
  // the same call honest when a member of staff runs it.
  const { data, error } = await live(
    supabase
      .from('assignments')
      .select(
        `${ASSIGNMENT_COLUMNS}, submissions ( submitted_at, submission_grades ( grade, feedback ) )`,
      )
      .eq('institution_id', profile.institutionId)
      .eq('offering_id', offeringId),
  ).order('due_at', { ascending: true });

  if (error || !data) return [];
  return (data as unknown as StudentAssignmentRow[]).map((row) =>
    toStudentAssignment(row, now, profile.timeZone),
  );
}

export async function getAssignmentForStudent(
  profile: CurrentProfile,
  offeringId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<StudentAssignment | null> {
  const supabase = await createClient();
  const { data, error } = await live(
    supabase
      .from('assignments')
      .select(
        `${ASSIGNMENT_COLUMNS}, submissions ( submitted_at, submission_grades ( grade, feedback ) )`,
      )
      .eq('institution_id', profile.institutionId)
      .eq('offering_id', offeringId)
      .eq('id', assignmentId),
  ).maybeSingle();

  if (error || !data) return null;
  return toStudentAssignment(
    data as unknown as StudentAssignmentRow,
    now,
    profile.timeZone,
  );
}

function toStudentAssignment(
  row: StudentAssignmentRow,
  now: Date,
  timeZone: string,
): StudentAssignment {
  const base = toAssignment(row);
  const submission = row.submissions?.[0] ?? null;
  const grade = submission ? one(submission.submission_grades) : null;

  const input: AssignmentStateInput = {
    status: base.status,
    opensAt: base.opensAt,
    dueAt: base.dueAt,
    allowLate: base.allowLate,
    lateUntil: base.lateUntil,
    submittedAt: submission ? new Date(submission.submitted_at) : null,
    hasVisibleGrade: grade != null,
  };

  return {
    ...base,
    derived: deriveAssignmentState(input, now, timeZone),
    submittedAt: input.submittedAt,
    grade: grade ? Number(grade.grade) : null,
    feedback: grade?.feedback ?? null,
  };
}
