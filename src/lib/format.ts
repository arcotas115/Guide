/**
 * Date and time formatting, in the INSTITUTION'S timezone.
 *
 * Every function that renders or interprets a wall-clock time takes `timeZone`
 * as a required argument. That is deliberate and slightly inconvenient: a
 * default would compile everywhere and silently show Indian time to a college
 * in Dubai, which is precisely the class of bug that is invisible until a real
 * user complains about a deadline.
 *
 * The zone comes from `institutions.timezone` (see src/lib/timezone.ts), which
 * every server page already has via the signed-in profile.
 *
 * Why it must be pinned at all: these screens render on the server, so without
 * an explicit zone the same deadline reads differently depending on which
 * region the server happens to run in — a Vercel region change would move every
 * due date in the product.
 */
const LOCALE = 'en-IN';

/** "12 Aug" — or "12 Aug 2025" when the year is not the current one. */
export function formatDay(
  date: Date,
  timeZone: string,
  now: Date = new Date(),
): string {
  const year = (d: Date) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone, year: 'numeric' }).format(d);

  const sameYear = year(date) === year(now);

  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** "12 Aug, 11:59 pm" — the full deadline, for detail screens. */
export function formatDateTime(
  date: Date,
  timeZone: string,
  now: Date = new Date(),
): string {
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();

  return `${formatDay(date, timeZone, now)}, ${time}`;
}

/**
 * Is this a well-formed `datetime-local` value?
 *
 * Zone-free on purpose. Whether "2026-08-12T23:59" is SHAPED like a datetime
 * does not depend on where you are, and this is the check the zod schema runs —
 * a schema that also runs in the browser, which has no institution row. Keeping
 * validity separate from interpretation is what lets that schema stay
 * zone-agnostic.
 */
export function isValidDateTimeLocal(value: string): boolean {
  return parseDateTimeLocal(value) !== null;
}

function parseDateTimeLocal(
  value: string,
): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31) return null;
  if (h! > 23 || mi! > 59) return null;
  return { y: y!, mo: mo!, d: d!, h: h!, mi: mi! };
}

/**
 * The value an `<input type="datetime-local">` expects — "YYYY-MM-DDTHH:mm" —
 * expressed in the institution's zone rather than the browser's or the
 * server's.
 *
 * Without this, an edit form would show a professor a different time from the
 * one their students see, and saving would silently move the deadline.
 */
export function toDateTimeLocalValue(date: Date, timeZone: string): string {
  // Intl throws RangeError on an invalid Date. A form field is not worth a 500,
  // and an empty input is the honest rendering of a value we cannot read.
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  // en-CA gives hour "24" for midnight; datetime-local needs "00".
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * The inverse: read a "YYYY-MM-DDTHH:mm" string as a wall-clock time in the
 * institution's zone and return the correct instant.
 *
 * `new Date("2026-08-12T23:59")` interprets the string in the SERVER's zone,
 * which is UTC on Vercel — hours of error on every deadline a professor sets,
 * and one that looks perfectly fine in local development.
 */
export function fromDateTimeLocalValue(
  value: string,
  timeZone: string,
): Date | null {
  const p = parseDateTimeLocal(value);
  if (!p) return null;

  // Start from the UTC interpretation, then correct by the zone's offset at
  // that moment — which handles DST wherever it applies without hardcoding one.
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  const result = new Date(asUtc - zoneOffsetMs(new Date(asUtc), timeZone));
  return Number.isNaN(result.getTime()) ? null : result;
}

/** How far ahead of UTC the given zone is, at a given instant. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = get('hour') === 24 ? 0 : get('hour');

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asIfUtc - at.getTime();
}

/**
 * Midnight at the start of a day, N days from `at`, in the institution's zone.
 *
 * The arithmetic is done on the CALENDAR DATE and only then converted to an
 * instant. Adding `n * 86_400_000` milliseconds instead would be wrong across
 * any daylight-saving transition: a "day" is 23 or 25 hours twice a year in
 * most of the world, and To-Do's buckets are exactly the kind of thing that
 * would be quietly off by an hour for one day each spring.
 *
 * India has no DST, so this is currently indistinguishable — which is precisely
 * why it is worth getting right now rather than when the second country arrives.
 */
export function startOfDayInZone(
  at: Date,
  timeZone: string,
  addDays = 0,
): Date {
  const [y, m, d] = toDateTimeLocalValue(at, timeZone)
    .slice(0, 10)
    .split('-')
    .map(Number) as [number, number, number];

  // Date.UTC normalises overflow (32 January becomes 1 February), so this
  // needs no month-length or leap-year handling of its own.
  const shifted = new Date(Date.UTC(y, m - 1, d + addDays));
  const iso = shifted.toISOString().slice(0, 10);

  return fromDateTimeLocalValue(`${iso}T00:00`, timeZone)!;
}

/**
 * "Sat 2 Aug" — a weekday and date, for a deadline further out than today.
 *
 * en-IN renders this as "Sat, 2 Aug". The comma is dropped because the line it
 * appears in already has one ("Due Sat 2 Aug, 6:00 pm") and two commas in six
 * words reads like a list rather than a date.
 */
export function formatWeekdayDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(date)
    .replace(/,\s*/, ' ');
}

/** "11:59 pm" on its own, for when the day is already established by context. */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();
}
