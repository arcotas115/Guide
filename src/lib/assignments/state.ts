/**
 * The five student-facing assignment states.
 *
 * THESE ARE DERIVED. There is no `state` column and there must never be one
 * (SPEC.md §3.7). A stored state is a second source of truth that drifts the
 * moment a deadline passes with nobody watching — the assignment would sit at
 * "Open" until some job remembered to move it.
 *
 * Everything that shows an assignment to a student calls this: the course list,
 * the detail screen, and 1B's To-Do. One function means those three cannot
 * disagree, which is the actual reason it lives here rather than in a component.
 */
import { formatDay } from '@/lib/format';

export type AssignmentState =
  | 'upcoming'
  | 'open'
  | 'submitted'
  | 'graded'
  | 'overdue';

/** The stored facts the derivation reads. Nothing else may influence it. */
export type AssignmentStateInput = {
  status: 'draft' | 'open' | 'closed';
  opensAt: Date | null;
  dueAt: Date;
  allowLate: boolean;
  lateUntil: Date | null;
  /** The student's own submission, if any. */
  submittedAt: Date | null;
  /**
   * Whether a grade row is visible to this student. Because of the RLS policy on
   * submission_grades, a student can only ever see a row whose parent assignment
   * has grades_released = true — so if this is true, it is published, full stop.
   * The professor's unpublished draft mark is not merely hidden here; it never
   * arrives from the database at all.
   */
  hasVisibleGrade: boolean;
};

export type DerivedState = {
  state: AssignmentState;
  /** One line, student-facing. Warm and specific, never a bare status word. */
  label: string;
  /**
   * Rust. TRUE FOR OVERDUE AND NOTHING ELSE (BUILD_RULES.md design language).
   * If you find yourself wanting this true for another state, the answer is no.
   */
  isUrgent: boolean;
  /** Set only when late work is still being accepted — drives "accepted till …". */
  acceptingUntil: Date | null;
  /** Whether a submit control should appear at all. Used by 1B. */
  canSubmit: boolean;
};

/**
 * `now` is a parameter, not `new Date()` inside, so this is a pure function that
 * can be tested at any point on the timeline.
 *
 * `timeZone` is required because this function BUILDS THE LABEL — "Due 12 Aug",
 * "Opens 2 Sep" — and a date is not renderable without a zone. It comes from
 * institutions.timezone; there is deliberately no default, so a new caller
 * cannot forget it and quietly render Indian time for a college elsewhere.
 */
export function deriveAssignmentState(
  input: AssignmentStateInput,
  now: Date,
  timeZone: string,
): DerivedState {
  // allowLate/lateUntil are read through the helpers below rather than here,
  // so the window rules live in exactly one place.
  const { status, opensAt, dueAt, submittedAt, hasVisibleGrade } = input;

  // Order matters below. Each branch assumes the ones above it did not match.

  // 1. Graded outranks everything: it is the end of the assignment's life for
  //    the student, whatever the dates now say.
  if (hasVisibleGrade) {
    return {
      state: 'graded',
      label: 'Graded',
      isUrgent: false,
      acceptingUntil: null,
      canSubmit: false,
    };
  }

  // 2. Submitted but not yet graded. Deliberately reassuring — the whole point
  //    of the persistent ✓ is that nobody has to wonder whether it went through.
  if (submittedAt) {
    return {
      state: 'submitted',
      label: `Submitted ${formatDay(submittedAt, timeZone, now)} · awaiting grade`,
      isUrgent: false,
      acceptingUntil: null,
      canSubmit: status === 'open' && isStillAccepting(input, now),
    };
  }

  // 3. Not open to them yet. Visible, but not actionable, and not alarming.
  if (opensAt && opensAt > now) {
    return {
      state: 'upcoming',
      label: `Opens ${formatDay(opensAt, timeZone, now)}`,
      isUrgent: false,
      acceptingUntil: null,
      canSubmit: false,
    };
  }

  // 4. Missed. The only rust state in the app besides low attendance.
  //
  //    Note that `closed` lands here too when nothing was submitted: SPEC's five
  //    states have no name for "the professor closed it early and you did not
  //    submit", and from the student's side that is simply a missed assignment.
  //    The label distinguishes the two so the copy stays honest.
  const pastDue = now > dueAt;
  if (status === 'closed' || pastDue) {
    const acceptingUntil = acceptingUntilDate(input, now);
    return {
      state: 'overdue',
      label: acceptingUntil
        ? `Overdue · accepted till ${formatDay(acceptingUntil, timeZone, now)}`
        : status === 'closed' && !pastDue
          ? 'Closed'
          : `Overdue · was due ${formatDay(dueAt, timeZone, now)}`,
      isUrgent: true,
      acceptingUntil,
      canSubmit: status === 'open' && acceptingUntil !== null,
    };
  }

  // 5. Open and waiting.
  return {
    state: 'open',
    label: `Due ${formatDay(dueAt, timeZone, now)}`,
    isUrgent: false,
    acceptingUntil: null,
    canSubmit: status === 'open',
  };
}

