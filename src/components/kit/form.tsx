import { cn } from '@/lib/utils';

/**
 * Form primitives — DESIGN.md §6, §7.
 *
 * The explanatory line under a field is part of the design, not filler, so it
 * is a first-class prop rather than something each screen remembers to add.
 * The error replaces it in the same slot, which keeps the layout from jumping
 * as a professor fixes a field.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="text-ink block text-[13.5px] leading-snug font-medium"
      >
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p className="text-rust mt-1.5 text-[12.5px] leading-relaxed">{error}</p>
      ) : hint ? (
        <p className="text-subtle mt-1.5 text-[12.5px] leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A titled panel on the form's right rail: "Marks and dates", "Rules". */
export function FormPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'bg-card border-card-border rounded-xl border p-5',
        className,
      )}
    >
      <h2 className="text-ink text-[15px] font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

/**
 * Text input and textarea, styled on the card colour.
 *
 * Not shadcn's Input: that one renders on `bg-transparent`, which on a cream
 * card gives a field with no fill and only a hairline — legible, but it does
 * not read as somewhere you type.
 */
export const inputClass =
  'w-full rounded-lg border border-card-border bg-canvas px-3 text-[14.5px] text-ink ' +
  'placeholder:text-faint outline-none transition-colors ' +
  'focus-visible:border-subtle focus-visible:ring-2 focus-visible:ring-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

export function TextInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return <input className={cn(inputClass, 'h-11', className)} {...props} />;
}

export function TextArea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(inputClass, 'resize-y py-3 leading-relaxed', className)}
      {...props}
    />
  );
}
