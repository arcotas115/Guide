import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { CurrentProfile } from '@/lib/auth';
import { live } from '@/lib/soft-delete';

export type TodoItem = {
  assignmentId: string;
  offeringId: string;
  title: string;
  dueAt: Date;
  marks: number;
  courseCode: string;
  courseColor: string;
};

type Row = {
  id: string;
  offering_id: string;
  title: string;
  due_at: string;
  marks: string | number;
  course_offerings: {
    courses: { code: string; color: string } | null;
  } | null;
  submissions: Array<{ id: string }> | null;
};

/**
 * Everything a student still has to do, across every course.
 *
 * THE FIRST QUERY THAT AGGREGATES ACROSS OFFERINGS, which makes it the first
 * place a tenancy or soft-delete mistake would surface as somebody else's work
 * in a student's list. Four separate mechanisms keep that from happening, and
 * NOT ONE of them is a `where` clause written here:
 *
 *   enrolment      assignments_read admits a row only via
 *                  enrolled_in_offering(), so an offering the student is not in
 *                  cannot come back.
 *   drafts         the same policy requires status <> 'draft' for students.
 *   soft deletes   0008's restrictive cascade hides anything whose offering,
 *                  course or term is deleted.
 *   tenancy        every policy is institution-scoped, and the explicit filter
 *                  below states that intent rather than relying on it.
 *
 * That is deliberate. A filter in application code is a filter that can be
 * forgotten, and this is exactly the screen where forgetting it would be worst.
 * The RLS tests assert each of the four against the database.
 *
 * ONE QUERY, not a loop over courses. Six courses would be six round trips on a
 * phone, on Indian mobile data, on the screen students open most often.
 */
export async function getTodo(
  profile: CurrentProfile,
): Promise<TodoItem[]> {
  const supabase = await createClient();

  const { data, error } = await live(
    supabase
      .from('assignments')
      .select(
        `id, offering_id, title, due_at, marks,
         course_offerings ( courses ( code, color ) ),
         submissions ( id )`,
      )
      .eq('institution_id', profile.institutionId)
      // Only work that can still be acted on. A closed assignment the student
      // missed is history, and To-Do is a list of things to do — nagging about
      // something they can no longer submit is what makes a list get ignored.
      .eq('status', 'open'),
  ).order('due_at', { ascending: true });

  if (error || !data) return [];

  return (data as unknown as Row[])
    // "Only unfinished work appears." The embedded submissions come back
    // RLS-scoped to this student, so a non-empty array means THEY have an
    // attempt — regardless of whether it has been graded. Submitting removes
    // the row from this list, which is what makes the list trustworthy enough
    // to be the screen a student opens first.
    .filter((r) => (r.submissions?.length ?? 0) === 0)
    .map((r) => {
      const course = r.course_offerings?.courses ?? null;
      return {
        assignmentId: r.id,
        offeringId: r.offering_id,
        title: r.title,
        dueAt: new Date(r.due_at),
        marks: Number(r.marks),
        courseCode: course?.code ?? '',
        // Colour is identity and it comes from the column, never a constant.
        courseColor: course?.color ?? '#55605a',
      };
    })
    .filter((i) => i.courseCode !== '');
}
