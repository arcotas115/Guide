import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Buttons — DESIGN.md §6.
 *
 * Primary is near-black on white text with generous vertical padding; secondary
 * is bordered on the card colour.
 *
 * The `disabledReason` prop is the design rule made structural: "Disabled
 * states say what is missing, never just grey out." Passing it both disables
 * the control and prints the reason beneath, so it is not possible to ship a
 * greyed button whose cause is a mystery.
 */
const base =
  'inline-flex items-center justify-center rounded-lg text-[14px] font-medium ' +
  'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

const variants = {
  primary: 'bg-ink text-canvas hover:bg-ink-strong',
  secondary: 'bg-card text-ink border border-card-border hover:border-ink-soft',
  ghost: 'text-ink-muted hover:text-ink hover:bg-canvas',
} as const;

const sizes = {
  default: 'px-4 py-2.5',
  lg: 'px-5 py-3',
  sm: 'px-3 py-1.5 text-[13px]',
} as const;

export function buttonClass({
  variant = 'primary',
  size = 'default',
  fullWidth = false,
}: {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  fullWidth?: boolean;
} = {}) {
  return cn(base, variants[variant], sizes[size], fullWidth && 'w-full');
}

export function Button({
  variant = 'primary',
  size = 'default',
  fullWidth = false,
  disabledReason,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  fullWidth?: boolean;
  /** Why this is unavailable. Supplying it disables the button AND says so. */
  disabledReason?: string | null;
}) {
  const disabled = props.disabled || Boolean(disabledReason);

  return (
    <span className={cn(fullWidth && 'block w-full')}>
      <button
        {...props}
        disabled={disabled}
        className={cn(buttonClass({ variant, size, fullWidth }), className)}
      >
        {children}
      </button>
      {disabledReason ? (
        <span className="text-ink-soft mt-1.5 block text-[12.5px] leading-relaxed">
          {disabledReason}
        </span>
      ) : null}
    </span>
  );
}

/** A link that looks like a button. Separate component because `asChild` does
 *  not exist on this project's shadcn Button. */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'default',
  fullWidth = false,
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(buttonClass({ variant, size, fullWidth }), className)}
    >
      {children}
    </Link>
  );
}
