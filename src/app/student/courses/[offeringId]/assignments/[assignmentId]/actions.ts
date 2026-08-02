'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth';
import { submitPayloadSchema, toDbItems } from '@/lib/submissions/schema';
import { pathMatches } from '@/lib/storage';

export type SubmitState = { error: string | null; ok: boolean };

/**
 * Record an attempt.
 *
 * WHAT THIS DOES NOT DO: write anything itself. Every check that decides whether
 * work may be handed in — enrolment, the assignment being open, the deadline,
 * the late window, the attempt policy, the attempt NUMBER — lives inside
 * `submit_attempt()`, because RLS cannot express any of them and a policy that
 * tried would be a worse copy of a function that already exists.
 *
 * What this adds is the half the database cannot check: that the storage paths
 * the CLIENT chose actually belong to this caller and this assignment.
 */
export async function submitAttempt(input: unknown): Promise<SubmitState> {
  const profile = await requireRole('student');

  const parsed = submitPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check what you attached.' };
  }
  const { assignmentId, items } = parsed.data;

  // ---- re-validate the paths the client picked -----------------------------
  //
  // The upload itself went straight from the browser to storage under the
  // student's own session, so the storage policy was the boundary there. But
  // the client also chooses the path STRING it reports back, and nothing stops
  // it uploading to its own legitimate folder and then reporting that object
  // against a different assignment. The policy guards the bytes; this guards
  // the row.
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (
      !pathMatches(item.storagePath, {
        institutionId: profile.institutionId,
        assignmentId,
        ownerId: profile.id,
      })
    ) {
      return {
        ok: false,
        error: 'That upload could not be matched to this assignment. Try attaching it again.',
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('submit_attempt', {
    p_assignment_id: assignmentId,
    p_items: toDbItems(items),
  });

  if (error) {
    // submit_attempt raises with messages written for a student, so they are
    // passed through. Anything without one is a bug rather than a rule.
    return { ok: false, error: humanise(error.message) };
  }

  revalidatePath(`/student/courses`, 'layout');
  return { ok: true, error: null };
}

function humanise(message: string): string {
  const clean = message.replace(/^.*?:\s*/, '').trim();
  // Every raise inside submit_attempt() is already a sentence. If we get
  // something that is not, it is a Postgres-level failure the student cannot
  // act on, so say something true instead of leaking it.
  if (!clean || clean.length > 200 || /^[A-Z_]+$/.test(clean)) {
    return 'That could not be submitted. Please try again.';
  }
  return clean;
}
