import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getOfferingForStudent } from '@/lib/assignments/queries';

/**
 * Guard for every screen inside a course.
 *
 * getOfferingForStudent looks up the enrolment, so a student who types another
 * course's id into the URL gets a 404 rather than a header they should not see.
 * RLS would return no assignments anyway; this makes the refusal legible
 * instead of rendering an eerily empty course.
 */
export default async function StudentCourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('student');
  const offering = await getOfferingForStudent(profile, offeringId);

  if (!offering) notFound();

  return <div className="flex flex-1 flex-col">{children}</div>;
}
