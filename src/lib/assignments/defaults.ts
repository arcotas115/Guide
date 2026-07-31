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
export function defaultAssignmentValues(now: Date = new Date()): AssignmentFormValues {
  const due = new Date(now.getTime() + 7 * 86_400_000);
  due.setHours(23, 59, 0, 0);

  return {
    title: '',
    instructions: '',
    marks: '20',
    opensAt: '',
    dueAt: toDateTimeLocalValue(due),
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
