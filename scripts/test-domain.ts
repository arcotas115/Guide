/**
 * Domain logic tests — `npm run test:domain`.
 *
 * Covers the two pieces of pure logic this milestone turns on:
 *   1. the five derived assignment states (SPEC.md §3.7), and
 *   2. the assignment form's validation rules (acceptance criterion 6),
 * plus the timezone round-trip that both depend on.
 *
 * These are deliberately NOT tested through the UI. "All five states render"
 * is a claim about a function; checking it by looking at a screen tests the
 * screen and the function at once, and tells you nothing useful when it fails.
 */
import {
  deriveAssignmentState,
  facultyGroupFor,
  type AssignmentStateInput,
  type FacultyAssignmentLike,
} from '../src/lib/assignments/state';
import { assignmentFormSchema } from '../src/lib/assignments/schema';
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  formatDay,
  formatDateTime,
} from '../src/lib/format';
import {
  defaultAssignmentValues,
  assignmentToFormValues,
} from '../src/lib/assignments/defaults';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '../src/lib/timezone';
import { bucketFor, bucketBy, deadlineLabel } from '../src/lib/todo/buckets';
import { startOfDayInZone } from '../src/lib/format';

/** The institution's zone. Passed explicitly everywhere, never defaulted — see
 *  the note in src/lib/format.ts about why there is no fallback. */
