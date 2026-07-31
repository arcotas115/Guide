// ============================================================================
// RLS verification suite  —  `npm run test:rls`
//
// SPEC.md's quality gate: "RLS verified (a student truly cannot read another
// student's data via the API)". "RLS is enabled" is not that proof. This runs
// the real migrations on a real Postgres (PGlite/WASM), seeds TWO institutions,
// then queries as each user with RLS actually in force and asserts what each
// one can and cannot see.
//
// It touches nothing remote — no Supabase project, no network. Run it before
// every deploy, and after any change to a migration.
//
// It covers both halves of access control, which fail in different ways:
//   0002 — RLS policies: which ROWS a role may touch.
//   0003 — GRANTs: whether it may touch the table at all. Missing grants give
//          "42501 permission denied", which no amount of reading 0002 explains.
// ============================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (f) => readFileSync(join(here, '..', 'migrations', f), 'utf8');

const db = new PGlite();

// --- Supabase surface that PGlite lacks -------------------------------------
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable
    as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  create role authenticated;
  create role anon;
  -- service_role is BYPASSRLS in Supabase; mirroring that here is what makes
  -- 0003's grants meaningful to test rather than merely syntactic.
  create role service_role bypassrls;
`);

await db.exec(migration('0001_init_schema.sql'));
await db.exec(migration('0002_rls_policies.sql'));
await db.exec(migration('0003_grants.sql'));
await db.exec(migration('0004_assignment_fields_and_grade_split.sql'));
// 0004 creates a table, so 0003's ON ALL TABLES snapshot is stale — exactly the
// re-run the migration's own header tells you to do. Doing it here means the
// suite fails if that instruction is ever wrong.
await db.exec(migration('0003_grants.sql'));

// --- Test harness -----------------------------------------------------------
let passed = 0;
let failed = 0;

/** Run `fn` as the given user, with RLS enforced exactly as it is for a
 *  browser session holding that user's JWT. */
async function asUser(userId, fn) {
  await db.exec(`set role authenticated;`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}\n      expected ${expected}, got ${actual}`);
  }
}

/** Assert that a write does not happen.
 *
 *  Two distinct shapes of "denied", and conflating them hides real holes:
 *    - INSERT violating a WITH CHECK (or a constraint) raises an error.
 *    - UPDATE/DELETE whose target rows fail the USING clause raises NOTHING —
 *      the rows are simply invisible, so 0 rows are affected. Treating "no
 *      exception" as success would make every UPDATE test pass vacuously.
 *  So: denied means an error OR zero rows touched. */
