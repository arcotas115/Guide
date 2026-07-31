/**
 * Date and time formatting.
 *
 * TIMEZONE — a known gap, flagged rather than hidden.
 * Every screen renders on the server, so without a fixed zone the same deadline
 * reads differently depending on where the server happens to run — a Vercel
 * region change would silently shift every due date. So the zone is pinned.
 *
 * It is pinned to a CONSTANT, which is a compromise: BUILD_RULES.md rule 7 says
 * institution-specific rules live in config tables, and a timezone plainly is
 * one. SPEC.md §4 has no column for it. India is a single timezone so this is
 * correct for every pilot institution and stays correct for the target market —
 * but the day Campus runs a college outside IST, this becomes
 * `institutions.timezone` and every call site already goes through here.
 */
const ZONE = 'Asia/Kolkata';
const LOCALE = 'en-IN';

/** "12 Aug" — or "12 Aug 2025" when the year is not the current one. */
export function formatDay(date: Date, now: Date = new Date()): string {
  const sameYear =
    new Intl.DateTimeFormat(LOCALE, { timeZone: ZONE, year: 'numeric' }).format(
      date,
    ) ===
    new Intl.DateTimeFormat(LOCALE, { timeZone: ZONE, year: 'numeric' }).format(
      now,
    );

  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** "12 Aug, 11:59 pm" — the full deadline, for detail screens. */
export function formatDateTime(date: Date, now: Date = new Date()): string {
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();

  return `${formatDay(date, now)}, ${time}`;
}

/**
 * The value an `<input type="datetime-local">` expects: "YYYY-MM-DDTHH:mm",
 * expressed in the institution's zone rather than the browser's.
 *
 * Without this the edit form would show a professor in a different zone a
 * different time from the one students see, and saving would move the deadline.
 */
export function toDateTimeLocalValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
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
 * which is UTC on Vercel — a 5.5 hour error on every deadline a professor sets,
 * and one that looks fine in local development.
 */
export function fromDateTimeLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi] = match.map(Number) as unknown as number[];
  // Start from the UTC interpretation, then correct by the zone's offset at
  // that moment (which handles any future DST rule without hardcoding +5:30).
  const asUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const offset = zoneOffsetMs(new Date(asUtc));
  const result = new Date(asUtc - offset);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** How far ahead of UTC the institution's zone is, at a given instant. */
function zoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
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
