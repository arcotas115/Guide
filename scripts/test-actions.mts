/**
 * Action-level tests — `npm run test:actions`.
 *
 * WHY THIS SUITE EXISTS.
 * Ninety-six assertions passed while it was impossible to create an assignment.
 * Every one of them sat BELOW the form: the database, the policies, and
 * deriveAssignmentState(). Nothing exercised the path a professor actually
 * takes, so nothing noticed that the client sent `marks: 20` and the server
 * demanded `marks: "20"`.
 *
 * This suite closes that gap end to end:
 *
 *   the exact payload react-hook-form submits
 *        -> prepareAssignmentWrite()   (the real validate/coerce/row pipeline)
 *        -> INSERT/UPDATE on real Postgres, as the professor, with RLS on
 *
 * Everything between the browser and the row is covered. What is deliberately
 * not covered is the request plumbing itself (cookies, redirect), which needs a
 * running server and has no branching logic worth asserting.
 *
 * PGlite is real Postgres compiled to WASM — the migrations, constraints and
 * policies below are the ones that ship, not a mock of them.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAssignmentWrite } from '../src/lib/assignments/prepare';
import { assignmentFormSchema } from '../src/lib/assignments/schema';
import { defaultAssignmentValues } from '../src/lib/assignments/defaults';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (f: string) =>
  readFileSync(join(here, '..', 'supabase', 'migrations', f), 'utf8');

const db = new PGlite();

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable
    as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  create role authenticated;
  create role anon;
  create role service_role bypassrls;
`);

for (const f of [
  '0001_init_schema.sql',
  '0002_rls_policies.sql',
  '0003_grants.sql',
  '0004_assignment_fields_and_grade_split.sql',
  '0003_grants.sql',
]) {
  await db.exec(migration(f));
}

// --- harness ---------------------------------------------------------------
let passed = 0;
let failed = 0;

function ok(label: string, detail?: string) {
  passed++;
  console.log(
    `  \x1b[32m✓\x1b[0m ${label}${detail ? ` \x1b[2m(${detail})\x1b[0m` : ''}`,
  );
}
function bad(label: string, why: string) {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}\n      ${why}`);
}
function check(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) ok(label);
  else bad(label, `expected ${String(expected)}, got ${String(actual)}`);
}

const ids = {
  inst: crypto.randomUUID(),
  dept: crypto.randomUUID(),
  term: crypto.randomUUID(),
  course: crypto.randomUUID(),
  offering: crypto.randomUUID(),
  prof: crypto.randomUUID(),
  otherProf: crypto.randomUUID(),
};

for (const [key, email] of [
  [ids.prof, 'prof@test.edu'],
  [ids.otherProf, 'other@test.edu'],
] as const) {
  await db.query(`insert into auth.users (id, email) values ($1,$2)`, [
    key,
    email,
  ]);
}

await db.query(
  `insert into public.institutions (id, name, slug) values ($1,'Test College','test')`,
  [ids.inst],
);
await db.query(
  `insert into public.departments (id, institution_id, name, code) values ($1,$2,'CSE','CSE')`,
  [ids.dept, ids.inst],
);
await db.query(
  `insert into public.profiles (id, institution_id, department_id, role, full_name, email) values
     ($1,$2,$3,'faculty','Prof One','prof@test.edu'),
     ($4,$2,$3,'faculty','Prof Two','other@test.edu')`,
  [ids.prof, ids.inst, ids.dept, ids.otherProf],
);
await db.query(
  `insert into public.terms (id, institution_id, name, starts_on, ends_on)
     values ($1,$2,'Odd 2026','2026-07-01','2026-12-15')`,
  [ids.term, ids.inst],
);
await db.query(
  `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
     values ($1,$2,$3,'CS301','Operating Systems',4,'#4C5BD4')`,
  [ids.course, ids.inst, ids.dept],
);
await db.query(
  `insert into public.course_offerings (id, institution_id, course_id, term_id, section)
     values ($1,$2,$3,$4,'A')`,
  [ids.offering, ids.inst, ids.course, ids.term],
);
await db.query(
  `insert into public.teaching_assignments (institution_id, offering_id, faculty_id)
     values ($1,$2,$3)`,
  [ids.inst, ids.offering, ids.prof],
);

/** Run as a signed-in user, with RLS enforced exactly as it is for a browser. */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated;`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
    userId,
  ]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

/**
 * The whole create path, exactly as the action runs it: prepare the payload,
 * then insert as the professor with policies live.
 */
async function runCreate(intent: unknown, payload: unknown, actor = ids.prof) {
  const prep = prepareAssignmentWrite(intent, payload);
  if (!prep.ok) return { stage: 'validation' as const, state: prep.state };

  const { status, row } = prep.prepared;
  const cols = ['institution_id', 'offering_id', 'created_by', 'status', ...Object.keys(row)];
  const vals = [ids.inst, ids.offering, actor, status, ...Object.values(row)];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');

  try {
    const res = await asUser(actor, () =>
      db.query<{ id: string }>(
        `insert into public.assignments (${cols.join(',')}) values (${placeholders}) returning id`,
        vals,
      ),
    );
    const id = res.rows[0]?.id;
    if (!id) return { stage: 'rls' as const, message: 'insert affected no rows' };
    return { stage: 'inserted' as const, id, status, row };
  } catch (e) {
    return { stage: 'database' as const, message: (e as Error).message };
  }
}

async function runUpdate(
  assignmentId: string,
  intent: unknown,
  payload: unknown,
  actor = ids.prof,
) {
  const prep = prepareAssignmentWrite(intent, payload);
  if (!prep.ok) return { stage: 'validation' as const, state: prep.state };

  const { status, row } = prep.prepared;
  const entries = Object.entries(row);
  const sets = ['status', ...entries.map(([k]) => k)]
    .map((k, i) => `${k} = $${i + 1}`)
    .join(', ');
  const vals = [status, ...entries.map(([, v]) => v), assignmentId, ids.inst];

  try {
    const res = await asUser(actor, () =>
      db.query(
        `update public.assignments set ${sets}
           where id = $${vals.length - 1} and institution_id = $${vals.length}`,
        vals,
      ),
    );
    return {
      stage: 'updated' as const,
      affected: res.affectedRows ?? 0,
      status,
      row,
    };
  } catch (e) {
    return { stage: 'database' as const, message: (e as Error).message };
  }
}

/** Assert a payload is rejected, on the right field, with a human sentence. */
function expectRejected(
  label: string,
  result: Awaited<ReturnType<typeof runCreate>>,
  field: string,
  expectedMessage: string,
) {
  if (result.stage !== 'validation') {
    bad(label, `expected validation to reject it, but it reached "${result.stage}"`);
    return;
  }
  const actual = result.state.fieldErrors[field];
  if (!actual) {
    bad(
      label,
      `no error on "${field}" — got ${JSON.stringify(result.state.fieldErrors)}`,
    );
    return;
  }
  if (actual !== expectedMessage) {
    bad(label, `message on "${field}" was:\n        "${actual}"\n      expected:\n        "${expectedMessage}"`);
    return;
  }
  ok(label, actual);
}

// The payload react-hook-form produces AFTER its client-side parse — the shape
// that actually crosses the wire to the server action.
const asSubmitted = (over: Record<string, unknown> = {}) => {
  const base = assignmentFormSchema.parse({
    ...defaultAssignmentValues(new Date('2026-07-31T12:00:00+05:30')),
    title: 'Lab 6 — Deadlock detection',
    instructions: 'Implement a wait-for graph and detect cycles.',
    dueAt: '2026-08-12T23:59',
  });
  return { ...base, ...over };
};

// The raw shape the DOM holds, before any parse — every field a string.
const asTyped = (over: Record<string, unknown> = {}) => ({
  title: 'Lab 6 — Deadlock detection',
  instructions: 'Implement a wait-for graph and detect cycles.',
  marks: '20',
  opensAt: '',
  dueAt: '2026-08-12T23:59',
  allowLate: true,
  lateUntil: '',
  latePenaltyPctPerDay: '10',
  hideNamesWhileGrading: false,
  acceptFile: true,
  acceptLink: true,
  acceptText: true,
  ...over,
});

// ===========================================================================
console.log('\n\x1b[1mIDEMPOTENCY — the schema must parse its own output\x1b[0m');
// This is the property whose absence broke assignment creation. react-hook-form
// validates on the client and sends the RESULT to the server, which validates
// again — so parse(parse(x)) has to equal parse(x), field for field.
{
  const first = assignmentFormSchema.safeParse(asTyped());
  check('a typed payload parses', first.success, true);

  if (first.success) {
    const second = assignmentFormSchema.safeParse(first.data);
    check('...and its OUTPUT parses too (this was the bug)', second.success, true);

    if (second.success) {
      const a = first.data as Record<string, unknown>;
      const b = second.data as Record<string, unknown>;
      const drifted = Object.keys(a).filter(
        (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
      );
      check(
        `...and every field is stable${drifted.length ? ` (drifted: ${drifted.join(', ')})` : ''}`,
        drifted.length,
        0,
      );
      // Named explicitly, because these are the two that were broken.
      check('marks coerces to a number', typeof b.marks, 'number');
      check('penalty coerces to a number', typeof b.latePenaltyPctPerDay, 'number');
    }
  }
}

// Every numeric field must accept both shapes, not just survive a round trip.
for (const [label, payload] of [
  ['marks as a string "20"', asTyped({ marks: '20' })],
  ['marks as a number 20', asTyped({ marks: 20 })],
  ['penalty as a string "10"', asTyped({ latePenaltyPctPerDay: '10' })],
  ['penalty as a number 10', asTyped({ latePenaltyPctPerDay: 10 })],
  ['penalty as a blank string', asTyped({ latePenaltyPctPerDay: '' })],
  ['penalty as the number 0', asTyped({ latePenaltyPctPerDay: 0 })],
] as const) {
  const r = assignmentFormSchema.safeParse(payload);
  check(`accepts ${label}`, r.success, true);
}

// ===========================================================================
console.log('\n\x1b[1mCREATE — the payload the form actually submits\x1b[0m');

const publishedId = await (async () => {
  const r = await runCreate('publish', asSubmitted());
  if (r.stage !== 'inserted') {
    bad('publishing a valid assignment reaches the database', JSON.stringify(r));
    return null;
  }
  ok('publishing a valid assignment reaches the database');
  check('...and its status is open', r.status, 'open');
  return r.id;
})();

{
  const r = await runCreate('draft', asSubmitted({ title: 'A draft' }));
  if (r.stage === 'inserted') {
    ok('saving a draft reaches the database');
    check('...and its status is draft', r.status, 'draft');
  } else {
    bad('saving a draft reaches the database', JSON.stringify(r));
  }
}

{
  // The raw DOM shape must work too — the server must not depend on the client
  // having parsed first, or an action called any other way breaks.
  const r = await runCreate('publish', asTyped({ title: 'Typed straight in' }));
  check(
    'an unparsed (all-strings) payload is accepted by the server',
    r.stage,
    'inserted',
  );
}

{
  const r = await runCreate(
    'publish',
    asSubmitted({ title: 'Not mine' }),
    ids.otherProf,
  );
  check(
    'a professor who does not teach the offering is refused by RLS',
    r.stage === 'database' || r.stage === 'rls',
    true,
  );
}

// ===========================================================================
console.log('\n\x1b[1mCREATE — the ugly payloads, with human messages\x1b[0m');

expectRejected(
  'an empty title',
  await runCreate('publish', asSubmitted({ title: '   ' })),
  'title',
  'Give the assignment a title.',
);
expectRejected(
  'marks left blank',
  await runCreate('publish', asSubmitted({ marks: '' })),
  'marks',
  'Enter the total marks.',
);
expectRejected(
  'marks of zero',
  await runCreate('publish', asSubmitted({ marks: 0 })),
  'marks',
  'Marks must be more than zero.',
);
expectRejected(
  'negative marks',
  await runCreate('publish', asSubmitted({ marks: -5 })),
  'marks',
  'Marks must be more than zero.',
);
expectRejected(
  'marks that are not a number',
  await runCreate('publish', asSubmitted({ marks: 'twenty' })),
  'marks',
  'Enter the marks as a number, like 20.',
);
expectRejected(
  'a due date before the open date',
  await runCreate(
    'publish',
    asSubmitted({ opensAt: '2026-08-20T09:00', dueAt: '2026-08-12T23:59' }),
  ),
  'dueAt',
  'The due date has to be after the assignment opens.',
);
expectRejected(
  'a late-until before the due date',
  await runCreate(
    'publish',
    asSubmitted({ dueAt: '2026-08-12T23:59', lateUntil: '2026-08-10T23:59' }),
  ),
  'lateUntil',
  'The late-until date has to be after the due date.',
);
expectRejected(
  'a late-until while late work is refused',
  await runCreate(
    'publish',
    asSubmitted({ allowLate: false, lateUntil: '2026-08-15T23:59' }),
  ),
  'lateUntil',
  'Turn on “Accept late submissions” first, or clear the late-until date.',
);
expectRejected(
  'a penalty above 100%',
  await runCreate('publish', asSubmitted({ latePenaltyPctPerDay: 150 })),
  'latePenaltyPctPerDay',
  'The penalty has to be between 0 and 100% per day.',
);
expectRejected(
  'a negative penalty',
  await runCreate('publish', asSubmitted({ latePenaltyPctPerDay: -5 })),
  'latePenaltyPctPerDay',
  'The penalty has to be between 0 and 100% per day.',
);
expectRejected(
  'every submission type unchecked',
  await runCreate(
    'publish',
    asSubmitted({ acceptFile: false, acceptLink: false, acceptText: false }),
  ),
  'acceptFile',
  'Pick at least one way for students to submit.',
);
expectRejected(
  'a due date that is not a date',
  await runCreate('publish', asSubmitted({ dueAt: 'sometime next week' })),
  'dueAt',
  'That date and time does not look right.',
);

{
  const r = await runCreate('publish', asSubmitted({ dueAt: '' }));
  expectRejected('no due date at all', r, 'dueAt', 'Pick a due date.');
}

{
  const r = await runCreate('demolish', asSubmitted());
  check(
    'an intent the server does not recognise is refused',
    r.stage === 'validation' && r.state.error === 'That action is not available.',
    true,
  );
}

// No raw zod text may ever reach a professor. Checked over every rejection at
// once rather than trusting each message individually.
{
  const leaks: string[] = [];
  const suspects = [
    'Invalid input',
    'expected string',
    'expected number',
    'Required',
    'Invalid literal',
    'Unrecognized key',
    'undefined',
    'NaN',
  ];
  for (const payload of [
    asSubmitted({ title: '' }),
    asSubmitted({ marks: 'x' }),
    asSubmitted({ marks: null }),
    asSubmitted({ marks: 0 }),
    asSubmitted({ latePenaltyPctPerDay: 'x' }),
    asSubmitted({ latePenaltyPctPerDay: null }),
    asSubmitted({ dueAt: 'x' }),
    asSubmitted({ dueAt: null }),
    asSubmitted({ allowLate: 'yes' }),
    asSubmitted({ acceptFile: 'no' }),
    { nonsense: true },
    null,
  ]) {
    const prep = prepareAssignmentWrite('publish', payload);
    if (prep.ok) continue;
    for (const [field, message] of Object.entries(prep.state.fieldErrors)) {
      if (suspects.some((s) => message.includes(s))) {
        leaks.push(`${field}: ${message}`);
      }
    }
  }
  check(
    `no raw zod text reaches a field message${leaks.length ? ` — ${leaks.join(' | ')}` : ''}`,
    leaks.length,
    0,
  );
}

// ===========================================================================
console.log('\n\x1b[1mEDIT — the same payloads, the same rules\x1b[0m');

if (publishedId) {
  {
    const r = await runUpdate(
      publishedId,
      'publish',
      asSubmitted({ title: 'Lab 6 — renamed', marks: 25 }),
    );
    if (r.stage === 'updated') {
      check('editing a published assignment writes one row', r.affected, 1);
      const { rows } = await db.query<{ title: string; marks: string }>(
        `select title, marks::text as marks from public.assignments where id = $1`,
        [publishedId],
      );
      check('...the title is saved', rows[0]?.title, 'Lab 6 — renamed');
      check('...the marks are saved', rows[0]?.marks, '25.00');
    } else {
      bad('editing a published assignment writes one row', JSON.stringify(r));
    }
  }

  {
    // Unpublishing back to a draft is an ordinary edit, not a special case.
    const r = await runUpdate(publishedId, 'draft', asSubmitted());
    check(
      'an edit can send a published assignment back to draft',
      r.stage === 'updated' && r.status === 'draft',
      true,
    );
    await runUpdate(publishedId, 'publish', asSubmitted());
  }

  {
    const r = await runUpdate(publishedId, 'publish', asSubmitted({ marks: 0 }));
    expectRejected(
      'editing with zero marks is refused before any write',
      r as never,
      'marks',
      'Marks must be more than zero.',
    );
  }

  {
    const r = await runUpdate(
      publishedId,
      'publish',
      asSubmitted({ allowLate: false, lateUntil: '2026-08-15T23:59' }),
    );
    expectRejected(
      'editing into an impossible late window is refused',
      r as never,
      'lateUntil',
      'Turn on “Accept late submissions” first, or clear the late-until date.',
    );
  }

  {
    const r = await runUpdate(
      publishedId,
      'publish',
      asSubmitted({ title: 'Hijacked' }),
      ids.otherProf,
    );
    check(
      'a professor who does not teach it cannot edit it',
      r.stage === 'updated' && r.affected === 0,
      true,
    );
  }
}

// ===========================================================================
console.log('\n\x1b[1mBLANK DATES — null must survive the round trip\x1b[0m');
{
  const r = await runCreate(
    'publish',
    asSubmitted({ title: 'No dates set', opensAt: '', lateUntil: '' }),
  );
  if (r.stage === 'inserted') {
    const { rows } = await db.query<{ opens_at: string | null; late_until: string | null }>(
      `select opens_at, late_until from public.assignments where id = $1`,
      [r.id],
    );
    check('a blank open date is stored as NULL', rows[0]?.opens_at, null);
    check('a blank late-until is stored as NULL', rows[0]?.late_until, null);
  } else {
    bad('an assignment with no optional dates saves', JSON.stringify(r));
  }
}
{
  // Turning off late submissions must clear the window even if the form still
  // holds one — the database refuses the combination, so the row builder has to.
  const prep = prepareAssignmentWrite(
    'publish',
    asTyped({ allowLate: true, lateUntil: '2026-08-15T23:59' }),
  );
  check(
    'a late window is kept when late work is accepted',
    prep.ok && prep.prepared.row.late_until !== null,
    true,
  );
}

// ===========================================================================
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
await db.close();
process.exit(failed ? 1 : 0);