async function expectDenied(label, sql, params = []) {
  try {
    const res = await db.query(sql, params);
    const affected = res.affectedRows ?? 0;
    if (affected === 0) {
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${label} \x1b[2m(0 rows — filtered by RLS)\x1b[0m`);
    } else {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m ${label}\n      expected no write, but ${affected} row(s) changed`);
    }
  } catch {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label} \x1b[2m(rejected)\x1b[0m`);
  }
}

/** Belt-and-braces for the security-critical cases: read the value back as the
 *  table owner (RLS bypassed) and prove it is still what it should be. */
async function expectUnchanged(label, sql, params, expected) {
  const { rows } = await db.query(sql, params);
  check(label, rows[0]?.v ?? null, expected);
}

const count = async (sql, params = []) =>
  Number((await db.query(sql, params)).rows[0].n);

// ============================================================================
// SEED — two institutions, so cross-tenant isolation is actually testable.
// Written as the owner (RLS bypassed), mirroring the service-role seed script.
// ============================================================================
const ids = {};
{
  const mk = () => crypto.randomUUID();
  Object.assign(ids, {
    instA: mk(), instB: mk(),
    deptA: mk(), deptB: mk(),
    termA: mk(), termB: mk(),
    courseA: mk(), courseB: mk(),
    offerA: mk(), offerB: mk(),
    profA: mk(), studA1: mk(), studA2: mk(), adminA: mk(),
    // A second professor at the SAME college who teaches something else. Needed
    // to test "faculty ≠ faculty who teaches this offering", which a single
    // professor can never distinguish.
    profA2: mk(),
    studB1: mk(),
    asgOpen: mk(), asgDraft: mk(),
  });

  for (const u of ['profA', 'profA2', 'studA1', 'studA2', 'adminA', 'studB1']) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
      ids[u], `${u}@test.edu`,
    ]);
  }

  await db.query(
    `insert into public.institutions (id, name, slug) values ($1,'Alpha College','alpha'), ($2,'Beta College','beta')`,
    [ids.instA, ids.instB]
  );
  await db.query(
    `insert into public.departments (id, institution_id, name, code) values ($1,$2,'CSE','CSE'), ($3,$4,'CSE','CSE')`,
    [ids.deptA, ids.instA, ids.deptB, ids.instB]
  );
  await db.query(
    `insert into public.profiles (id, institution_id, department_id, role, full_name, email, roll_number) values
       ($1,$2,$3,'faculty','Prof A','profa@test.edu',null),
       ($10,$2,$3,'faculty','Prof A2','profa2@test.edu',null),
       ($4,$2,$3,'student','Student A1','a1@test.edu','A1'),
       ($5,$2,$3,'student','Student A2','a2@test.edu','A2'),
       ($6,$2,$3,'admin','Admin A','admina@test.edu',null),
       ($7,$8,$9,'student','Student B1','b1@test.edu','B1')`,
    [ids.profA, ids.instA, ids.deptA, ids.studA1, ids.studA2, ids.adminA,
     ids.studB1, ids.instB, ids.deptB, ids.profA2]
  );
  await db.query(
    `insert into public.terms (id, institution_id, name, starts_on, ends_on) values
       ($1,$2,'Monsoon 2026','2026-07-20','2026-11-21'),
       ($3,$4,'Monsoon 2026','2026-07-20','2026-11-21')`,
    [ids.termA, ids.instA, ids.termB, ids.instB]
  );
  await db.query(
    `insert into public.courses (id, institution_id, department_id, code, title, credits, color) values
       ($1,$2,$3,'CS301','Operating Systems',4,'#4C5BD4'),
       ($4,$5,$6,'CS301','Operating Systems',4,'#4C5BD4')`,
    [ids.courseA, ids.instA, ids.deptA, ids.courseB, ids.instB, ids.deptB]
  );
  await db.query(
    `insert into public.course_offerings (id, institution_id, course_id, term_id, section) values
       ($1,$2,$3,$4,'A'), ($5,$6,$7,$8,'A')`,
    [ids.offerA, ids.instA, ids.courseA, ids.termA,
     ids.offerB, ids.instB, ids.courseB, ids.termB]
  );
  await db.query(
    `insert into public.teaching_assignments (institution_id, offering_id, faculty_id) values ($1,$2,$3)`,
    [ids.instA, ids.offerA, ids.profA]
  );
  await db.query(
    `insert into public.enrolments (institution_id, offering_id, student_id) values ($1,$2,$3), ($1,$2,$4)`,
    [ids.instA, ids.offerA, ids.studA1, ids.studA2]
  );
  await db.query(
    `insert into public.enrolments (institution_id, offering_id, student_id) values ($1,$2,$3)`,
    [ids.instB, ids.offerB, ids.studB1]
  );
  await db.query(
    `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status) values
       ($1,$2,$3,$4,'Lab 4 — Scheduling report',20,'2026-07-28 23:59+05:30','open'),
       ($5,$2,$3,$4,'Assignment 6 — File systems',15,'2026-08-12 23:59+05:30','draft')`,
    [ids.asgOpen, ids.instA, ids.offerA, ids.profA, ids.asgDraft]
  );
}

// ============================================================================
console.log('\n\x1b[1mTENANT ISOLATION — the rule that preserves future sharding\x1b[0m');
await asUser(ids.studA1, async () => {
  check('student sees only their own institution',
    await count(`select count(*)::int n from public.institutions`), 1);
  check('student cannot see the other college\'s courses',
    await count(`select count(*)::int n from public.courses`), 1);
  check('student cannot see the other college\'s offerings',
    await count(`select count(*)::int n from public.course_offerings`), 1);
  check('student cannot see a profile from another institution',
    await count(`select count(*)::int n from public.profiles where id = $1`, [ids.studB1]), 0);
});

console.log('\n\x1b[1mSTUDENT PRIVACY — "a student truly cannot read another student\'s data"\x1b[0m');
await asUser(ids.studA1, async () => {
  check('can read own profile',
    await count(`select count(*)::int n from public.profiles where id = $1`, [ids.studA1]), 1);
  check('can read a classmate they share an offering with',
    await count(`select count(*)::int n from public.profiles where id = $1`, [ids.studA2]), 1);
  check('cannot read a classmate\'s enrolment row',
    await count(`select count(*)::int n from public.enrolments where student_id = $1`, [ids.studA2]), 0);
  check('sees exactly their own enrolment',
    await count(`select count(*)::int n from public.enrolments`), 1);
});

console.log('\n\x1b[1mDRAFT ASSIGNMENTS — invisible to students, in the database\x1b[0m');
await asUser(ids.studA1, async () => {
  check('student sees the open assignment',
    await count(`select count(*)::int n from public.assignments where id = $1`, [ids.asgOpen]), 1);
  check('student does NOT see the draft assignment',
    await count(`select count(*)::int n from public.assignments where id = $1`, [ids.asgDraft]), 0);
});
await asUser(ids.profA, async () => {
  check('professor sees both (including their draft)',
    await count(`select count(*)::int n from public.assignments`), 2);
});

console.log('\n\x1b[1mPROFESSOR SCOPE — their offerings, not the college\x1b[0m');
await asUser(ids.profA, async () => {
  check('professor sees the full roll of what they teach',
    await count(`select count(*)::int n from public.enrolments`), 2);
  check('professor sees enrolled students\' profiles',
    await count(`select count(*)::int n from public.profiles where id = $1`, [ids.studA2]), 1);
  check('professor cannot see the other college',
    await count(`select count(*)::int n from public.institutions`), 1);
});

console.log('\n\x1b[1mADMIN SCOPE — their institution, and only theirs\x1b[0m');
// Ground truth from the owner, so adding a fixture user does not turn a real
// security assertion into a failing arithmetic quiz.
const instAProfiles = await count(
  `select count(*)::int as n from public.profiles where institution_id = $1`,
  [ids.instA],
);
await asUser(ids.adminA, async () => {
  check(`admin sees every profile in their institution (${instAProfiles})`,
    await count(`select count(*)::int n from public.profiles`), instAProfiles);
  check('admin still cannot see the other institution\'s profiles',
    await count(`select count(*)::int n from public.profiles where institution_id = $1`, [ids.instB]), 0);
});

console.log('\n\x1b[1mWRITE PATHS — privilege escalation and forgery\x1b[0m');
await asUser(ids.studA1, async () => {
  await expectDenied('student cannot promote themselves to admin',
    `update public.profiles set role = 'admin' where id = $1`, [ids.studA1]);
  await expectDenied('student cannot enrol themselves in a course',
    `insert into public.enrolments (institution_id, offering_id, student_id) values ($1,$2,$3)`,
    [ids.instA, ids.offerA, ids.studA1]);
  await expectDenied('student cannot publish grades',
    `update public.assignments set grades_released = true where id = $1`, [ids.asgOpen]);
  await expectDenied('student cannot create an assignment',
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,'Fake',10,'2026-09-01','open')`,
    [ids.instA, ids.offerA, ids.studA1]);
  await expectDenied('student cannot fabricate a notification',
    `insert into public.notifications (institution_id, user_id, type) values ($1,$2,'announcement')`,
    [ids.instA, ids.studA1]);
  await expectDenied('student cannot mark themselves present without a session',
    `insert into public.attendance_records (institution_id, session_id, student_id, status, marked_via)
       values ($1,$2,$3,'present','code')`,
    [ids.instA, ids.asgOpen, ids.studA1]);
});

