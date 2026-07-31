import { cn } from '@/lib/utils';

/**
 * Surfaces and text primitives — DESIGN.md §1, §2, §6.
 *
 * These exist so that "a card" is one decision made once. Every screen that
 * hand-rolled `bg-card border rounded-xl` was a screen that could drift, and
 * four screens drifting in four directions is how a design system dies.
 */

/** A card or a row group. Radius 12, 1px card border, never white. */
export function Card({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-card border-card-border overflow-hidden rounded-xl border',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Mono uppercase metadata: ABOUT THIS COURSE, WHAT TO DO, column labels.
 * 10px / .13em, per DESIGN.md §2.
 */
export function Eyebrow({
  className,
  children,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p className={cn('eyebrow text-faint', className)} {...props}>
      {children}
    </p>
  );
}

/**
 * The disclosure chevron on a tappable row.
 *
 * Inside a `.course-scope` it sits on the course tint; outside one it falls
 * back to the canvas. The colour-mix fallback is what lets the same component
 * work on the student course screen and the faculty list without a prop.
 */
export function Chevron({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'text-chevron flex size-7 shrink-0 items-center justify-center rounded-lg text-sm leading-none',
        className,
      )}
      style={{ background: 'var(--course-tint, var(--canvas))' }}
    >
      ›
    </span>
  );
}

/**
 * A section row: title, a one-line subtitle carrying live state, a chevron.
 *
 * `urgent` is the ONLY route to rust on a row (DESIGN.md §5) and it colours the
 * subtitle alone — never the title, never the whole row. An overdue assignment
 * is still an assignment; only its status is shouting.
 */
export function SectionRow({
  title,
  subtitle,
  urgent = false,
  muted = false,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  urgent?: boolean;
  /** Not yet built. Dimmed, no chevron — "not yet", not "broken". */
  muted?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[15.5px] leading-tight font-semibold tracking-[-0.02em]',
            muted ? 'text-faint' : 'text-ink',
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p
            className={cn(
              'mt-1 text-[13.5px] leading-snug',
              urgent ? 'text-rust' : 'text-subtle',
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {trailing ?? (muted ? null : <Chevron />)}
    </div>
  );
}

/**
 * Designed, never blank, never nagging (DESIGN.md §6).
 *
 * Note there is no "next up" tease here on purpose: a rest state that dangles
 * the following deadline is not a rest state.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="px-6 py-14 text-center">
      <p className="text-ink text-[15.5px] font-semibold tracking-[-0.02em]">
        {title}
      </p>
      {body ? (
        <p className="text-subtle mx-auto mt-2 max-w-sm text-[14px] leading-relaxed">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </Card>
  );
}
