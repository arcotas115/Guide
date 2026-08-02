import Link from 'next/link';
import type { OfferingSummary } from '@/lib/assignments/queries';
import { Chevron } from '@/components/kit/surfaces';

/**
 * The canonical course card — DESIGN.md §6.
 *
 * A 15px full-height colour spine on the left edge. NOT a full-colour block and
 * NOT a monogram tile; that was decided during design and is not open for
 * reinterpretation here.
 *
 * Identity only. No due counts — a "3 due" badge turns the home screen into a
 * small dose of dread every time it is opened, and what is due lives in To-Do,
 * where the student goes when they actually want to know.
 */
export function CourseCard({
  offering,
  href,
  subtitle,
}: {
  offering: OfferingSummary;
  href: string;
  /** Professor name on student home; section/term on faculty home. */
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="course-scope bg-card border-card-border block overflow-hidden rounded-xl border transition-shadow hover:shadow-[0_1px_3px_rgba(20,23,26,0.06)]"
      style={{ '--course-color': offering.courseColor } as React.CSSProperties}
    >
      <div className="flex items-stretch">
        {/* The spine. 15px, full height, the course's own colour. */}
        <div
          className="w-[15px] shrink-0"
          style={{ background: 'var(--course-color)' }}
          aria-hidden
        />
        <div className="flex flex-1 items-center gap-4 py-4 pr-4 pl-4">
          <div className="min-w-0 flex-1">
            {/* Three separate stacked elements. Never
                `CS301Operating SystemsSection A` — DESIGN.md §3. */}
            <p className="course-code">{offering.courseCode}</p>
            <p className="row-title text-ink mt-1.5">{offering.courseTitle}</p>
            <p className="text-ink-soft mt-1.5 text-[14px]">{subtitle}</p>
          </div>
          <Chevron />
        </div>
      </div>
    </Link>
  );
}