// Prove the two escalation attempts above really left the data alone, read
// back with RLS bypassed. A silently-zero-row UPDATE and a successful one are
// indistinguishable from the client; this is the check that tells them apart.
await expectUnchanged('...and their role is still "student"',
  `select role as v from public.profiles where id = $1`, [ids.studA1], 'student');
await expectUnchanged('...and grades are still unpublished',
  `select grades_released as v from public.assignments where id = $1`, [ids.asgOpen], false);

console.log('\n\x1b[1mSCHEMA GUARANTEES — constraints, not conventions\x1b[0m');
await expectDenied('FK cannot cross an institution boundary (offering in A, term in B)',
  `insert into public.course_offerings (institution_id, course_id, term_id, section)
     values ($1,$2,$3,'X')`,
  [ids.instA, ids.courseA, ids.termB]);

await expectDenied('a team assignment must name a team set',
  `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at, is_team)
     values ($1,$2,$3,'Team work',10,'2026-09-01',true)`,
  [ids.instA, ids.offerA, ids.profA]);

await expectDenied('a submission cannot be both individual and team',
  `insert into public.submissions (institution_id, assignment_id, student_id, team_id)
     values ($1,$2,$3,$4)`,
  [ids.instA, ids.asgOpen, ids.studA1, ids.offerA]);

