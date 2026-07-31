import { z } from 'zod';

/**
 * The institution's timezone — config-as-data (BUILD_RULES rule 7).
 *
 * This used to be a constant pinned to Asia/Kolkata in format.ts. That was the
 * right stopgap for a single-country pilot and the wrong thing to keep: a
 * hardcoded country does not survive a second institution, and retrofitting one
 * onto live timestamps across hundreds of colleges is not a change anyone wants
 * to make.
 */

/**
 * Mirrors the DEFAULT on institutions.timezone.
 *
 * Used by the seed, by the tests, and as the value a new institution starts
 * with. It is deliberately NOT a fallback inside any render path — a screen
 * that cannot find its institution's zone should be a type error, not a screen
 * that quietly shows Indian time to someone in Dubai.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/**
 * Does this zone exist?
 *
 * Checked against Intl rather than against Postgres's pg_timezone_names, and
 * the difference matters: ICU and Postgres ship SEPARATE zone databases, and
 * the one that has to render every timestamp in this product is ICU's. A zone
 * Postgres would accept but Intl does not is still a broken screen, so the
 * consumer is the right authority.
 *
 * The database enforces shape only (see the CHECK in 0005) — a constraint that
 * queries the zone catalogue cannot be immutable, and a non-immutable CHECK
 * turns a tzdata update into a restore failure.
 */
export function isValidTimeZone(zone: string): boolean {
  if (!zone || zone.trim() !== zone) return false;

  // Shape first, and it is not merely cosmetic. ICU happily accepts bare
  // abbreviations, and they resolve to things nobody means:
  //
  //     'IST' -> Asia/Calcutta      (ambiguous: also Irish and Israel time)
  //     'EST' -> America/Panama     (a FIXED -05:00 zone with no DST at all)
  //     'GMT' -> UTC
  //
  // An admin typing "EST" would get deadlines an hour wrong for half the year,
  // and nothing would look broken. Requiring the IANA Region/City form rejects
  // every one of those. It is also the same rule the CHECK in 0005 enforces, so
  // the two layers agree instead of disagreeing quietly.
  if (zone !== 'UTC' && !/^[A-Za-z][A-Za-z_-]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/.test(zone)) {
    return false;
  }

  try {
    // Throws RangeError for an unknown zone. Intl.supportedValuesOf('timeZone')
    // would be tidier but omits legacy aliases like US/Eastern that are still
    // perfectly valid inputs, so this is the more permissive correct check.
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Validate at the door, wherever a human types or imports a zone. */
export const timeZoneSchema = z
  .string({ error: 'Choose a timezone.' })
  .trim()
  .min(1, 'Choose a timezone.')
  .refine(isValidTimeZone, {
    message:
      'That is not a timezone name. Use the IANA form, like “Asia/Kolkata” or “Asia/Dubai”.',
  });
