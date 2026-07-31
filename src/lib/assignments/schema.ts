/**
 * The assignment form's contract. ONE schema, used by four callers: the client
 * form (via the resolver), the create action, the edit action, and the tests.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE MUST OBEY: THE SCHEMA IS IDEMPOTENT.
 *
 *     parse(parse(x)) === parse(x)
 *
 * It is not an aesthetic preference — it is forced by how the schema is used.
 * react-hook-form's resolver validates on the client and hands `handleSubmit`
 * the schema's OUTPUT. That output is what travels to the server action, which
 * validates again with the same schema. So the schema always parses its own
 * output, and any field whose input type differs from its output type breaks on
 * that second pass.
 *
 * That is exactly the bug that stopped assignments being created: `marks` was
 * `z.string().transform(Number)`, so the client turned "20" into 20 and the
 * server then rejected 20 with "expected string, received number". The same
 * fault was sitting in `latePenaltyPctPerDay`, unreported only because zod
 * lists `marks` first.
 *
 * Every numeric field below therefore accepts string OR number and coerces.
 * The IDEMPOTENCY group in scripts/test-actions.mts asserts the property
 * directly — parse, re-parse, and diff every field — so it cannot regress
 * quietly the way it did the first time.
 *
 * ---------------------------------------------------------------------------
 * MESSAGES ARE WRITTEN FOR A PROFESSOR, NOT A DEVELOPER.
 * No zod default message may reach a screen. Every branch below supplies its
 * own sentence in plain language.
 *
 * The database constraints in 0004 restate several of these rules. That is not
 * redundancy; it is the difference between "The late-until date has to be after
 * the due date" and a 23514 check violation.
 */
import { z } from 'zod';
import { fromDateTimeLocalValue } from '@/lib/format';

/* ---------------------------------------------------------------------------
 * Numbers
 * ------------------------------------------------------------------------- */

/**
 * A number that may arrive as a string (first pass, from the DOM) or as a
 * number (second pass, having already been coerced). Both are accepted and both
 * produce a number.
 */
function numericField(opts: {
  /** Message when the field is blank. Omit to allow blank. */
  requiredMessage?: string;
  /** Value to use when blank and blank is allowed. */
  whenBlank?: number;
  notANumberMessage: string;
  /** Range check, applied only once a finite number is in hand. */
  range?: { min: number; max?: number; exclusiveMin?: boolean; message: string };
}) {
  return z
    .custom<string | number>(
      (v) => typeof v === 'string' || typeof v === 'number',
      { error: opts.requiredMessage ?? opts.notANumberMessage },
    )
    .superRefine((raw, ctx) => {
      const text = typeof raw === 'string' ? raw.trim() : String(raw);

      if (text === '') {
        if (opts.requiredMessage) {
          ctx.addIssue({ code: 'custom', message: opts.requiredMessage });
        }
        return;
      }

      const n = Number(text);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: opts.notANumberMessage });
        return;
      }

      if (opts.range) {
        const { min, max, exclusiveMin, message } = opts.range;
        const tooLow = exclusiveMin ? n <= min : n < min;
        const tooHigh = max !== undefined && n > max;
        if (tooLow || tooHigh) {
          ctx.addIssue({ code: 'custom', message });
        }
      }
    })
    .transform((raw) => {
      const text = typeof raw === 'string' ? raw.trim() : String(raw);
      if (text === '') return opts.whenBlank ?? 0;
      const n = Number(text);
      return Number.isFinite(n) ? n : (opts.whenBlank ?? 0);
    });
}

/* ---------------------------------------------------------------------------
 * Booleans
 * ------------------------------------------------------------------------- */

/**
 * A checkbox or toggle value.
 *
 * Accepts every shape one can legitimately arrive in: a real boolean from the
 * React form, `"on"` from a native checkbox in a FormData post, and the string
 * or numeric forms that survive a JSON round trip. Coercing is better than
 * erroring here — there is no sentence to write for "this toggle is not a
 * boolean" that would mean anything to a professor, and the honest answer for
 * an unrecognised value is the field's default rather than a blocked save.
 */