{
  // one-team-per-set, enforced by the unique constraint from 0001
  const tsId = crypto.randomUUID();
  const t1 = crypto.randomUUID();
  const t2 = crypto.randomUUID();
  await db.query(
    `insert into public.team_sets (id, institution_id, offering_id, name, min_size, max_size)
       values ($1,$2,$3,'Term project',2,4)`, [tsId, ids.instA, ids.offerA]);
  await db.query(
    `insert into public.teams (id, institution_id, team_set_id, name) values ($1,$2,$3,'Team 1'), ($4,$2,$3,'Team 2')`,
    [t1, ids.instA, tsId, t2]);
  await db.query(
    `insert into public.team_members (institution_id, team_id, team_set_id, student_id) values ($1,$2,$3,$4)`,
    [ids.instA, t1, tsId, ids.studA1]);
  await expectDenied('a student cannot join two teams in the same set',
    `insert into public.team_members (institution_id, team_id, team_set_id, student_id) values ($1,$2,$3,$4)`,
    [ids.instA, t2, tsId, ids.studA1]);
}

await expectDenied('attendance threshold cannot be set to a nonsense value',
  `update public.institutions set min_attendance_pct = 140 where id = $1`, [ids.instA]);

// ============================================================================
// ASSIGNMENT AUTHORSHIP (0004) — who may create an assignment, and where
// ============================================================================
console.log(`\n\x1b[1mASSIGNMENT AUTHORSHIP — teaching it is the permission\x1b[0m`);

// Acceptance criterion 1. profA2 is faculty at the same college with the same
// role and the same institution — the ONLY thing they lack is a
// teaching_assignments row for this offering. That must be enough to stop them.
await asUser(ids.profA2, async () => {
  await expectDenied(
    'faculty who do not teach the offering cannot create an assignment in it',
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,'Injected by a non-teacher',10,'2026-09-01 23:59+05:30','open')`,
    [ids.instA, ids.offerA, ids.profA2],
  );
});

// Acceptance criterion 2.
await asUser(ids.studA1, async () => {
  await expectDenied(
    'a student cannot create an assignment, even in their own course',
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,'Free marks for me',100,'2026-09-01 23:59+05:30','open')`,
    [ids.instA, ids.offerA, ids.studA1],
  );
});

