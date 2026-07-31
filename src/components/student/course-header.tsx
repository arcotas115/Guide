import Link from 'next/link';
import type { OfferingSummary } from '@/lib/assignments/queries';

/**
 * Two tinted headers, one component — DESIGN.md §4.
 *
 * `hub` is the course landing screen: the full course colour under a sheen,
 * white text. `wash` is a subsection screen (Assignments, Grades…): the pale
 * wash with its border. Both say "you are inside this course", at two
 * different volumes, which is the whole point of the tinting system.
 *
 * The back label always NAMES its destination ("← Operating Systems"), never
 * "Back" (DESIGN.md §7). Three screens deep on a phone, "Back" tells you
 * nothing about where you are about to land.
 */
export function CourseHeader({
  offering,
  variant,
  title,
  backHref,
  backLabel,
}: {
  offering: OfferingSummary;
  variant: 'hub' | 'wash';
  /** Subsection name. Omitted on the hub, where the course itself is the title. */
  title?: string;
  backHref: string;
  backLabel: string;
}) {
  const isHub = variant === 'hub';

  return (
    <header
      className={`course-scope ${isHub ? 'course-hub-header' : 'border-b'}`}
      style={
        {
          '--course-color': offering.courseColor,
          ...(isHub
            ? {}
            : {
                background: 'var(--course-wash)',
                borderColor: 'var(--course-wash-border)',
              }),
        } as React.CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-md px-5 pt-4 pb-6">
        <Link
          href={backHref}
          className={
            isHub
              ? 'inline-flex items-center rounded-lg bg-white/18 px-3 py-1.5 text-[14px] font-medium text-white backdrop-blur transition-colors hover:bg-white/28'
              : 'bg-card border-card-border text-ink-muted hover:text-ink inline-flex items-center rounded-lg border px-3 py-1.5 text-[14px] font-medium transition-colors'
          }
        >
          ← {backLabel}
        </Link>

        {isHub ? (
          <>
            {/* Explicit separators between adjacent spans, always. */}
            <p className="mt-4 font-mono text-[12px] tracking-[0.06em] text-white/75">
              {offering.courseCode}
              <span className="px-2">·</span>
              {offering.credits} credits
            </p>
            <h1 className="mt-1 text-[27px] leading-tight font-bold tracking-[-0.03em] text-white">
              {offering.courseTitle}
            </h1>
            <p className="mt-1.5 text-[14.5px] text-white/85">
              Section {offering.section}
              <span className="px-2">·</span>
              {offering.termName}
            </p>
          </>
        ) : (
          <>
            <p className="course-code mt-4 flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: 'var(--course-color)' }}
                aria-hidden
              />
              {offering.courseCode}
            </p>
            <h1 className="screen-title text-ink mt-1.5">{title}</h1>
          </>
        )}
      </div>
    </header>
  );
}