export function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(t)) return true;
    if (['false', 'off', 'no', '0', ''].includes(t)) return false;
  }
  return fallback;
}

function booleanField(fallback: boolean) {
  return z
    .custom<boolean | string | number>(
      (v) =>
        typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number',
      { error: 'That setting could not be read.' },
    )
    .transform((v) => toBoolean(v, fallback))
    .default(fallback);
}

/* ---------------------------------------------------------------------------
 * Dates
 *
 * A `datetime-local` value is a string on the way in and a string on the way
 * out — already idempotent. Blank stays blank, and blank is meaningful: no open
 * date means "available immediately", no late-until means "until you close it".
 * ------------------------------------------------------------------------- */

const BAD_DATE = 'That date and time does not look right.';

const optionalDateTime = z
  .string()
  .trim()
  .refine((v) => v === '' || fromDateTimeLocalValue(v) !== null, {
    message: BAD_DATE,
  })
  .optional()
  .default('');

const requiredDateTime = z
  .string({ error: 'Pick a due date.' })
  .trim()
  .min(1, 'Pick a due date.')
  .refine((v) => fromDateTimeLocalValue(v) !== null, { message: BAD_DATE });

/* ---------------------------------------------------------------------------
 * The schema
 * ------------------------------------------------------------------------- */

export const assignmentFormSchema = z
  .object({
    title: z
      .string({ error: 'Give the assignment a title.' })
      .trim()
      .min(1, 'Give the assignment a title.')
      .max(200, 'Keep the title under 200 characters.'),

    instructions: z
      .string()
      .trim()
      .max(20_000, 'These instructions are too long to save.')
      .optional()
      .default(''),

    marks: numericField({
      requiredMessage: 'Enter the total marks.',
      notANumberMessage: 'Enter the marks as a number, like 20.',
      // Zero marks is meaningless for an assessment. The database currently
      // allows marks >= 0; tightening that CHECK to > 0 is a schema change and
      // belongs in the next session. Until then zod is the only thing enforcing
      // it, which is noted here so the gap is visible rather than assumed away.
      range: {
        min: 0,
        exclusiveMin: true,
        message: 'Marks must be more than zero.',
      },
    }),

    opensAt: optionalDateTime,
    dueAt: requiredDateTime,

    allowLate: booleanField(true),
    lateUntil: optionalDateTime,

    latePenaltyPctPerDay: numericField({
      whenBlank: 0,
      notANumberMessage: 'Enter the penalty as a number, like 10.',
      range: {
        min: 0,
        max: 100,
        message: 'The penalty has to be between 0 and 100% per day.',
      },
    }),

    hideNamesWhileGrading: booleanField(false),

    acceptFile: booleanField(true),
    acceptLink: booleanField(true),
    acceptText: booleanField(true),
  })
  .superRefine((v, ctx) => {
    const opensAt = v.opensAt ? fromDateTimeLocalValue(v.opensAt) : null;
    const dueAt = fromDateTimeLocalValue(v.dueAt);
    const lateUntil = v.lateUntil ? fromDateTimeLocalValue(v.lateUntil) : null;

    if (opensAt && dueAt && dueAt <= opensAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueAt'],
        message: 'The due date has to be after the assignment opens.',
      });
    }

    // A late window that is not after the deadline is not a window.
    if (lateUntil && dueAt && lateUntil <= dueAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['lateUntil'],
        message: 'The late-until date has to be after the due date.',
      });
    }

    // ...and one on an assignment that refuses late work is a contradiction the
    // database will not store either.
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
        message: 'Pick at least one way for students to submit.',
      });
    }
  });

/** What the form fields hold. Numbers may be strings — see the idempotency note. */
export type AssignmentFormValues = z.input<typeof assignmentFormSchema>;
/** What survives validation. Numbers are numbers. */
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
