import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { AssignmentForm } from '@/components/faculty/assignment-form';
import { createAssignment } from '../actions';
import { defaultAssignmentValues } from '@/lib/assignments/defaults';

export const metadata: Metadata = { title: 'New assignment · Campus' };

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  await requireRole('faculty');

  return (
    <AssignmentForm
      mode="create"
      offeringId={offeringId}
      defaultValues={defaultAssignmentValues()}
      // Bound on the server: the offering id is baked into the closure rather
      // than posted by the client, so it cannot be swapped for someone else's
      // course on the way to the action.
      onSubmit={async (intent, values) => {
        'use server';
        return createAssignment(offeringId, intent, values);
      }}
    />
  );
}
