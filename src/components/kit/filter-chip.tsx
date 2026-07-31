import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Filter chip — DESIGN.md §6.
 *
 * Three things make it done, and the previous version had none of them:
 * a count beside the label, an unmistakable filled active state, and a border
 * when inactive so it reads as a control rather than as text.
 *
 * The count is not decoration. "Drafts 1" tells a professor whether clicking is
 * worth it; "Drafts" makes them click to find out.
 */
export function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-ink text-canvas font-medium'
          : 'text-ink-muted border-card-border bg-card hover:border-subtle border',
      )}
    >
      <span>{label}</span>
      {/* An explicit element with a gap — never `{label}{count}`, which renders
          as "Drafts1" (DESIGN.md §3). */}
      <span
        className={cn(
          'font-mono text-[11px] tabular-nums',
          active ? 'text-canvas/70' : 'text-faint',
        )}
      >
        {count}
      </span>
    </Link>
  );
}
