import {
  formatTime,
  formatWeekdayDay,
  startOfDayInZone,
} from '@/lib/format';

/**
 * To-Do's time buckets — SPEC.md §3.1.
 *
 * Pure, and separated from the query, because the interesting bugs here are all
 * at boundaries: something due at 11:59 pm tonight belongs in Today, and
 * something due at 12:01 am tomorrow does not. Those are assertions about a
 * function, not about a screen.
 *
 * EVERY BOUNDARY IS COMPUTED IN THE INSTITUTION'S TIMEZONE. "Today" is a
 * calendar day where the student is, not where the server is — and on Vercel
 * the server is in UTC, which would put every Indian evening deadline into
 * "tomorrow" for five and a half hours a day.
 */
export type BucketKey = 'overdue' | 'today' | 'week' | 'later';

export const BUCKETS: Array<{ key: BucketKey; title: string }> = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'today', title: 'Today' },
  { key: 'week', title: 'This week' },
  { key: 'later', title: 'Later' },
];

/**
 * WHAT "THIS WEEK" MEANS — a decision, because SPEC.md §3.1 names the bucket
 * and never defines it.
 *
 * Taken as "the next seven days" rather than "until Sunday". The calendar-week
 * reading collapses to almost nothing by Friday, so a student checking on a
 * Saturday would see an empty This Week and a full Later, which is the opposite
 * of useful. Seven days is a constant horizon and reads the same on every day of
 * the week. Flagged in the report as a spec gap.
 */
const WEEK_DAYS = 7;

export type Bucketed<T> = { key: BucketKey; title: string; items: T[] };

export function bucketFor(
  dueAt: Date,
  now: Date,
  timeZone: string,
): BucketKey {
  if (dueAt < now) return 'overdue';

  // Start of TOMORROW in the institution's zone. Anything before it and not
  // already past is due today — which is what makes 11:59 pm tonight "Today"
  // and 12:01 am tomorrow not.
  const tomorrow = startOfDayInZone(now, timeZone, 1);
  if (dueAt < tomorrow) return 'today';

  if (dueAt < startOfDayInZone(now, timeZone, WEEK_DAYS)) return 'week';
  return 'later';
}

/**
 * Group items into buckets, dropping empty ones.
 *
 * Empty buckets do not render — no "Today (0)" headers. A bucket that appears
 * only when it has something in it is what lets the headers carry the urgency
 * instead of colour, which is the whole reason rust is reserved for Overdue.
 */
export function bucketBy<T>(
  items: T[],
  dueAtOf: (item: T) => Date,
  now: Date,
  timeZone: string,
): Bucketed<T>[] {
  const grouped = new Map<BucketKey, T[]>();
  for (const item of items) {
    const key = bucketFor(dueAtOf(item), now, timeZone);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }

  return BUCKETS.map((b) => ({
    ...b,
    items: (grouped.get(b.key) ?? []).sort(
      (a, z) => dueAtOf(a).getTime() - dueAtOf(z).getTime(),
    ),
  })).filter((b) => b.items.length > 0);
}

/**
 * The deadline, phrased for the bucket it is in.
 *
 * A date is not information on its own — "Due 2 Aug" makes a student do the
 * arithmetic. The bucket already says roughly when; this says exactly, in the
 * shortest form that is still unambiguous inside that bucket.
 */
export function deadlineLabel(
  dueAt: Date,
  now: Date,
  timeZone: string,
): string {
  switch (bucketFor(dueAt, now, timeZone)) {
    case 'overdue': {
      // Whole days between the two calendar dates, so "yesterday at 11pm" reads
      // as 1 day rather than 0 because fewer than 24 hours have passed.
      const days = Math.round(
        (startOfDayInZone(now, timeZone).getTime() -
          startOfDayInZone(dueAt, timeZone).getTime()) /
          86_400_000,
      );
      if (days <= 0) return `Overdue · was due ${formatTime(dueAt, timeZone)}`;
      return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`;
    }
    case 'today':
      return `Due today, ${formatTime(dueAt, timeZone)}`;
    default:
      return `Due ${formatWeekdayDay(dueAt, timeZone)}, ${formatTime(dueAt, timeZone)}`;
  }
}
