import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getAssignmentForFaculty } from '@/lib/assignments/queries';
import { AssignmentForm } from '@/components/faculty/assignment-form';
import { CloseAssignmentButton } from '@/components/faculty/close-assignment-button';
import { Card } from '@/components/kit/surfaces';
import { assignmentToFormValues } from '@/lib/assignments/defaults';
import { updateAssignment, closeAssignment } from '../../actions';

export const metadata: Metadata = { title: 'Edit assignment · Campus' };

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ offeringId: string; assignmentId: string }>;
}) {
  const { offeringId, assignmentId } = await params;
  const profile = await requireRole('faculty');

  const assignment = await getAssignmentForFaculty(
    profile,
    offeringId,
    assignmentId,
  );
  if (!assignment) notFound();

  return (
    <>
      <AssignmentForm
        mode="edit"
        status={assignment.status}
        offeringId={offeringId}
        defaultValues={assignmentToFormValues(assignment, profile.timeZone)}
        onSubmit={async (intent, values) => {
          'use server';
          return updateAssignment(offeringId, assignmentId, intent, values);
        }}
      />

      {/*
        Close is here and Extend/Reopen are not, deliberately. Both of those
        auto-post an announcement to the course (SPEC.md §3.5) and
        announcements do not exist yet — shipping the button without the post
        would make the app promise something it cannot do. Close is a status
        flip with nothing attached, so it ships.
      */}
      {assignment.status === 'open' ? (
        <Card className="mt-10 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-ink text-[14.5px] font-medium">
                Stop accepting submissions
              </p>
              <p className="text-ink-soft mt-1 text-[12.5px] leading-relaxed">
                Students keep the assignment and anything they submitted. This
                does not publish marks — that is a separate step.
              </p>
            </div>
            <CloseAssignmentButton
              action={async () => {
                'use server';
                await closeAssignment(offeringId, assignmentId);
              }}
            />
          </div>
        </Card>
      ) : null}
    </>
  );
}
