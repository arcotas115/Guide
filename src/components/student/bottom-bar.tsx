'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The five-tab bottom bar — SPEC.md §3.1.
 *
 * All five are rendered, including the three that are not built. A student
 * seeing four tabs now and five later is worse than seeing five, two of which
 * are honest about not being ready: the shape of the app stops changing
 * underneath them, and "coming soon" is a promise while a missing tab is a
 * mystery.
 *
 * NO NOTIFICATION DOT. A dot that is never lit means nothing, and a dot that
 * lights for a feature that does not exist means less. It arrives with
 * Notifications.
 */
type Tab = {
  href: string;
  label: string;
  icon: (props: { filled: boolean }) => React.ReactElement;
  /** Home matches exactly — every other student route starts with /student. */
  exact?: boolean;
};

const TABS: Tab[] = [
  { href: '/student', label: 'Home', icon: HomeIcon, exact: true },
  { href: '/student/calendar', label: 'Calendar', icon: CalendarIcon },
  { href: '/student/todo', label: 'To-Do', icon: CheckIcon },
  { href: '/student/notifications', label: 'Notifications', icon: BellIcon },
  { href: '/student/more', label: 'More', icon: GridIcon },
];

export function BottomBar() {
  const pathname = usePathname();

  return (
    <nav
      className="border-card-border bg-card/95 fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur"
      aria-label="Main"
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 px-1 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] transition-colors',
                  active ? 'text-ink' : 'text-ink-soft',
                )}
              >
                <Icon filled={active} />
                <span
                  className={cn(
                    'text-[10.5px] leading-none',
                    active ? 'font-semibold' : '',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* Inline SVGs rather than an icon package: five icons is not worth a dependency
   that ships hundreds, on a screen students load on mobile data. */

function HomeIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      <path
        d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.12 : 0}
      />
    </svg>
  );
}

function CalendarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      <rect
        x="3" y="5" width="18" height="16" rx="2.5"
        stroke="currentColor" strokeWidth="1.6"
        fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}
      />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      <circle
        cx="12" cy="12" r="9"
        stroke="currentColor" strokeWidth="1.6"
        fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}
      />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BellIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3.5 1 5 1.6 5.8.3.4 0 1.2-.6 1.2H5c-.6 0-.9-.8-.6-1.2C5 14 6 12.5 6 9Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" aria-hidden>
      {[
        [4, 4], [13.5, 4], [4, 13.5], [13.5, 13.5],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`} x={x} y={y} width="6.5" height="6.5" rx="1.8"
          stroke="currentColor" strokeWidth="1.6"
          fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.12 : 0}
        />
      ))}
    </svg>
  );
}
