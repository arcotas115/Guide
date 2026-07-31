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
import { deriveAssignmentState, type AssignmentStateInput } from '../src/lib/assignments/state';
import { assignmentFormSchema } from '../src/lib/assignments/schema';
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  formatDay,
} from '../src/lib/format';

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
  deriveAssignmentState({ ...baseInput, ...patch }, NOW);

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
  const d = fromDateTimeLocalValue('2026-08-12T23:59');
  check('a datetime-local value parses as IST, not as UTC', d?.toISOString(), '2026-08-12T18:29:00.000Z');
  check('round-trips back to the same wall clock', toDateTimeLocalValue(d!), '2026-08-12T23:59');
  check('midnight round-trips (the 24 vs 00 trap)', toDateTimeLocalValue(fromDateTimeLocalValue('2026-08-12T00:00')!), '2026-08-12T00:00');
  check('a deadline late on the 12th IST still reads "12 Aug"', formatDay(d!, NOW), '12 Aug');
  check('garbage is rejected rather than becoming Invalid Date', fromDateTimeLocalValue('not a date'), null);
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
