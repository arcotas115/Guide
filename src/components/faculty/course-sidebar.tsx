'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The course workspace sidebar (SPEC.md §3.5).
 *
 * Every section is listed, but only Assignments works this session. The rest
 * are rendered as visibly inert rather than as links that 404 — a dead link
 * reads as a bug, a greyed item reads as "not yet", and the difference is
 * whether the professor trusts the rest of the app.
 */
const SECTIONS = [
  { slug: 'info', label: 'Course info' },
  { slug: 'assignments', label: 'Assignments', live: true },
  { slug: 'submissions', label: 'Submissions' },
  { slug: 'announcements', label: 'Announcements' },
  { slug: 'files', label: 'Files' },
  { slug: 'attendance', label: 'Attendance' },
  { slug: 'teams', label: 'Teams' },
  { slug: 'roster', label: 'Roster' },
] as const;

export function CourseSidebar({ offeringId }: { offeringId: string }) {
  const pathname = usePathname();

  return (
    <nav className="w-52 shrink-0" aria-label="Course sections">
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => {
          const href = `/faculty/courses/${offeringId}/${section.slug}`;
          const isActive = pathname.startsWith(href);

          if (!('live' in section)) {
            return (
              <li key={section.slug}>
                <span
                  className="text-faint block cursor-default rounded-md px-3 py-2 text-sm"
                  title="Coming in a later milestone"
                >
                  {section.label}
                </span>
              </li>
            );
          }

          return (
            <li key={section.slug}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'text-ink block rounded-md px-3 py-2 text-sm font-medium'
                    : 'text-ink-muted hover:text-ink hover:bg-hairline-soft block rounded-md px-3 py-2 text-sm transition-colors'
                }
                style={
                  isActive
                    ? { background: 'var(--course-tint)' }
                    : undefined
                }
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
