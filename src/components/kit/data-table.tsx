import { cn } from '@/lib/utils';

/**
 * Faculty data table — DESIGN.md §6.
 *
 * WHY THIS IS ONE TABLE AND NOT ONE PER GROUP.
 * The previous version rendered a separate <table> for each group, each with
 * its own <thead>. HTML tables size their columns from their own content, so
 * three tables produced three different sets of column positions and the header
 * lined up with at most one of them. DESIGN.md calls that "the most visible
 * possible defect", and it is not fixable by adjusting widths — it is fixable
 * only by there being one table.
 *
 * So: one <table>, one <colgroup> that fixes the geometry, `table-fixed` so the
 * browser honours it, and group headers as full-width rows INSIDE the body.
 */

export type Column = {
  /** Mono uppercase label, per DESIGN.md §6. */
  label: string;
  /** Any CSS width. The first column should be left flexible. */
  width?: string;
  align?: 'left' | 'right';
};

export function DataTable({
  columns,
  children,
}: {
  columns: Column[];
  children: React.ReactNode;
}) {
  return (
    <div className="border-card-border bg-card overflow-hidden rounded-xl border">
      {/* Wide tables scroll inside their own container rather than pushing the
          page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {columns.map((c) => (
              <col key={c.label} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-card-border bg-canvas border-b">
              {columns.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  className={cn(
                    'eyebrow text-ink-faint px-5 py-3 font-normal',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A group band inside the table: name on the left, count on the right, with an
 * optional one-line explanation beneath.
 *
 * The count is a separate element with its own cell — `{title}{count}` is what
 * produced `WAITING ON YOU4`.
 */
export function TableGroupHeader({
  title,
  count,
  hint,
  span,
}: {
  title: string;
  count: number;
  hint?: string | null;
  span: number;
}) {
  return (
    <tr className="border-card-border bg-canvas/70 border-y">
      <td colSpan={span} className="px-5 py-2.5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span className="eyebrow text-ink-muted">{title}</span>
            {hint ? (
              <span className="text-ink-faint text-[12px]">{hint}</span>
            ) : null}
          </div>
          <span className="text-ink-faint font-mono text-[11px] tabular-nums">
            {count} {count === 1 ? 'item' : 'items'}
          </span>
        </div>
      </td>
    </tr>
  );
}

export function TableRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        'border-card-border hover:bg-canvas/60 border-b transition-colors last:border-b-0',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={cn(
        'px-5 py-4 align-top',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * A small status pill: Open / Closed / Draft.
 * `tone` never includes rust — an assignment's own lifecycle is not urgency.
 */
export function StatePill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'course' | 'quiet';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2.5 py-1 text-[12.5px] font-medium',
        tone === 'neutral' && 'bg-canvas text-ink-muted border-card-border border',
        tone === 'quiet' && 'bg-canvas text-ink-faint border-card-border border',
      )}
      style={
        tone === 'course'
          ? {
              background: 'var(--course-tint, var(--canvas))',
              color: 'var(--course-color, var(--ink))',
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}
