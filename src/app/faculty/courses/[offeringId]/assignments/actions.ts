'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth';
import { getOfferingForFaculty } from '@/lib/assignments/queries';
import type { AssignmentIntent } from '@/lib/assignments/schema';
import type { AssignmentActionState } from '@/lib/assignments/action-state';
import {
  prepareAssignmentWrite,
  describeDbError,
} from '@/lib/assignments/prepare';

/**
 * The two write paths. Each is: authorise, prepare, write.
 *
 * `prepare` — validation, coercion, intent → status, row building — lives in
 * lib/assignments/prepare.ts so it can be tested without a request. What is
 * left here is only what genuinely needs one.
 */

/**
 * Authenticate and confirm this professor actually teaches this offering.
 * RLS refuses the write regardless; this is what turns that refusal into a
 * sentence a person can act on, and into a 404 rather than a silent no-op.
 */
async function authorise(offeringId: string) {
  const profile = await requireRole('faculty');
  const offering = await getOfferingForFaculty(profile, offeringId);
  if (!offering) return { profile: null } as const;
  return { profile } as const;
}

function fail(message: string): AssignmentActionState {
  return { error: message, fieldErrors: {} };
}

export async function createAssignment(
  offeringId: string,
  intent: AssignmentIntent,
  input: unknown,
): Promise<AssignmentActionState> {
  const { profile } = await authorise(offeringId);
  if (!profile) return fail('You do not teach this course.');

  // The zone comes from the institution on the server, never from the client.
  const prep = prepareAssignmentWrite(intent, input, profile.timeZone);
  if (!prep.ok) return prep.state;

  const supabase = await createClient();
  const { error } = await supabase.from('assignments').insert({
    institution_id: profile.institutionId,
    offering_id: offeringId,
    created_by: profile.id,
    status: prep.prepared.status,
    ...prep.prepared.row,
  });

  if (error) return fail(describeDbError(error.message));

  revalidatePath(`/faculty/courses/${offeringId}/assignments`);
  redirect(`/faculty/courses/${offeringId}/assignments`);
}

export async function updateAssignment(
  offeringId: string,
  assignmentId: string,
  intent: AssignmentIntent,
  input: unknown,
): Promise<AssignmentActionState> {
  const { profile } = await authorise(offeringId);
  if (!profile) return fail('You do not teach this course.');

  // The zone comes from the institution on the server, never from the client.
  const prep = prepareAssignmentWrite(intent, input, profile.timeZone);
  if (!prep.ok) return prep.state;

  const supabase = await createClient();
  const { error } = await supabase
    .from('assignments')
    .update({
      status: prep.prepared.status,
      ...prep.prepared.row,
    })
    .eq('institution_id', profile.institutionId)
    .eq('offering_id', offeringId)
    .eq('id', assignmentId);

  if (error) return fail(describeDbError(error.message));

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
  const { profile } = await authorise(offeringId);
  if (!profile) return;

  const supabase = await createClient();
  await supabase
    .from('assignments')
    .update({ status: 'closed' })
    .eq('institution_id', profile.institutionId)
    .eq('offering_id', offeringId)
    .eq('id', assignmentId);

  revalidatePath(`/faculty/courses/${offeringId}/assignments`);
}
