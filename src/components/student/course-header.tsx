import Link from 'next/link';
import type { OfferingSummary } from '@/lib/assignments/queries';

/**
 * The tinted header every course screen wears (SPEC.md §3.2), plus a
 * CONTEXTUAL back label — "← Operating Systems", never a generic "Back".
 *
 * That is not decoration. On a phone, three taps deep, "Back" tells you nothing
 * about where you are about to land; the course name tells you exactly.
 */
export function CourseHeader({
  offering,
  title,
  backHref,
  backLabel,
}: {
  offering: OfferingSummary;
  title?: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <header
      className="course-scope border-b"
      style={
        {
          '--course-color': offering.courseColor,
          background: 'var(--course-wash)',
          borderColor: 'var(--course-wash-border)',
        } as React.CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-md px-5 pt-4 pb-5">
        <Link
          href={backHref}
          className="text-ink-muted hover:text-ink -ml-1 inline-block py-1 text-sm transition-colors"
        >
          ← {backLabel}
        </Link>

        <p
          className="mt-3 font-mono text-[13px] font-medium tracking-wide"
          style={{ color: 'var(--course-color)' }}
        >
          {offering.courseCode}
        </p>
        <h1 className="text-ink mt-0.5 text-xl font-semibold tracking-tight">
          {title ?? offering.courseTitle}
        </h1>
        {title ? (
          <p className="text-ink-muted mt-0.5 text-sm">{offering.courseTitle}</p>
        ) : (
          <p className="text-subtle mt-1 text-xs">
            Section {offering.section} · {offering.termName}
          </p>
        )}
      </div>
    </header>
  );
}
