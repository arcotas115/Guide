import type { AssignmentFormValues } from '@/lib/assignments/schema';
import type { FacultyAssignment } from '@/lib/assignments/queries';
import { toDateTimeLocalValue } from '@/lib/format';

/**
 * Starting values for a new assignment.
 *
 * Opinionated on purpose: a professor setting a lab at 9pm should not have to
 * think about what "reasonable" looks like. A week out, due at 11:59pm, all
 * three submission types allowed (SPEC.md §3.7: open by default), no penalty.
 *
 * `0` for the penalty is a real value, not an empty field — the absence of a
 * penalty is a decision the student-facing copy renders.
 */
export function defaultAssignmentValues(
  now: Date = new Date(),
): AssignmentFormValues {
  // Seven days out, at 11:59 pm IN THE INSTITUTION'S TIMEZONE.
  //
  // This used to be `due.setHours(23, 59)`, which sets the hour in the SERVER's
  // timezone and then renders it in IST — so a professor opening a blank form
  // saw a due date of 09:29 am on this machine, and something else again from a
  // Vercel region. A default nobody typed, that moves when you redeploy.
  //
  // Taking the IST date string and appending the wall-clock time keeps the
  // arithmetic out of the wrong zone entirely.
  const day = toDateTimeLocalValue(
    new Date(now.getTime() + 7 * 86_400_000),
  ).slice(0, 10);

  return {
    title: '',
    instructions: '',
    marks: '20',
    // Blank means "available immediately", and the helper text says so. It must
    // render as an empty input, never as a defaulted timestamp.
    opensAt: '',
    dueAt: `${day}T23:59`,
    allowLate: true,
    lateUntil: '',
    latePenaltyPctPerDay: '0',
    hideNamesWhileGrading: false,
    acceptFile: true,
    acceptLink: true,
    acceptText: true,
  };
}

/** Turn a stored assignment back into form values. The inverse of
 *  toAssignmentRow — every field round-trips, so opening an assignment and
 *  saving it without edits is a no-op rather than a quiet data loss. */
export function assignmentToFormValues(
  a: FacultyAssignment,
): AssignmentFormValues {
  return {
    title: a.title,
    instructions: a.instructions ?? '',
    marks: String(a.marks),
    opensAt: a.opensAt ? toDateTimeLocalValue(a.opensAt) : '',
    dueAt: toDateTimeLocalValue(a.dueAt),
    allowLate: a.allowLate,
    lateUntil: a.lateUntil ? toDateTimeLocalValue(a.lateUntil) : '',
    latePenaltyPctPerDay: String(a.latePenaltyPctPerDay),
    hideNamesWhileGrading: a.hideNamesWhileGrading,
    acceptFile: a.acceptFile,
    acceptLink: a.acceptLink,
    acceptText: a.acceptText,
  };
}