const IST = DEFAULT_TIME_ZONE;

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(
      `  \x1b[31m✗\x1b[0m ${label}\n      expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

/** Assert the schema rejects, and that it does so on the field a professor
 *  would look at — a correct message on the wrong field is still a bad form. */
function expectInvalid(label: string, input: unknown, onField?: string) {
  const result = assignmentFormSchema.safeParse(input);
  if (result.success) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}\n      expected a validation error, got none`);
    return;
  }
  const issue = result.error.issues[0];
  if (onField && issue?.path[0] !== onField) {
    failed++;
    console.log(
      `  \x1b[31m✗\x1b[0m ${label}\n      error landed on "${String(issue?.path[0])}", expected "${onField}"`,
    );
    return;
  }
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${label} \x1b[2m(${issue?.message})\x1b[0m`);
}

const NOW = new Date('2026-07-31T12:00:00+05:30');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const baseInput: AssignmentStateInput = {
  status: 'open',
  opensAt: days(-5),
  dueAt: days(5),
  allowLate: false,
  lateUntil: null,
  submittedAt: null,
  hasVisibleGrade: false,
};
const state = (patch: Partial<AssignmentStateInput>) =>
  deriveAssignmentState({ ...baseInput, ...patch }, NOW, IST);

// ============================================================================
console.log('\n\x1b[1mDERIVED STATES — the five, and nothing stored\x1b[0m');

check('open: opened, not yet due', state({}).state, 'open');
check('upcoming: opens_at is in the future', state({ opensAt: days(3) }).state, 'upcoming');
check('overdue: past due, nothing submitted', state({ dueAt: days(-1) }).state, 'overdue');
check('submitted: the student has a submission', state({ submittedAt: days(-1) }).state, 'submitted');
check(
  'graded: a grade row is visible (so it is published)',
  state({ submittedAt: days(-3), hasVisibleGrade: true }).state,
  'graded',
);

console.log('\n\x1b[1m...and the precedence between them\x1b[0m');
check(
  'graded outranks overdue — a late-but-marked assignment is not urgent',
  state({ dueAt: days(-9), submittedAt: days(-8), hasVisibleGrade: true }).state,
  'graded',
);
check(
  'submitted outranks overdue — submitting late still means submitted',
  state({ dueAt: days(-2), submittedAt: days(-1) }).state,
  'submitted',
);
check(
  'a submitted assignment is never urgent',
  state({ dueAt: days(-2), submittedAt: days(-1) }).isUrgent,
  false,
);

console.log('\n\x1b[1mRUST IS URGENCY, AND ONLY URGENCY\x1b[0m');
for (const [label, patch] of [
  ['open', {}],
  ['upcoming', { opensAt: days(3) }],
  ['submitted', { submittedAt: days(-1) }],
  ['graded', { hasVisibleGrade: true }],
] as const) {
  check(`${label} is not rust`, state(patch).isUrgent, false);
}
check('overdue IS rust', state({ dueAt: days(-1) }).isUrgent, true);

console.log('\n\x1b[1mLATE WINDOW\x1b[0m');
check(
  'an open late window is surfaced as a date',
  state({ dueAt: days(-1), allowLate: true, lateUntil: days(2) }).acceptingUntil?.getTime(),
  days(2).getTime(),
);
check(
  '...and submission is still allowed',
  state({ dueAt: days(-1), allowLate: true, lateUntil: days(2) }).canSubmit,
  true,
);
check(
  'an EXPIRED late window offers no date',
  state({ dueAt: days(-5), allowLate: true, lateUntil: days(-2) }).acceptingUntil,
  null,
);
check(
  '...and submission is closed',
  state({ dueAt: days(-5), allowLate: true, lateUntil: days(-2) }).canSubmit,
  false,
);
check(
  'allow_late with no end date still accepts (SPEC §4: until closed)',
  state({ dueAt: days(-1), allowLate: true, lateUntil: null, submittedAt: days(-2) }).canSubmit,
  true,
);
check(
  'closing the assignment ends submission regardless of the window',
  state({ status: 'closed', dueAt: days(-1), allowLate: true, lateUntil: days(3) }).canSubmit,
  false,
);

// ============================================================================
console.log('\n\x1b[1mTIMEZONE — deadlines must not move\x1b[0m');
{
  const d = fromDateTimeLocalValue('2026-08-12T23:59', IST);
  check('a datetime-local value parses as IST, not as UTC', d?.toISOString(), '2026-08-12T18:29:00.000Z');
  check('round-trips back to the same wall clock', toDateTimeLocalValue(d!, IST), '2026-08-12T23:59');
  check('midnight round-trips (the 24 vs 00 trap)', toDateTimeLocalValue(fromDateTimeLocalValue('2026-08-12T00:00', IST)!, IST), '2026-08-12T00:00');
  check('a deadline late on the 12th IST still reads "12 Aug"', formatDay(d!, IST, NOW), '12 Aug');
  check('garbage is rejected rather than becoming Invalid Date', fromDateTimeLocalValue('not a date', IST), null);
}

// ============================================================================
console.log('\n\x1b[1mTIMEZONE IS CONFIG, NOT A CONSTANT\x1b[0m');
{
  // One instant. Two institutions. The rendering must differ, or the zone is
  // not actually being read — which is the whole failure this session exists to
  // remove. 2026-08-12T23:59 IST is 2026-08-12T14:29 in New York, still the
  // 12th; 18:29 UTC on the 12th is the 13th in Auckland.
  const deadline = new Date('2026-08-12T18:29:00.000Z');

  check('Kolkata renders it as 12 Aug', formatDay(deadline, 'Asia/Kolkata', NOW), '12 Aug');
  check(
    'New York renders the same instant as 12 Aug too',
    formatDay(deadline, 'America/New_York', NOW),
    '12 Aug',
  );
  check(
    '...but Auckland has already turned over to 13 Aug',
    formatDay(deadline, 'Pacific/Auckland', NOW),
    '13 Aug',
  );

  const kolkata = formatDateTime(deadline, 'Asia/Kolkata', NOW);
  const newYork = formatDateTime(deadline, 'America/New_York', NOW);
  check('the wall-clock time differs between institutions', kolkata !== newYork, true);
  check('...Kolkata sees 11:59 pm', kolkata, '12 Aug, 11:59 pm');
  check('...New York sees 2:29 pm', newYork, '12 Aug, 2:29 pm');

  // A professor typing "23:59" means 23:59 where THEY are. The instant that
  // produces must therefore differ by zone — if it did not, the conversion
  // would be ignoring the argument.
  const istInstant = fromDateTimeLocalValue('2026-08-12T23:59', 'Asia/Kolkata');
  const nycInstant = fromDateTimeLocalValue('2026-08-12T23:59', 'America/New_York');
  check('the same wall clock is a different instant per zone', istInstant!.getTime() !== nycInstant!.getTime(), true);
  check('IST 23:59 is 18:29 UTC', istInstant!.toISOString(), '2026-08-12T18:29:00.000Z');
  check('New York 23:59 is 03:59 UTC the next day', nycInstant!.toISOString(), '2026-08-13T03:59:00.000Z');

  // Round-tripping must be stable in whichever zone it happens.
  for (const zone of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'UTC']) {
    check(
      `${zone} round-trips a wall clock unchanged`,
      toDateTimeLocalValue(fromDateTimeLocalValue('2026-08-12T23:59', zone)!, zone),
      '2026-08-12T23:59',
    );
  }

  // Validation is against Intl — the database that actually renders — not
  // against Postgres's separate zone catalogue.
  check('a real zone validates', isValidTimeZone('Asia/Dubai'), true);
  check('UTC validates', isValidTimeZone('UTC'), true);
  check('a typo does not', isValidTimeZone('Asia/Kolkatta'), false);
  // ICU accepts these; we do not. 'EST' resolves to America/Panama — a fixed
  // -05:00 zone with no DST — so accepting it would make deadlines an hour
  // wrong for half the year with nothing looking broken.
  check('the abbreviation IST does not (ambiguous)', isValidTimeZone('IST'), false);
  check('the abbreviation EST does not (resolves to America/Panama)', isValidTimeZone('EST'), false);
  check('GMT does not', isValidTimeZone('GMT'), false);
  check('a legacy but well-formed alias does', isValidTimeZone('US/Eastern'), true);
  check('an empty string does not', isValidTimeZone(''), false);
  check('untrimmed input does not', isValidTimeZone(' Asia/Kolkata '), false);
}

// ============================================================================
console.log('\n\x1b[1mTO-DO BUCKETS — boundaries, in the institution zone\x1b[0m');
{
  // 12:00 noon IST on 31 July. Every boundary below is a calendar edge WHERE
  // THE STUDENT IS, not where the server is — on Vercel the server is UTC,
  // which would put every Indian evening deadline into "tomorrow" for five and
  // a half hours a day.
  const at = (iso: string) => new Date(iso);
  const b = (iso: string) => bucketFor(at(iso), NOW, IST);

  check('a minute ago is Overdue', b('2026-07-31T11:59:00+05:30'), 'overdue');
  check('later today is Today', b('2026-07-31T18:00:00+05:30'), 'today');

  // THE BOUNDARY THE BRIEF NAMES. 11:59 pm tonight is Today; 12:01 am tomorrow
  // is not.
  check('11:59 pm tonight is Today, not This week', b('2026-07-31T23:59:00+05:30'), 'today');
  check('12:01 am tomorrow is NOT Today', b('2026-08-01T00:01:00+05:30'), 'week');
  check('...and midnight exactly belongs to tomorrow', b('2026-08-01T00:00:00+05:30'), 'week');

  check('six days out is This week', b('2026-08-06T09:00:00+05:30'), 'week');
  check('seven days out has become Later', b('2026-08-07T09:00:00+05:30'), 'later');

  // The same instants read differently in another zone — which is the proof
  // that the zone is actually being used rather than the server's.
  check('11:59 pm IST is Today in Kolkata', bucketFor(at('2026-07-31T23:59:00+05:30'), NOW, 'Asia/Kolkata'), 'today');
  check('...and the SAME instant is still Today in New York (it is 2:29 pm there)',
    bucketFor(at('2026-07-31T23:59:00+05:30'), NOW, 'America/New_York'), 'today');
  check('...but 1 am IST tomorrow is still "today" in New York (3:30 pm)',
    bucketFor(at('2026-08-01T01:00:00+05:30'), NOW, 'America/New_York'), 'today');

  // Empty buckets must not render.
  const grouped = bucketBy(
    [{ d: at('2026-07-30T09:00:00+05:30') }, { d: at('2026-07-31T18:00:00+05:30') }],
    (i) => i.d, NOW, IST,
  );
  check('only non-empty buckets are returned', grouped.length, 2);
  check('...in urgency order, Overdue first', grouped[0]?.key, 'overdue');
  check('...and no "Today (0)" header exists',
    grouped.every((g) => g.items.length > 0), true);

  // Within a bucket, soonest first.
  const sorted = bucketBy(
    [{ d: at('2026-08-05T09:00:00+05:30') }, { d: at('2026-08-03T09:00:00+05:30') }],
    (i) => i.d, NOW, IST,
  );
  check('items inside a bucket are soonest-first',
    sorted[0]?.items[0]?.d.toISOString(), at('2026-08-03T09:00:00+05:30').toISOString());

  // The copy, phrased for the bucket it is in.
  check('an overdue item counts whole days',
    deadlineLabel(at('2026-07-30T23:00:00+05:30'), NOW, IST), 'Overdue by 1 day');
  check('...even when fewer than 24 hours have passed',
    deadlineLabel(at('2026-07-30T13:00:00+05:30'), NOW, IST), 'Overdue by 1 day');
  check('...and today\'s overdue says the time instead',
    deadlineLabel(at('2026-07-31T09:00:00+05:30'), NOW, IST), 'Overdue · was due 9:00 am');
  check('a due-today item names the time',
    deadlineLabel(at('2026-07-31T23:59:00+05:30'), NOW, IST), 'Due today, 11:59 pm');
  check('a later item names the weekday',
    deadlineLabel(at('2026-08-02T18:00:00+05:30'), NOW, IST), 'Due Sun 2 Aug, 6:00 pm');

  // Day arithmetic is on the CALENDAR, not on milliseconds — so a month end
  // and a leap day do not need special handling.
  check('day arithmetic rolls over a month end',
    startOfDayInZone(at('2026-01-31T10:00:00+05:30'), IST, 1).toISOString(),
    at('2026-02-01T00:00:00+05:30').toISOString());
  check('...and handles a leap day',
    startOfDayInZone(at('2028-02-28T10:00:00+05:30'), IST, 1).toISOString(),
    at('2028-02-29T00:00:00+05:30').toISOString());
}

// ============================================================================
console.log('\n\x1b[1mFACULTY GROUPING — derived, never `status`\x1b[0m');
{
  const base: FacultyAssignmentLike = {
    status: 'open',
    opensAt: days(-4),
    dueAt: days(6),
    allowLate: false,
    lateUntil: null,
  };
  const at = (patch: Partial<FacultyAssignmentLike>) =>
    facultyGroupFor({ ...base, ...patch }, NOW);

  // The reported bug: published on 31 Jul, opening 10 Aug, filed under
  // "Waiting on you — open to students, or past due". It was neither.
  check(
    'published but not yet open is Scheduled, not Waiting on you',
    at({ opensAt: days(10) }),
    'scheduled',
  );
  check('open right now is Waiting on you', at({}), 'waiting');
  check(
    'past due and unmarked is still Waiting on you',
    at({ dueAt: days(-2) }),
    'waiting',
  );
  check('a draft is Drafts', at({ status: 'draft' }), 'draft');
  check(
    'a draft that would otherwise be scheduled is still Drafts',
    at({ status: 'draft', opensAt: days(10) }),
    'draft',
  );
  check('closed is Closed', at({ status: 'closed' }), 'closed');
  check(
    'an assignment with no open date is live immediately',
    at({ opensAt: null }),
    'waiting',
  );
}

// ============================================================================
console.log('\n\x1b[1mFORM DEFAULTS — no value the professor did not type\x1b[0m');
{
  const d = defaultAssignmentValues(IST, NOW);
  check('a blank form has no open date', d.opensAt, '');
  check('a blank form has no late-until', d.lateUntil, '');
  // The bug: `due.setHours(23, 59)` applied the SERVER's timezone and then
  // rendered in IST, so this read 09:29 on one machine and something else on
  // another. The default must be 11:59 pm in the institution's zone, wherever
  // the server happens to be.
  check(
    'the default due time is 11:59 pm in IST, not the server zone',
    String(d.dueAt).slice(-6),
    'T23:59',
  );
  check(
    'the default due date is seven days out',
    String(d.dueAt).slice(0, 10),
    '2026-08-07',
  );

  // An assignment stored with NULL dates must produce empty inputs, because
  // the helper text promises exactly that.
  const stored = assignmentToFormValues(
    {
      id: 'x',
      title: 'Lab 4',
      instructions: null,
      marks: 20,
      opensAt: null,
      dueAt: new Date('2026-08-02T23:59:00+05:30'),
      allowLate: true,
      lateUntil: null,
      latePenaltyPctPerDay: 0,
      hideNamesWhileGrading: false,
      acceptFile: true,
      acceptLink: true,
      acceptText: true,
      allowMultipleAttempts: true,
      status: 'open',
      gradesReleased: false,
    },
    IST,
  );
  check('a stored NULL open date renders as an empty field', stored.opensAt, '');
  check(
    'a stored NULL late-until renders as an empty field',
    stored.lateUntil,
    '',
  );

  // Intl throws on an invalid Date; a form field is not worth a 500.
  check(
    'an unreadable date renders empty rather than crashing the page',
    toDateTimeLocalValue(new Date('nonsense'), IST),
    '',
  );
}

// ============================================================================
console.log('\n\x1b[1mFORM VALIDATION — acceptance criterion 6\x1b[0m');

const validForm = {
  title: 'Lab 6 — Deadlock detection',
  instructions: 'Implement a wait-for graph.',
  marks: '20',
  opensAt: '2026-08-01T09:00',
  dueAt: '2026-08-12T23:59',
  allowLate: true,
  lateUntil: '2026-08-15T23:59',
  latePenaltyPctPerDay: '10',
  hideNamesWhileGrading: false,
  acceptFile: true,
  acceptLink: true,
  acceptText: true,
};

check('a well-formed assignment passes', assignmentFormSchema.safeParse(validForm).success, true);

expectInvalid('an empty title is rejected', { ...validForm, title: '   ' }, 'title');
expectInvalid('zero marks are rejected', { ...validForm, marks: '0' }, 'marks');
expectInvalid('negative marks are rejected', { ...validForm, marks: '-5' }, 'marks');
expectInvalid('non-numeric marks are rejected', { ...validForm, marks: 'twenty' }, 'marks');
expectInvalid('missing marks are rejected as missing, not as zero', { ...validForm, marks: '' }, 'marks');
expectInvalid(
  'a due date before the open date is rejected',
  { ...validForm, opensAt: '2026-08-20T09:00' },
  'dueAt',
);
expectInvalid(
  'a late window ending before the due date is rejected',
  { ...validForm, lateUntil: '2026-08-10T23:59' },
  'lateUntil',
);
expectInvalid(
  'a late window with late submissions turned off is rejected',
  { ...validForm, allowLate: false },
  'lateUntil',
);
expectInvalid(
  'a penalty above 100%/day is rejected',
  { ...validForm, latePenaltyPctPerDay: '150' },
  'latePenaltyPctPerDay',
);
expectInvalid(
  'a negative penalty is rejected',
  { ...validForm, latePenaltyPctPerDay: '-5' },
  'latePenaltyPctPerDay',
);
expectInvalid(
  'removing every submission type is rejected',
  { ...validForm, acceptFile: false, acceptLink: false, acceptText: false },
  'acceptFile',
);

// Things that must NOT be rejected — over-strict validation is its own bug.
check(
  'no penalty (0) is a valid value, not a missing one',
  assignmentFormSchema.safeParse({ ...validForm, latePenaltyPctPerDay: '0' }).success,
  true,
);
check(
  'an open-ended late window (no end date) is allowed',
  assignmentFormSchema.safeParse({ ...validForm, lateUntil: '' }).success,
  true,
);
check(
  'an assignment with no open date is allowed (available immediately)',
  assignmentFormSchema.safeParse({ ...validForm, opensAt: '' }).success,
  true,
);
check(
  'empty instructions are allowed',
  assignmentFormSchema.safeParse({ ...validForm, instructions: '' }).success,
  true,
);

// ============================================================================
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
