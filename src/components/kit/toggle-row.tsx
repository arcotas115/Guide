'use client';

import { cn } from '@/lib/utils';

/**
 * A toggle — DESIGN.md §6: "a visible control with a readable on/off state,
 * plus its explanatory line beneath. A label with no control is not a toggle."
 *
 * WHY THIS IS HAND-BUILT rather than shadcn's Switch.
 * The stock Switch draws its off state as `bg-input` with a `bg-background`
 * thumb. Once those are pointed at this palette that is a #D5D2C8 track holding
 * a #FAFAF8 thumb, 32px wide, with no border — technically present, visually
 * absent on a cream card. That is exactly the reported defect. The fix is not a
 * different shade; it is a control with a real border, a real size, and an ON
 * state that is unmistakably a different colour from the OFF state.
 *
 * Built on a plain <button role="switch">, which is fully keyboard-accessible
 * and needs no primitive at all.
 */
export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-5',
        disabled && 'opacity-45',
      )}
    >
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="text-ink block text-[14.5px] leading-snug font-medium"
        >
          {label}
        </label>
        {hint ? (
          <p className="text-subtle mt-1 text-[12.5px] leading-relaxed">
            {hint}
          </p>
        ) : null}
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
          'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          checked
            ? 'border-transparent'
            : 'border-card-border bg-canvas hover:border-subtle',
        )}
        style={
          // ON uses the course colour where there is one, so the control reads
          // as part of the course rather than as a generic system blue.
          checked
            ? { background: 'var(--course-color, var(--ink))' }
            : undefined
        }
      >
        <span
          className={cn(
            'pointer-events-none block size-[18px] rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

/**
 * A multi-select pill group — "What they can submit": Files · A link · Typed
 * text. Same visual language as the filter chips, but these are controls that
 * toggle rather than links that navigate.
 */
export function PillToggle({
  label,
  pressed,
  onChange,
  disabled = false,
  size = 'default',
}: {
  label: string;
  pressed: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** `compact` fits four presets on one row inside the form's right column. */
  size?: 'default' | 'compact';
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
      className={cn(
        'rounded-lg font-medium whitespace-nowrap transition-colors',
        size === 'compact'
          ? 'px-2.5 py-1.5 text-[12.5px]'
          : 'px-3.5 py-2 text-[13.5px]',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        pressed
          ? 'bg-ink text-canvas'
          : 'text-ink-muted border-card-border bg-card hover:border-subtle border',
        disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      {label}
    </button>
  );
}
