/**
 * The assignment form's contract. ONE schema, used by four callers:
 * the client form (via zodResolver), the create action, the edit action, and
 * the tests. BUILD_RULES.md rule 5 — validate at the door — plus the reason the
 * schema is shared rather than duplicated: two copies of a validation rule are
 * two rules, and they diverge on the first hurried edit.
 *
 * The database constraints in 0004 say the same things again. That is not
 * redundancy; it is the difference between a message a professor can act on
 * ("A late window must end after the deadline") and a 23514 check violation.
 * The DB is the last line, never the only one.
 */
import { z } from 'zod';
import { fromDateTimeLocalValue } from '@/lib/format';

/** A `datetime-local` value, parsed in the institution's zone. */
const dateTimeLocal = z
  .string()
  .trim()
  .refine((v) => v === '' || fromDateTimeLocalValue(v) !== null, {
    message: 'Use a valid date and time.',
  });

/**
 * Numeric fields arrive from an <input> as strings. `z.coerce.number()` would
 * turn "" into 0 silently, so empty is caught first and reported as missing
 * rather than as zero.
 */
const requiredNumber = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine((v) => Number.isFinite(Number(v)), `${label} must be a number.`)
    .transform(Number);

const optionalNumber = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || Number.isFinite(Number(v)), `${label} must be a number.`)
    .transform((v) => (v === '' ? 0 : Number(v)));

export const assignmentFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Give the assignment a title.')
      .max(200, 'Keep the title under 200 characters.'),

    instructions: z
      .string()
      .trim()
      .max(20_000, 'Instructions are too long.')
      .optional()
      .default(''),

    marks: requiredNumber('Marks'),

    opensAt: dateTimeLocal.optional().default(''),
    dueAt: z
      .string()
      .trim()
      .min(1, 'A due date is required.')
      .refine((v) => fromDateTimeLocalValue(v) !== null, {
        message: 'Use a valid date and time.',
      }),

    allowLate: z.boolean().default(true),
    lateUntil: dateTimeLocal.optional().default(''),
    latePenaltyPctPerDay: optionalNumber('Penalty'),

    hideNamesWhileGrading: z.boolean().default(false),

    acceptFile: z.boolean().default(true),
    acceptLink: z.boolean().default(true),
    acceptText: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.marks <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['marks'],
        message: 'Marks must be more than 0.',
      });
    }

    if (v.latePenaltyPctPerDay < 0 || v.latePenaltyPctPerDay > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['latePenaltyPctPerDay'],
        message: 'A penalty must be between 0 and 100% per day.',
      });
    }

    const opensAt = v.opensAt ? fromDateTimeLocalValue(v.opensAt) : null;
    const dueAt = fromDateTimeLocalValue(v.dueAt);
    const lateUntil = v.lateUntil ? fromDateTimeLocalValue(v.lateUntil) : null;

    if (opensAt && dueAt && dueAt <= opensAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'The due date must be after the assignment opens.',
      });
    }

    // A late window that is not after the deadline is not a window.
    if (lateUntil && dueAt && lateUntil <= dueAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['lateUntil'],
        message: 'The late window must end after the due date.',
      });
    }

    // ...and one on an assignment that refuses late work is a contradiction.
    if (lateUntil && !v.allowLate) {
      ctx.addIssue({
        code: 'custom',
        path: ['lateUntil'],
        message:
          'Turn on “Accept late submissions” first, or clear the late-until date.',
      });
    }

    if (!v.acceptFile && !v.acceptLink && !v.acceptText) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptFile'],
        message: 'Students need at least one way to submit.',
      });
    }
  });

/** What the form fields hold — all strings and booleans, as the DOM gives them. */
export type AssignmentFormValues = z.input<typeof assignmentFormSchema>;
/** What survives validation. */
export type AssignmentFormParsed = z.output<typeof assignmentFormSchema>;

/**
 * Which button was pressed. Kept out of the schema because it is an intent, not
 * a field: the same values are valid whether they are being saved as a draft or
 * published, and the professor may flip between the two without re-entering
 * anything.
 */
export const assignmentIntentSchema = z.enum(['publish', 'draft', 'close']);
export type AssignmentIntent = z.infer<typeof assignmentIntentSchema>;

/** Turn validated form values into the row shape the database expects. */
export function toAssignmentRow(v: AssignmentFormParsed) {
  return {
    title: v.title,
    instructions: v.instructions || null,
    marks: v.marks,
    opens_at: v.opensAt ? fromDateTimeLocalValue(v.opensAt)?.toISOString() : null,
    due_at: fromDateTimeLocalValue(v.dueAt)!.toISOString(),
    allow_late: v.allowLate,
    // Enforced by the schema above too, but belt-and-braces: a late window can
    // never be persisted alongside allow_late = false, whatever the form sent.
    late_until:
      v.allowLate && v.lateUntil
        ? fromDateTimeLocalValue(v.lateUntil)?.toISOString()
        : null,
    late_penalty_pct_per_day: v.latePenaltyPctPerDay,
    hide_names_while_grading: v.hideNamesWhileGrading,
    accept_file: v.acceptFile,
    accept_link: v.acceptLink,
    accept_text: v.acceptText,
  };
}
