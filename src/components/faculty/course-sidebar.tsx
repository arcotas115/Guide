'use client';

import { usePathname } from 'next/navigation';
import type { OfferingSummary } from '@/lib/assignments/queries';
import { SidebarColumn, SidebarItem } from '@/components/kit/app-shell';
import { ButtonLink } from '@/components/kit/button';

/**
 * The course workspace sidebar (SPEC.md §3.5).
 *
 * Every section is listed, but only Assignments works this session. The rest
 * render dimmed rather than as links that 404 — a dead link reads as a bug, a
 * greyed item reads as "not yet", and the difference is whether the professor
 * trusts the rest of the app.
 *
 * The badge counts in the prototype (Submissions 16, Files 6, Roster 14) are
 * deliberately absent: there is nothing yet that can count them honestly, and
 * an invented number is worse than none.
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

export function CourseSidebar({ offering }: { offering: OfferingSummary }) {
  const pathname = usePathname();
  const base = `/faculty/courses/${offering.offeringId}`;

  return (
    <SidebarColumn
      header={
        <>
          <ButtonLink href="/faculty" variant="secondary" size="sm">
            ← All courses
          </ButtonLink>
          {/* Explicit stacked elements, never `CS301Operating SystemsSection A`
              — DESIGN.md §3. */}
          <p className="course-code mt-4">{offering.courseCode}</p>
          <p className="row-title text-ink mt-1">{offering.courseTitle}</p>
          <p className="text-subtle mt-1.5 text-[13px]">
            Section {offering.section}
            <span className="text-faint px-1.5">·</span>
            {offering.credits} credits
          </p>
        </>
      }
    >
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => {
          const href = `${base}/${section.slug}`;
          const live = 'live' in section;

          return (
            <li key={section.slug}>
              <SidebarItem
                href={live ? href : undefined}
                label={section.label}
                active={live && pathname.startsWith(href)}
                muted={!live}
              />
            </li>
          );
        })}
      </ul>
    </SidebarColumn>
  );
}
