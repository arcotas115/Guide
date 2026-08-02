import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The desktop app shell — DESIGN.md §1, §3.
 *
 * THE PROBLEM IT SOLVES: content was running flush to the left edge of a
 * 2560px monitor. Nothing on a wide screen should ever touch the viewport.
 *
 * The structure is three layers, and each has a job:
 *   page   (#F1EFEA) — the outermost surround. Visible only as a margin on a
 *                      wide monitor, which is what stops the app looking like
 *                      it is falling off the left edge.
 *   canvas (#FAFAF8) — the app surface itself, a centred max-width slab.
 *   card   (#FFFDF8) — everything inside it.
 *
 * Student screens do NOT use this: a phone has no surround to show, and a
 * 390px viewport wants every pixel.
 */
export function DesktopShell({
  topBar,
  sidebar,
  children,
}: {
  topBar: React.ReactNode;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-page min-h-dvh w-full py-0 lg:py-6">
      <div className="bg-canvas border-card-border mx-auto w-full max-w-[1400px] overflow-hidden border-y lg:rounded-2xl lg:border">
        {topBar}
        <div className="flex min-h-[70dvh] items-stretch">
          {sidebar}
          <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

/**
 * The institution bar. Identity on the left, the signed-in person on the right
 * — the same shape on every desktop surface so a professor always knows which
 * college and which account they are looking at.
 */
export function TopBar({
  institutionName,
  surface,
  personName,
  personSubtitle,
  action,
}: {
  institutionName: string;
  surface: string;
  personName: string;
  personSubtitle?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <header className="border-card-border bg-card flex items-center justify-between gap-6 border-b px-6 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-ink text-canvas flex size-8 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold">
          {institutionName.charAt(0)}
        </span>
        <span className="text-ink truncate text-[14.5px] font-semibold tracking-[-0.02em]">
          {institutionName}
        </span>
        <span className="bg-card-border h-5 w-px shrink-0" aria-hidden />
        <span className="text-ink-soft shrink-0 text-[14px]">{surface}</span>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {action}
        <div className="hidden text-right sm:block">
          <p className="text-ink text-[13.5px] font-semibold">{personName}</p>
          {personSubtitle ? (
            <p className="text-ink-soft text-[12.5px]">{personSubtitle}</p>
          ) : null}
        </div>
        <span className="bg-canvas border-card-border text-ink-muted flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-[12px]">
          {initials(personName)}
        </span>
      </div>
    </header>
  );
}

/**
 * The course workspace sidebar column. A fixed narrow rail with its own border
 * — the content column is what centres, not this.
 */
export function SidebarColumn({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <aside className="border-card-border bg-card hidden w-60 shrink-0 border-r md:block">
      {header ? (
        <div className="border-card-border border-b px-5 py-5">{header}</div>
      ) : null}
      <nav className="p-3" aria-label="Course sections">
        {children}
      </nav>
    </aside>
  );
}

/**
 * One sidebar item. Generous padding, an active state on the course tint, and
 * an optional trailing badge.
 *
 * `badgeTone="urgent"` is the only rust on this component, and it means the
 * section needs action — a missing attendance session, not a neutral count.
 */
export function SidebarItem({
  href,
  label,
  active = false,
  badge,
  badgeTone = 'neutral',
  muted = false,
}: {
  href?: string;
  label: string;
  active?: boolean;
  badge?: string | number | null;
  badgeTone?: 'neutral' | 'urgent';
  muted?: boolean;
}) {
  const inner = (
    <span className="flex items-center justify-between gap-3">
      <span className="truncate">{label}</span>
      {badge != null ? (
        <span
          className={cn(
            'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
            badgeTone === 'urgent'
              ? 'bg-rust-bg text-rust'
              : 'bg-canvas text-ink-faint',
          )}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );

  const shared = 'block rounded-lg px-3.5 py-2.5 text-[14px] transition-colors';

  if (muted || !href) {
    return (
      <span
        className={cn(shared, 'text-ink-faint cursor-default')}
        title="Coming in a later milestone"
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        shared,
        active
          ? 'text-ink font-semibold'
          : 'text-ink-muted hover:text-ink hover:bg-canvas',
      )}
      style={active ? { background: 'var(--course-tint, var(--canvas))' } : undefined}
    >
      {inner}
    </Link>
  );
}

function initials(name: string): string {
  return name
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}