// The professor who DOES teach it must still be able to — a policy that denies
// everyone is not a passing test, it is a broken feature.
await asUser(ids.profA, async () => {
  const before = await count(
    `select count(*)::int as n from public.assignments where offering_id = $1`,
    [ids.offerA],
  );
  await db.query(
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,'Lab 5 — Paging',20,'2026-09-01 23:59+05:30','draft')`,
    [ids.instA, ids.offerA, ids.profA],
  );
  check(
    'the professor who teaches it CAN create one',
    await count(
      `select count(*)::int as n from public.assignments where offering_id = $1`,
      [ids.offerA],
    ),
    before + 1,
  );
});

// ============================================================================
// SUBMISSION_GRADES (0004) — the tightest policy in the schema
//
// This group is the entire reason the grade was moved off `submissions`. The
// claim under test: a saved-but-unreleased grade is PHYSICALLY unreadable by
// the student it belongs to — not merely unrendered by a UI that could be
// bypassed with a network tab.
// ============================================================================
console.log(`\n\x1b[1mSUBMISSION_GRADES — graded is not the same as published\x1b[0m`);

{
  // Written as the owner, mirroring what the professor's server action will do.
  const subId = crypto.randomUUID();
  await db.query(
    `insert into public.submissions (id, institution_id, assignment_id, student_id)
       values ($1,$2,$3,$4)`,
    [subId, ids.instA, ids.asgOpen, ids.studA1],
  );
  await db.query(
    `insert into public.submission_grades (submission_id, institution_id, grade, feedback, graded_by)
       values ($1,$2,17.5,'Good analysis of the scheduler trace.',$3)`,
    [subId, ids.instA, ids.profA],
  );

  // asgOpen still has grades_released = false (the column default).
  check(
    'precondition: the assignment has NOT had grades released',
    await count(
      `select count(*)::int as n from public.assignments where id = $1 and grades_released = false`,
      [ids.asgOpen],
    ),
    1,
  );

  // ---- THE TEST THIS MIGRATION EXISTS FOR --------------------------------
  await asUser(ids.studA1, async () => {
    check(
      'a graded-but-UNPUBLISHED grade is invisible to the student who owns it',
      await count(`select count(*)::int as n from public.submission_grades`),
      0,
    );
    // ...while the submission itself stays readable, which is what keeps the
    // persistent ✓ and "awaiting grade" working. Both halves matter: hiding the
    // submission too would have been a much easier and much worse fix.
    check(
      '...but their own submission row is still readable (the ✓ still works)',
      await count(
        `select count(*)::int as n from public.submissions where student_id = $1`,
        [ids.studA1],
      ),
      1,
    );
  });

  // The professor sees it the whole time — that is the point of grading over days.
  await asUser(ids.profA, async () => {
    check(
      'the professor can read the unpublished grade they saved',
      await count(`select count(*)::int as n from public.submission_grades`),
      1,
    );
  });

  // ---- Flip the flag; nothing else changes -------------------------------
  await db.query(
    `update public.assignments set grades_released = true, grades_released_at = now() where id = $1`,
    [ids.asgOpen],
  );

  await asUser(ids.studA1, async () => {
    check(
      'releasing grades makes exactly that row appear',
      await count(`select count(*)::int as n from public.submission_grades`),
      1,
    );
    const { rows } = await db.query(
      `select grade::text as v from public.submission_grades limit 1`,
    );
    check('...with the mark the professor actually saved', rows[0]?.v, '17.50');
  });

  // Released to the class ≠ released to the whole class's individual rows.
  await asUser(ids.studA2, async () => {
    check(
      'a classmate still cannot read someone else\'s grade after release',
      await count(`select count(*)::int as n from public.submission_grades`),
      0,
    );
  });

  await asUser(ids.studB1, async () => {
    check(
      'a student at another college sees no grades at all',
      await count(`select count(*)::int as n from public.submission_grades`),
      0,
    );
  });

  // ---- Students never write grades, released or not ----------------------
  await asUser(ids.studA1, async () => {
    await expectDenied(
      'a student cannot award themselves a grade',
      `insert into public.submission_grades (submission_id, institution_id, grade)
         values ($1,$2,20)`,
      [crypto.randomUUID(), ids.instA],
    );
    await expectDenied(
      'a student cannot edit the grade they were given',
      `update public.submission_grades set grade = 20 where submission_id = $1`,
      [subId],
    );
  });
  await expectUnchanged(
    '...and the mark is still what the professor set',
    `select grade::text as v from public.submission_grades where submission_id = $1`,
    [subId],
    '17.50',
  );

  await asUser(ids.profA2, async () => {
    await expectDenied(
      'faculty who do not teach the offering cannot grade its submissions',
      `update public.submission_grades set grade = 1 where submission_id = $1`,
      [subId],
    );
  });

  // Put it back so later assertions see the documented default.
  await db.query(
    `update public.assignments set grades_released = false, grades_released_at = null where id = $1`,
    [ids.asgOpen],
  );
}

// ============================================================================
// ASSIGNMENT FIELD CONSTRAINTS (0004) — the DB is the last line, not the only one
// ============================================================================
console.log(`\n\x1b[1mASSIGNMENT FIELDS — late window and penalty constraints\x1b[0m`);

const newAssignment = (cols, vals) =>
  `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at${cols})
     values ($1,$2,$3,'Constraint probe',10,'2026-09-10 23:59+05:30'${vals})`;

await expectDenied(
  'a late window cannot end before the deadline',
  newAssignment(', late_until', `, '2026-09-09 23:59+05:30'`),
  [ids.instA, ids.offerA, ids.profA],
);

await expectDenied(
  'a late window cannot exist when late work is not accepted',
  newAssignment(', allow_late, late_until', `, false, '2026-09-12 23:59+05:30'`),
  [ids.instA, ids.offerA, ids.profA],
);

await expectDenied(
  'a late penalty above 100%/day is rejected',
  newAssignment(', late_penalty_pct_per_day', `, 150`),
  [ids.instA, ids.offerA, ids.profA],
);

await expectDenied(
  'a negative late penalty is rejected',
  newAssignment(', late_penalty_pct_per_day', `, -5`),
  [ids.instA, ids.offerA, ids.profA],
);

// ============================================================================
// GRANTS (0003) — the outer door, distinct from the RLS lock.
//
// The distinction this group exists to pin down: RLS decides WHICH ROWS a role
// may touch; GRANT decides whether it may touch the table at all. service_role
// passes the first check (bypassrls) and, before 0003, failed the second — the
// "permission denied for table institutions" the seed script hit.
// ============================================================================
console.log(`\n\x1b[1mGRANTS — service_role gets in, anon does not\x1b[0m`);

/** Run `fn` as a role with no JWT claim set — i.e. a raw connection as that
 *  role, which is what PostgREST does after SET ROLE. */
async function asRole(role, fn) {
  await db.exec(`set role ${role};`);
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

// What the owner can see is the ground truth service_role must match — asserting
// equality rather than a hardcoded number keeps this honest as the fixture grows.
const ownerProfileCount = await count(
  `select count(*)::int as n from public.profiles`,
);

await asRole('service_role', async () => {
  // This exact read is what the seed does first, and what failed with 42501.
  check(
    'service_role can read institutions across every tenant',
    await count(`select count(*)::int as n from public.institutions`),
    2,
  );
  check(
    'service_role sees every profile in both institutions (RLS bypassed)',
    await count(`select count(*)::int as n from public.profiles`),
    ownerProfileCount,
  );

  // The seed's actual write path: insert a tenant row and a profile.
  const instId = crypto.randomUUID();
  await db.query(
    `insert into public.institutions (id, name, slug) values ($1,'Seed Test College','seed-test')`,
    [instId],
  );
  check(
    'service_role can insert an institution',
    await count(`select count(*)::int as n from public.institutions where id = $1`, [instId]),
    1,
  );
  await db.query(`delete from public.institutions where id = $1`, [instId]);
  check(
    'service_role can delete what it created',
    await count(`select count(*)::int as n from public.institutions where id = $1`, [instId]),
    0,
  );
});

// anon has no grant at all, so this fails at the privilege check — before RLS
// is ever consulted. There is no signed-out surface in this product.
await asRole('anon', async () => {
  await expectDenied(
    'anon still cannot touch institutions',
    `select count(*) from public.institutions`,
  );
  await expectDenied(
    'anon still cannot touch profiles',
    `select count(*) from public.profiles`,
  );
});

// The load-bearing check: 0003 must not have handed authenticated a way past
// RLS. Same query, same table, as a real student — still tenant-scoped.
await asUser(ids.studA1, async () => {
  check(
    'authenticated is STILL confined to its own institution after 0003',
    await count(`select count(*)::int as n from public.institutions`),
    1,
  );
});

// Every table needs both halves. A table with policies but no grant throws
// 42501; a table with a grant but no RLS is wide open. Neither is caught by
// reading either migration on its own.
{
  const { rows } = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (
        not c.relrowsecurity
        or not has_table_privilege('authenticated', c.oid, 'SELECT')
        or not has_table_privilege('service_role', c.oid, 'SELECT')
      )
  `);
  check(
    `every table has RLS enabled AND is granted to both roles${rows.length ? ` (offenders: ${rows.map((r) => r.relname).join(', ')})` : ''}`,
    rows.length,
    0,
  );
}

// ============================================================================
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
await db.close();
process.exit(failed ? 1 : 0);
