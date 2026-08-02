import { cn } from '@/lib/utils';
import type { AssignmentState } from '@/lib/assignments/state';

/**
 * The persistent receipt — SPEC.md §3.3.
 *
 * Once a student submits, this appears EVERYWHERE that assignment is rendered,
 * so they never have to wonder whether it went through. One component driven by
 * the derived state, not three separate conditionals in three files that drift
 * apart the first time one of them is edited.
 *
 * QUIET. It is reassurance, not celebration: small, green, no animation, no
 * exclamation. A student who has submitted should feel able to stop thinking
 * about it — which is the opposite of being congratulated every time they scroll
 * past.
 */
export function SubmittedTick({
  state,
  className,
}: {
  state: AssignmentState;
  className?: string;
}) {
  // Graded work was also submitted, so the receipt holds there too — the mark
  // replaces it in the UI only where a mark is actually shown.
  if (state !== 'submitted' && state !== 'graded') return null;

  return (
    <span
      className={cn(
        'bg-moss-bg text-moss-deep flex size-7 shrink-0 items-center justify-center rounded-full text-[13px]',
        className,
      )}
      title="Submitted"
      aria-label="Submitted"
    >
      ✓
    </span>
  );
}
