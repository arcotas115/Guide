'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth';
import { getOfferingForFaculty } from '@/lib/assignments/queries';
import {
  assignmentFormSchema,
  assignmentIntentSchema,
  toAssignmentRow,
  type AssignmentIntent,
} from '@/lib/assignments/schema';
import type { AssignmentActionState } from '@/lib/assignments/action-state';

/**
 * `status` is set from the button pressed, never from the form body.
 *
 * If the client could post a status, a student with the endpoint could publish
 * a draft. Publishing is an intent the server maps to a lifecycle value; it is
 * not a field the browser gets to choose.
 */
const STATUS_FOR_INTENT: Record<AssignmentIntent, 'draft' | 'open' | 'closed'> = {
  draft: 'draft',
  publish: 'open',
  close: 'closed',
};

/**
 * Both write paths start here: authenticate, confirm this professor actually
 * teaches this offering, then validate. RLS refuses the write regardless — this
 * is what turns that refusal into a sentence a person can act on.
 */
async function authorise(offeringId: string) {
  const profile = await requireRole('faculty');
  const offering = await getOfferingForFaculty(profile, offeringId);
  if (!offering) {
    return { profile: null, offering: null } as const;
  }
  return { profile, offering } as const;
}

function validate(input: unknown, intent: unknown) {
  const parsedIntent = assignmentIntentSchema.safeParse(intent);
  if (!parsedIntent.success) {
    return { ok: false as const, state: fail('Unknown action.') };
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
      ok: false as const,
      state: {
        error: 'Some details need fixing before this can be saved.',
        fieldErrors,
      },
    };
  }

  return { ok: true as const, values: parsed.data, intent: parsedIntent.data };
}

function fail(message: string): AssignmentActionState {
  return { error: message, fieldErrors: {} };
}

export async function createAssignment(
  offeringId: string,
  intent: AssignmentIntent,
  input: unknown,
): Promise<AssignmentActionState> {
  const { profile, offering } = await authorise(offeringId);
  if (!profile || !offering) {
    return fail('You do not teach this course.');
  }

  const checked = validate(input, intent);
  if (!checked.ok) return checked.state;

  const supabase = await createClient();
  const { error } = await supabase.from('assignments').insert({
    institution_id: profile.institutionId,
    offering_id: offeringId,
    created_by: profile.id,
    status: STATUS_FOR_INTENT[checked.intent],
    ...toAssignmentRow(checked.values),
  });

  if (error) return fail(describe(error.message));

  revalidatePath(`/faculty/courses/${offeringId}/assignments`);
  redirect(`/faculty/courses/${offeringId}/assignments`);
}

export async function updateAssignment(
  offeringId: string,
  assignmentId: string,
  intent: AssignmentIntent,
  input: unknown,
): Promise<AssignmentActionState> {
  const { profile, offering } = await authorise(offeringId);
  if (!profile || !offering) {
    return fail('You do not teach this course.');
  }

  const checked = validate(input, intent);
  if (!checked.ok) return checked.state;

  const supabase = await createClient();
  const { error } = await supabase
    .from('assignments')
    .update({
      status: STATUS_FOR_INTENT[checked.intent],
      ...toAssignmentRow(checked.values),
    })
    .eq('institution_id', profile.institutionId)
    .eq('offering_id', offeringId)
    .eq('id', assignmentId);

  if (error) return fail(describe(error.message));

  revalidatePath(`/faculty/courses/${offeringId}/assignments`);
  redirect(`/faculty/courses/${offeringId}/assignments`);
}

/**
 * Close an assignment. A pure status flip with nothing attached — unlike Extend
 * and Reopen, which auto-post an announcement and therefore wait for the
 * announcements feature to exist.
 *
 * Note what this does NOT touch: grades_released. Closing an assignment stops
 * submissions; it says nothing about whether marks are published. Conflating
 * the two is the single easiest way to leak a grade early.
 */
export async function closeAssignment(offeringId: string, assignmentId: string) {
  const { profile, offering } = await authorise(offeringId);
  if (!profile || !offering) return;

  const supabase = await createClient();
  await supabase
    .from('assignments')
    .update({ status: 'closed' })
    .eq('institution_id', profile.institutionId)
    .eq('offering_id', offeringId)
    .eq('id', assignmentId);

  revalidatePath(`/faculty/courses/${offeringId}/assignments`);
}

/** Turn the database's own words into something a professor can act on. */
function describe(message: string): string {
  if (message.includes('assignments_late_until_after_due')) {
    return 'The late window must end after the due date.';
  }
  if (message.includes('assignments_late_until_requires_allow_late')) {
    return 'Turn on “Accept late submissions” before setting a late-until date.';
  }
  if (message.includes('assignments_late_penalty_range')) {
    return 'The penalty must be between 0 and 100% per day.';
  }
  if (message.includes('row-level security')) {
    return 'You do not have permission to change this assignment.';
  }
  return 'That could not be saved. Please try again.';
}
