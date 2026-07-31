import {
  assignmentFormSchema,
  assignmentIntentSchema,
  toAssignmentRow,
  type AssignmentIntent,
} from '@/lib/assignments/schema';
import type { AssignmentActionState } from '@/lib/assignments/action-state';

/**
 * Everything the create and edit server actions do between "the request
 * arrived" and "write this row" — validate the intent, validate the payload,
 * turn the intent into a lifecycle status, and build the row.
 *
 * WHY IT LIVES HERE AND NOT INSIDE THE ACTIONS.
 * The actions themselves import `next/headers` and the Supabase server client,
 * so they cannot run outside a request. That put the entire validate → coerce →
 * row pipeline out of reach of the test suite, which is precisely why 96
 * passing assertions failed to notice that no assignment could be created at
 * all. Pulled out here, the exact code path a professor triggers is an ordinary
 * function that a test can call with the exact payload the browser sends.
 *
 * What stays in the actions is only what genuinely needs a request: who is
 * signed in, whether they teach this offering, and the database call.
 */

/**
 * `status` is derived from the button pressed, never read from the payload.
 *
 * If the client could post a status, anyone with the endpoint could publish
 * another professor's draft. Publishing is an intent the server maps to a
 * lifecycle value; it is not a field the browser gets to choose.
 */
const STATUS_FOR_INTENT: Record<AssignmentIntent, 'draft' | 'open' | 'closed'> =
  {
    draft: 'draft',
    publish: 'open',
    close: 'closed',
  };

export type PreparedAssignment = {
  status: 'draft' | 'open' | 'closed';
  row: ReturnType<typeof toAssignmentRow>;
};

export type PrepareResult =
  | { ok: true; prepared: PreparedAssignment }
  | { ok: false; state: AssignmentActionState };

export function prepareAssignmentWrite(
  intent: unknown,
  input: unknown,
): PrepareResult {
  const parsedIntent = assignmentIntentSchema.safeParse(intent);
  if (!parsedIntent.success) {
    return {
      ok: false,
      state: { error: 'That action is not available.', fieldErrors: {} },
    };
  }

  const parsed = assignmentFormSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      // First message per field wins — a stack of errors on one input is noise.
      if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return {
      ok: false,
      state: {
        error: 'Some details need fixing before this can be saved.',
        fieldErrors,
      },
    };
  }

  return {
    ok: true,
    prepared: {
      status: STATUS_FOR_INTENT[parsedIntent.data],
      row: toAssignmentRow(parsed.data),
    },
  };
}

/**
 * Turn a database error into something a professor can act on.
 *
 * These fire only if a payload slips past zod — a constraint the schema does
 * not mirror, or a race. Reaching one is a sign the schema is missing a rule,
 * not that the message needs improving.
 */
export function describeDbError(message: string): string {
  if (message.includes('assignments_late_until_after_due')) {
    return 'The late-until date has to be after the due date.';
  }
  if (message.includes('assignments_late_until_requires_allow_late')) {
    return 'Turn on “Accept late submissions” before setting a late-until date.';
  }
  if (message.includes('assignments_late_penalty_range')) {
    return 'The penalty has to be between 0 and 100% per day.';
  }
  if (message.includes('assignments_marks_check')) {
    return 'Marks must be more than zero.';
  }
  if (message.includes('row-level security')) {
    return 'You do not have permission to change this assignment.';
  }
  return 'That could not be saved. Please try again.';
}