/**
 * The end of the late-acceptance window, or null if late work is not being
 * accepted right now.
 *
 * `allow_late = true` with a null `late_until` means "accepted until the
 * assignment is closed" (SPEC.md §4), which is an open-ended window — so there
 * is no date to show, but submission is still permitted. That case returns null
 * here and is handled by canSubmit separately, because "no end date" and "not
 * accepted" are different things that would otherwise collapse into one.
 */
function acceptingUntilDate(input: AssignmentStateInput, now: Date): Date | null {
  if (!input.allowLate || input.status !== 'open') return null;
  if (!input.lateUntil) return null;
  return input.lateUntil > now ? input.lateUntil : null;
}

function isStillAccepting(input: AssignmentStateInput, now: Date): boolean {
  if (now <= input.dueAt) return true;
  if (!input.allowLate) return false;
  // Open-ended window: accepted until the assignment is closed.
  if (!input.lateUntil) return true;
  return input.lateUntil > now;
}

/* ---------------------------------------------------------------------------
 * The faculty view of the same assignment
 * ------------------------------------------------------------------------- */

/**
 * Which group an assignment belongs to on the professor's list.
 *
 * It is DERIVED, through the same `deriveAssignmentState` the student side
 * uses, because there must not be two notions of state in this codebase.
 * Grouping on `status` alone was wrong in a way that showed: an assignment
 * published on 31 July but opening on 10 August has `status = 'open'`, so it
 * sat under "Waiting on you — open to students, or past due and not yet
 * marked", which it is neither of. It is scheduled.
 *
 * The two questions the two surfaces ask are genuinely different, though:
 *   - a student asks "where does this stand FOR ME" — which needs their own
 *     submission and whether grades are out;
 *   - a professor asks "where does this stand AT ALL" — which is the same
 *     derivation with no student in it.
 * So this passes no submission and no grade, and reads the result.
 */
export type FacultyGroup = 'waiting' | 'scheduled' | 'closed' | 'draft';

export type FacultyAssignmentLike = {
  status: 'draft' | 'open' | 'closed';
  opensAt: Date | null;
  dueAt: Date;
  allowLate: boolean;
  lateUntil: Date | null;
};

/** The assignment's own state, with no student in the picture. */
export function deriveForFaculty(
  a: FacultyAssignmentLike,
  now: Date,
  timeZone: string,
): DerivedState {
  return deriveAssignmentState(
    { ...a, submittedAt: null, hasVisibleGrade: false },
    now,
    timeZone,
  );
}

/**
 * Grouping needs no timezone — it compares instants, and an instant is the same
 * moment everywhere. Only the LABEL needs a zone, which is why deriveForFaculty
 * takes one and this does not.
 */
export function facultyGroupFor(
  a: FacultyAssignmentLike,
  now: Date = new Date(),
): FacultyGroup {
  // Drafts and closed assignments are answered by `status` alone — a draft has
  // no student-facing state at all, and closed is the end of the line.
  if (a.status === 'draft') return 'draft';
  if (a.status === 'closed') return 'closed';

  // Everything still open is placed by what the dates actually say. The zone
  // passed here is irrelevant to the branch taken — only to the label, which is
  // discarded — so UTC is used rather than pretending a real one is needed.
  return deriveForFaculty(a, now, 'UTC').state === 'upcoming'
    ? 'scheduled'
    : 'waiting';
}

/** Tailwind classes per state. Kept beside the derivation so a new state cannot
 *  be added without someone deciding how it looks. */
export const STATE_STYLES: Record<AssignmentState, string> = {
  upcoming: 'text-ink-soft',
  open: 'text-ink-muted',
  submitted: 'text-moss-deep',
  graded: 'text-moss-deep',
  overdue: 'text-rust',
};
