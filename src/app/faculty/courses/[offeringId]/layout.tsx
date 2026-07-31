import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getOfferingForFaculty } from '@/lib/assignments/queries';
import { CourseSidebar } from '@/components/faculty/course-sidebar';

/**
 * The course workspace shell. Desktop-first (BUILD_RULES.md rule 7): a calm
 * left sidebar, wide content area.
 *
 * The guard is here rather than on each page so every future section inherits
 * it. getOfferingForFaculty returns null unless a teaching_assignments row ties
 * this professor to this offering, so a guessed id in the URL is a 404 — not a
 * peek at a colleague's course.
 */
export default async function CourseWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ offeringId: string }>;
}) {
  const { offeringId } = await params;
  const profile = await requireRole('faculty');
  const offering = await getOfferingForFaculty(profile, offeringId);

  if (!offering) notFound();

  return (
    <div
      className="course-scope flex min-h-full flex-col"
      style={{ '--course-color': offering.courseColor } as React.CSSProperties}
    >
      <header className="border-hairline bg-surface border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-8 py-4">
          <Link
            href="/faculty"
            className="text-subtle hover:text-ink text-sm transition-colors"
          >
            ← Your courses
          </Link>
          <span className="text-hairline" aria-hidden>
            |
          </span>
          <div className="flex items-baseline gap-2.5">
            <span
              className="font-mono text-[13px] font-medium"
              style={{ color: 'var(--course-color)' }}
            >
              {offering.courseCode}
            </span>
            <span className="text-ink text-sm font-medium">
              {offering.courseTitle}
            </span>
            <span className="text-faint text-xs">
              Section {offering.section} · {offering.termName}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-8 py-8">
        <CourseSidebar offeringId={offeringId} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
