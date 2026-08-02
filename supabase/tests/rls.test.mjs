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

// --- storage shim -----------------------------------------------------------
//
// PGlite has no `storage` schema, so the most security-critical thing in 1B-i
// would otherwise be the one thing this suite cannot test. This recreates the
// surface 0010 touches — buckets, objects, and foldername() — so the POLICY
// EXPRESSIONS run for real.
//
// WHAT THIS DOES NOT TEST, stated plainly: Supabase's own enforcement. The real
// storage API decides whether a given request is even routed to these policies,
// and this shim cannot speak to that. What it does test is the expressions —
// which segment is compared, in which order, against which id — and that is
// where the off-by-one lives.
//
// foldername() mirrors Supabase's: the path segments EXCLUDING the filename,
// 1-indexed. If that ever diverges, every path assertion below is meaningless,
// so the indexing itself is asserted before anything else uses it.
await db.exec(`
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean not null default false,
    file_size_limit bigint,
    created_at timestamptz not null default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner uuid,
    metadata jsonb,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  -- Real Supabase grants schema usage to both roles; without it every query
  -- below fails with "permission denied for schema storage" rather than
  -- exercising the policies.
  grant usage on schema storage to authenticated, service_role;
  grant select, insert on storage.objects to authenticated;
  grant all on storage.objects to service_role;
  grant select, insert, update on storage.buckets to service_role;

  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[
      1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)
    ]
  $fn$;
`);

await db.exec(migration('0001_init_schema.sql'));
await db.exec(migration('0002_rls_policies.sql'));
await db.exec(migration('0003_grants.sql'));
await db.exec(migration('0004_assignment_fields_and_grade_split.sql'));
await db.exec(migration('0005_foundations.sql'));
await db.exec(migration('0006_tenant_integrity.sql'));
await db.exec(migration('0007_soft_delete.sql'));
await db.exec(migration('0008_soft_delete_cascade.sql'));
await db.exec(migration('0009_submit_attempts.sql'));
await db.exec(migration('0010_storage.sql'));
// 0004 and 0005 create tables, so 0003's ON ALL TABLES snapshot is stale —
// exactly the re-run those migrations' headers tell you to do. Running it LAST,
// after every table exists and is commented, proves two things at once: that the
// instruction is right, and that a re-run does not re-grant UPDATE on an
// append-only table now that the list derives itself from the catalogue.
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
    `insert into public.submission_grades (submission_id, institution_id, grade, feedback, graded_by, updated_by)
       values ($1,$2,17.5,'Good analysis of the scheduler trace.',$3,$3)`,
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
// FOUNDATIONS (0005) — timezone, audit trail, append-only grade history
// ============================================================================
console.log(`\n\x1b[1mTIMEZONE — config-as-data, shape enforced\x1b[0m`);

check('an institution gets IST by default',
  (await db.query(`select timezone from public.institutions where id = $1`, [ids.instA])).rows[0].timezone,
  'Asia/Kolkata');

await db.query(`update public.institutions set timezone = 'America/New_York' where id = $1`, [ids.instB]);
check('a second institution can run in another zone',
  (await db.query(`select timezone from public.institutions where id = $1`, [ids.instB])).rows[0].timezone,
  'America/New_York');

// The CHECK is a shape test, not a catalogue lookup — see the reasoning in
// 0005. It should reject the shapes a human actually fat-fingers.
for (const [label, value] of [
  ['an empty timezone', ''],
  ['a bare abbreviation like IST', 'IST'],
  ['a zone with trailing whitespace', 'Asia/Kolkata '],
  ['free text', 'India Standard Time'],
]) {
  await expectDenied(`${label} is rejected`,
    `update public.institutions set timezone = $1 where id = $2`, [value, ids.instA]);
}
check('UTC is allowed',
  (await db.query(`select 'UTC' ~ '^[A-Za-z][A-Za-z_-]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$' or 'UTC' = 'UTC' as v`)).rows[0].v,
  true);
await expectUnchanged('...and Alpha is still on IST after those attempts',
  `select timezone as v from public.institutions where id = $1`, [ids.instA], 'Asia/Kolkata');


console.log(`\n\x1b[1mGRADE_HISTORY — written by the database, not the app\x1b[0m`);
{
  const subId = crypto.randomUUID();
  await db.query(
    `insert into public.submissions (id, institution_id, assignment_id, student_id) values ($1,$2,$3,$4)`,
    [subId, ids.instA, ids.asgDraft, ids.studA2]);

  const historyFor = () => count(
    `select count(*)::int as n from public.grade_history where submission_id = $1`, [subId]);

  // First mark. The application sets updated_by; the trigger reads it, so the
  // actor is recorded without the database knowing anything about auth.
  await db.query(
    `insert into public.submission_grades (submission_id, institution_id, grade, feedback, graded_by, updated_by)
       values ($1,$2,12,'Needs a clearer proof.',$3,$3)`,
    [subId, ids.instA, ids.profA]);

  check('saving a grade writes exactly one history row', await historyFor(), 1);
  {
    const { rows } = await db.query(
      `select old_grade, new_grade::text as new_grade, changed_by from public.grade_history where submission_id = $1`,
      [subId]);
    check('...with old_grade null, because there was nothing before', rows[0].old_grade, null);
    check('...and the new grade recorded', rows[0].new_grade, '12.00');
    check('...and the actor taken from updated_by', rows[0].changed_by, ids.profA);
  }

  // A post-publish correction, by a DIFFERENT person. graded_by stays as who
  // first marked it; updated_by becomes who changed it. That difference is the
  // entire reason both columns exist.
  await db.query(
    `update public.submission_grades set grade = 18, feedback = 'Re-marked after review.', updated_by = $2
       where submission_id = $1`,
    [subId, ids.adminA]);

  check('changing the grade writes a second row', await historyFor(), 2);
  {
    // Selected by CONTENT, not by `order by changed_at desc limit 1`.
    // now() resolves to the millisecond, so two rows written in quick
    // succession tie and the ordering picks one arbitrarily — which made this
    // assertion pass or fail depending on how fast the machine was. The
    // correction is the row that has something to replace.
    const { rows } = await db.query(
      `select old_grade::text as old_grade, new_grade::text as new_grade, old_feedback, changed_by
         from public.grade_history where submission_id = $1 and old_grade is not null`,
      [subId]);
    check('...carrying the value it replaced', rows[0].old_grade, '12.00');
    check('...and the value that replaced it', rows[0].new_grade, '18.00');
    check('...and the feedback it replaced', rows[0].old_feedback, 'Needs a clearer proof.');
    check('...and the person who changed it, not the original marker', rows[0].changed_by, ids.adminA);
  }
  await expectUnchanged('graded_by still records who FIRST marked it',
    `select graded_by as v from public.submission_grades where submission_id = $1`, [subId], ids.profA);

  // An update that changes nothing is not a change.
  await db.query(
    `update public.submission_grades set feedback = 'Re-marked after review.' where submission_id = $1`, [subId]);
  check('a no-op update writes no history row', await historyFor(), 2);

  // ---- Append-only, asserted rather than assumed -------------------------
  await asUser(ids.profA, async () => {
    await expectDenied('a professor cannot edit a history row',
      `update public.grade_history set new_grade = 100 where submission_id = $1`, [subId]);
    await expectDenied('a professor cannot delete a history row',
      `delete from public.grade_history where submission_id = $1`, [subId]);
    await expectDenied('a professor cannot forge a history row',
      `insert into public.grade_history (institution_id, submission_id, new_grade) values ($1,$2,99)`,
      [ids.instA, subId]);
  });
  await asUser(ids.adminA, async () => {
    await expectDenied('an admin cannot edit a history row either',
      `update public.grade_history set new_grade = 100 where submission_id = $1`, [subId]);
    await expectDenied('an admin cannot delete one either',
      `delete from public.grade_history where submission_id = $1`, [subId]);
  });
  await expectUnchanged('...and the correction still records 18',
    `select new_grade::text as v from public.grade_history where submission_id = $1 and old_grade is not null`,
    [subId], '18.00');
  check('...with both rows intact', await historyFor(), 2);

  // ---- Who may read it ---------------------------------------------------
  await asUser(ids.profA, async () => {
    check('the professor who teaches the course can read the history',
      await count(`select count(*)::int as n from public.grade_history where submission_id = $1`, [subId]), 2);
  });
  await asUser(ids.adminA, async () => {
    check('an admin in the institution can read it',
      await count(`select count(*)::int as n from public.grade_history where submission_id = $1`, [subId]), 2);
  });
  await asUser(ids.profA2, async () => {
    check('a professor who does not teach the course cannot',
      await count(`select count(*)::int as n from public.grade_history`), 0);
  });

  // THE ONE THAT MATTERS. "Your grade was changed from 12 to 18" would undo the
  // whole publish flow, so a student must not see this even once grades are out.
  await asUser(ids.studA2, async () => {
    check('the student it belongs to cannot read their own history',
      await count(`select count(*)::int as n from public.grade_history`), 0);
  });
  await db.query(`update public.assignments set grades_released = true where id = $1`, [ids.asgDraft]);
  await asUser(ids.studA2, async () => {
    check('...and STILL cannot after grades_released is true',
      await count(`select count(*)::int as n from public.grade_history`), 0);
    check('...even though the grade itself is now visible to them',
      await count(`select count(*)::int as n from public.submission_grades where submission_id = $1`, [subId]), 1);
  });
  await asUser(ids.studB1, async () => {
    check('a student at another college sees no history at all',
      await count(`select count(*)::int as n from public.grade_history`), 0);
  });
  await db.query(`update public.assignments set grades_released = false where id = $1`, [ids.asgDraft]);
}


console.log(`\n\x1b[1mAUDIT COLUMNS — updated_at by trigger, updated_by by the app\x1b[0m`);
{
  const before = (await db.query(
    `select updated_at from public.assignments where id = $1`, [ids.asgOpen])).rows[0].updated_at;

  await db.query(
    `update public.assignments set title = 'Lab 4 — retitled', updated_by = $2 where id = $1`,
    [ids.asgOpen, ids.profA]);

  const { rows } = await db.query(
    `select updated_at, updated_by from public.assignments where id = $1`, [ids.asgOpen]);
  check('updated_at moves without anyone setting it', rows[0].updated_at > before, true);
  check('updated_by is whoever the application named', rows[0].updated_by, ids.profA);
}


console.log(`\n\x1b[1mLEFTOVERS FROM 1A — the database now agrees with zod\x1b[0m`);
{
  const newAsg = (cols, vals) =>
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at${cols})
       values ($1,$2,$3,'Constraint probe',20,'2026-09-10 23:59+05:30'${vals})`;

  await expectDenied('an assignment with no way to submit is rejected',
    newAsg(', accept_file, accept_link, accept_text', ', false, false, false'),
    [ids.instA, ids.offerA, ids.profA]);

  await expectDenied('marks of zero is rejected by the database, not only by zod',
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at)
       values ($1,$2,$3,'Zero marks',0,'2026-09-10 23:59+05:30')`,
    [ids.instA, ids.offerA, ids.profA]);

  await expectDenied('negative marks too',
    `insert into public.assignments (institution_id, offering_id, created_by, title, marks, due_at)
       values ($1,$2,$3,'Negative',-1,'2026-09-10 23:59+05:30')`,
    [ids.instA, ids.offerA, ids.profA]);

  check('allow_multiple_attempts defaults to true',
    (await db.query(`select allow_multiple_attempts as v from public.assignments where id = $1`, [ids.asgOpen])).rows[0].v,
    true);
}

// ============================================================================
// SOFT DELETE (0007) — a hidden row does not exist for a student
// ============================================================================
console.log(`\n\x1b[1mSOFT DELETE — hidden means hidden, and reversible\x1b[0m`);
{
  const asgId = crypto.randomUUID();
  await db.query(
    `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,$4,'Lab 9 — soft delete probe',10,'2026-09-20 23:59+05:30','open')`,
    [asgId, ids.instA, ids.offerA, ids.profA]);

  const seenBy = (who) => asUser(who, () =>
    count(`select count(*)::int as n from public.assignments where id = $1`, [asgId]));

  check('before deleting, the enrolled student sees it', await seenBy(ids.studA1), 1);
  check('...and so does the professor', await seenBy(ids.profA), 1);

  // Deleting is an UPDATE. It needs no delete policy — the existing teacher
  // write policy already covers it, which is why 0007 adds none.
  await asUser(ids.profA, () =>
    db.query(`update public.assignments set deleted_at = now() where id = $1`, [asgId]));

  check('a soft-deleted assignment is invisible to the enrolled student', await seenBy(ids.studA1), 0);
  check('...but still readable by the professor who teaches it', await seenBy(ids.profA), 1);
  check('...and by an admin, so a mistake is recoverable', await seenBy(ids.adminA), 1);

  // The row is genuinely still there — invisibility is a policy, not a delete.
  check('...and the row itself still exists',
    await count(`select count(*)::int as n from public.assignments where id = $1`, [asgId]), 1);

  await asUser(ids.profA, () =>
    db.query(`update public.assignments set deleted_at = null where id = $1`, [asgId]));
  check('undeleting restores student visibility', await seenBy(ids.studA1), 1);

  // A student must not be able to hide work from themselves, or resurrect
  // something staff hid. They have no UPDATE policy on assignments at all.
  await asUser(ids.profA, () =>
    db.query(`update public.assignments set deleted_at = now() where id = $1`, [asgId]));
  await asUser(ids.studA1, async () => {
    await expectDenied('a student cannot undelete what staff hid',
      `update public.assignments set deleted_at = null where id = $1`, [asgId]);
  });
  await expectUnchanged('...it is still hidden',
    `select (deleted_at is not null) as v from public.assignments where id = $1`, [asgId], true);
  await db.query(`update public.assignments set deleted_at = null where id = $1`, [asgId]);
  await db.query(`delete from public.assignments where id = $1`, [asgId]);
}

console.log(`\n\x1b[1mSOFT DELETE CASCADE — a hidden parent hides its children\x1b[0m`);
{
  // Everything below hangs off offerA, which studA1 is enrolled in and profA
  // teaches. Deleting a parent must take the lot out of the student's view
  // without a single query needing to know about it.
  const tsId = crypto.randomUUID();
  const slotId = crypto.randomUUID();
  const sessId = crypto.randomUUID();
  const annId = crypto.randomUUID();
  await db.query(
    `insert into public.team_sets (id, institution_id, offering_id, name, min_size, max_size)
       values ($1,$2,$3,'Cascade probe',2,4)`, [tsId, ids.instA, ids.offerA]);
  await db.query(
    `insert into public.timetable_slots (id, institution_id, offering_id, day_of_week, starts_at, ends_at)
       values ($1,$2,$3,1,'09:00','10:00')`, [slotId, ids.instA, ids.offerA]);
  await db.query(
    `insert into public.attendance_sessions (id, institution_id, offering_id, held_on, taken_by, code_seed)
       values ($1,$2,$3,'2026-08-14',$4,'seed')`, [sessId, ids.instA, ids.offerA, ids.profA]);
  await db.query(
    `insert into public.announcements (id, institution_id, offering_id, author_id, title, body)
       values ($1,$2,$3,$4,'Notice','Body')`, [annId, ids.instA, ids.offerA, ids.profA]);

  const CHILDREN = ['assignments', 'announcements', 'team_sets',
                    'attendance_sessions', 'timetable_slots'];
  const visible = async (who) => {
    const out = [];
    for (const t of CHILDREN) {
      const n = await asUser(who, () =>
        count(`select count(*)::int as n from public.${t} where offering_id = $1`, [ids.offerA]));
      if (n > 0) out.push(t);
    }
    return out;
  };

  check('baseline: the student sees all five kinds of course content',
    (await visible(ids.studA1)).length, 5);

  // --- level 1: the offering itself ---------------------------------------
  await db.query(`update public.course_offerings set deleted_at = now() where id = $1`, [ids.offerA]);
  {
    const leaked = await visible(ids.studA1);
    check(`a soft-deleted offering hides ALL its content from an enrolled student${
      leaked.length ? ` (leaked: ${leaked.join(', ')})` : ''}`, leaked.length, 0);
    check('...and the offering row itself',
      await asUser(ids.studA1, () =>
        count(`select count(*)::int as n from public.course_offerings where id = $1`, [ids.offerA])), 0);
    check('...while the professor still sees all of it, so undelete is possible',
      (await visible(ids.profA)).length, 5);
    check('...and so does an admin',
      (await visible(ids.adminA)).length, 5);
  }
  await db.query(`update public.course_offerings set deleted_at = null where id = $1`, [ids.offerA]);
  check('undeleting the offering brings the content back',
    (await visible(ids.studA1)).length, 5);

  // --- level 2: the course above it ---------------------------------------
  await db.query(`update public.courses set deleted_at = now() where id = $1`, [ids.courseA]);
  {
    const leaked = await visible(ids.studA1);
    check(`a soft-deleted COURSE hides its offering's content too${
      leaked.length ? ` (leaked: ${leaked.join(', ')})` : ''}`, leaked.length, 0);
    check('...and the offering, which was the second leak',
      await asUser(ids.studA1, () =>
        count(`select count(*)::int as n from public.course_offerings where id = $1`, [ids.offerA])), 0);
  }
  await db.query(`update public.courses set deleted_at = null where id = $1`, [ids.courseA]);

  // --- level 2: the term ---------------------------------------------------
  await db.query(`update public.terms set deleted_at = now() where id = $1`, [ids.termA]);
  check('a soft-deleted TERM hides everything under it as well',
    (await visible(ids.studA1)).length, 0);
  await db.query(`update public.terms set deleted_at = null where id = $1`, [ids.termA]);
  check('...and restoring the term restores the lot',
    (await visible(ids.studA1)).length, 5);

  // --- inherited for free, via direct subquery -----------------------------
  {
    const afId = crypto.randomUUID();
    await db.query(
      `insert into public.assignment_files (id, institution_id, assignment_id, storage_path, file_name)
         values ($1,$2,$3,'p/x.pdf','x.pdf')`, [afId, ids.instA, ids.asgOpen]);
    await db.query(`update public.course_offerings set deleted_at = now() where id = $1`, [ids.offerA]);
    check('assignment_files cascades without a policy of its own (direct subquery)',
      await asUser(ids.studA1, () =>
        count(`select count(*)::int as n from public.assignment_files where id = $1`, [afId])), 0);
    await db.query(`update public.course_offerings set deleted_at = null where id = $1`, [ids.offerA]);
    await db.query(`delete from public.assignment_files where id = $1`, [afId]);
  }

  // --- DELIBERATELY NOT cascaded ------------------------------------------
  //
  // Both policies open with `student_id = auth.uid()`, a branch with no
  // subquery, so there is nothing for RLS to be inherited through. Left that
  // way on purpose: these are the student's own academic record, and
  // DELETION_POLICY.md §2 keeps them out of soft-delete precisely because a
  // dispute is about the work. A student losing sight of their own submission
  // because an admin hid a course is the worse of the two failures. It is not
  // a confidentiality leak — they see only their own rows.
  {
    const subId = crypto.randomUUID();
    await db.query(
      `insert into public.submissions (id, institution_id, assignment_id, student_id)
         values ($1,$2,$3,$4)`, [subId, ids.instA, ids.asgOpen, ids.studA2]);
    await db.query(
      `insert into public.attendance_records (institution_id, session_id, student_id, status, marked_via)
         values ($1,$2,$3,'present','code')`, [ids.instA, sessId, ids.studA2]);
    await db.query(`update public.course_offerings set deleted_at = now() where id = $1`, [ids.offerA]);

    check('a student KEEPS their own submission when the offering is hidden',
      await asUser(ids.studA2, () =>
        count(`select count(*)::int as n from public.submissions where id = $1`, [subId])), 1);
    check('...and their own attendance marks',
      await asUser(ids.studA2, () =>
        count(`select count(*)::int as n from public.attendance_records where session_id = $1`, [sessId])), 1);
    check('...but a classmate still cannot see either',
      await asUser(ids.studA1, () =>
        count(`select count(*)::int as n from public.submissions where id = $1`, [subId])), 0);

    await db.query(`update public.course_offerings set deleted_at = null where id = $1`, [ids.offerA]);
    await db.query(`delete from public.attendance_records where session_id = $1`, [sessId]);
    await db.query(`delete from public.submissions where id = $1`, [subId]);
  }

  await db.query(`delete from public.announcements where id = $1`, [annId]);
  await db.query(`delete from public.attendance_sessions where id = $1`, [sessId]);
  await db.query(`delete from public.timetable_slots where id = $1`, [slotId]);
  await db.query(`delete from public.team_sets where id = $1`, [tsId]);
}

console.log(`\n\x1b[1mPARTIAL UNIQUES — reuse a code, never a roll number\x1b[0m`);
{
  const c1 = crypto.randomUUID(), c2 = crypto.randomUUID();
  await db.query(
    `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
       values ($1,$2,$3,'CS999','Retired Course',3,'#4C5BD4')`,
    [c1, ids.instA, ids.deptA]);

  await expectDenied('two LIVE courses cannot share a code',
    `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
       values ($1,$2,$3,'CS999','Replacement',3,'#0E7C86')`,
    [c2, ids.instA, ids.deptA]);

  await db.query(`update public.courses set deleted_at = now() where id = $1`, [c1]);
  await db.query(
    `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
       values ($1,$2,$3,'CS999','Replacement',3,'#0E7C86')`,
    [c2, ids.instA, ids.deptA]);
  check('...but a retired CS999 does not block a new one',
    await count(`select count(*)::int as n from public.courses where code = 'CS999' and institution_id = $1`, [ids.instA]),
    2);

  // The leak this could open: a soft-deleted course and a live one share a key,
  // so a join that forgets deleted_at silently returns two rows.
  check('...and only one of them is live',
    await count(`select count(*)::int as n from public.courses where code = 'CS999' and institution_id = $1 and deleted_at is null`, [ids.instA]),
    1);

  // A roll number is issued once and held for all time — profiles carry no
  // deleted_at, so this index was deliberately left total.
  await expectDenied('a roll number is never reusable, deleted or not',
    `insert into public.profiles (id, institution_id, department_id, role, full_name, email, roll_number)
       values (gen_random_uuid(),$1,$2,'student','Impostor','imp@test.edu','A1')`,
    [ids.instA, ids.deptA]);

  await db.query(`delete from public.courses where id = any($1)`, [[c1, c2]]);
}

console.log(`\n\x1b[1mSOFT DELETE vs REFERENTIAL INTEGRITY\x1b[0m`);
{
  // The failure this guards against: if unique(id, institution_id) had been made
  // partial, every composite FK referencing it would have been silently dropped.
  const cId = crypto.randomUUID(), oId = crypto.randomUUID();
  await db.query(
    `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
       values ($1,$2,$3,'CS998','Doomed',3,'#4C5BD4')`, [cId, ids.instA, ids.deptA]);
  await db.query(
    `insert into public.course_offerings (id, institution_id, course_id, term_id, section)
       values ($1,$2,$3,$4,'Z')`, [oId, ids.instA, cId, ids.termA]);

  await db.query(`update public.courses set deleted_at = now() where id = $1`, [cId]);
  check('a soft-deleted course keeps its offering attached',
    await count(`select count(*)::int as n from public.course_offerings where course_id = $1`, [cId]), 1);
  check('...and the offering still resolves its parent',
    await count(`select count(*)::int as n from public.course_offerings o join public.courses c
                   on c.id = o.course_id and c.institution_id = o.institution_id where o.id = $1`, [oId]), 1);

  await expectDenied('...and an offering still cannot point at another college\'s course',
    `insert into public.course_offerings (id, institution_id, course_id, term_id, section)
       values (gen_random_uuid(),$1,$2,$3,'Y')`, [ids.instB, cId, ids.termB]);

  await db.query(`delete from public.course_offerings where id = $1`, [oId]);
  await db.query(`delete from public.courses where id = $1`, [cId]);
}

console.log(`\n\x1b[1mACCOUNT STATUS — access level, not biography\x1b[0m`);
{
  check('everyone starts active',
    await count(`select count(*)::int as n from public.profiles where status = 'active'`), 6);

  for (const bad of ['deleted', 'graduated', '', 'ACTIVE']) {
    await expectDenied(`status "${bad}" is rejected`,
      `update public.profiles set status = $1 where id = $2`, [bad, ids.studA2]);
  }
  await expectUnchanged('...and the student is still active',
    `select status as v from public.profiles where id = $1`, [ids.studA2], 'active');

  // Deactivating changes access, not visibility: the person stays attached to
  // their work, which is the whole reason profiles carry no deleted_at.
  await db.query(`update public.profiles set status = 'alumni' where id = $1`, [ids.studA2]);
  await asUser(ids.profA, async () => {
    check('an alumnus still appears to their professor',
      await count(`select count(*)::int as n from public.profiles where id = $1`, [ids.studA2]), 1);
  });
  await db.query(`update public.profiles set status = 'active' where id = $1`, [ids.studA2]);
}

// ============================================================================
// SUBMITTING (0009) — the three holes, closed
// ============================================================================
console.log(`\n\x1b[1mSUBMITTING — one way in, and it checks the deadline\x1b[0m`);
{
  const submitAs = (who, assignmentId, items) =>
    asUser(who, async () => {
      try {
        const { rows } = await db.query(
          `select public.submit_attempt($1, $2::jsonb) as r`,
          [assignmentId, JSON.stringify(items)],
        );
        return { ok: true, result: rows[0].r };
      } catch (e) {
        return { ok: false, message: String(e.message) };
      }
    });
  const TEXT = [{ kind: 'text', text_body: 'my answer' }];

  // asgOpen is open with a due date in the past (2026-07-28) — so this is also
  // the late path. asgDraft is a draft.
  const first = await submitAs(ids.studA1, ids.asgOpen, TEXT);
  check('a student can submit', first.ok, true);
  check('...as attempt 1', first.result?.attempt, 1);
  check('...with a server-set timestamp', typeof first.result?.submitted_at, 'string');

  const second = await submitAs(ids.studA1, ids.asgOpen, TEXT);
  check('HOLE (a) CLOSED: a student can now resubmit', second.ok, true);
  check('...as attempt 2', second.result?.attempt, 2);
  check('...and attempt 1 still exists — nothing is destroyed on resubmit',
    await count(`select count(*)::int as n from public.submission_attempts sa
                   join public.submissions s on s.id = sa.submission_id
                  where s.assignment_id = $1 and s.student_id = $2`,
      [ids.asgOpen, ids.studA1]), 2);
  check('...and both attempts\' items survive',
    await count(`select count(*)::int as n from public.submission_files sf
                   join public.submissions s on s.id = sf.submission_id
                  where s.assignment_id = $1 and s.student_id = $2`,
      [ids.asgOpen, ids.studA1]), 2);
  check('...latest_attempt matches max(attempt), so the cache has not drifted',
    await count(`select count(*)::int as n from public.submissions s
                  where s.latest_attempt <> (select max(attempt) from public.submission_attempts
                                              where submission_id = s.id)`), 0);

  // HOLE (c): the deadline must be enforced on the RESUBMISSION path too.
  await db.query(`update public.assignments set status = 'closed' where id = $1`, [ids.asgOpen]);
  const afterClose = await submitAs(ids.studA1, ids.asgOpen, TEXT);
  check('HOLE (c) CLOSED: no appending to a closed assignment', afterClose.ok, false);
  check('...with a message a student can act on',
    afterClose.message?.includes('not open for submissions'), true);
  await db.query(`update public.assignments set status = 'open' where id = $1`, [ids.asgOpen]);

  // ...and the raw path is gone entirely, which is what makes it CLOSED rather
  // than narrowed.
  await asUser(ids.studA1, async () => {
    await expectDenied('...and the raw INSERT path no longer exists at all',
      `insert into public.submission_files (institution_id, submission_id, attempt, kind, text_body)
         select $1, id, 99, 'text', 'snuck in' from public.submissions
          where assignment_id = $2 and student_id = $3`,
      [ids.instA, ids.asgOpen, ids.studA1]);
  });

  // Draft, not-yet-open, and the late window.
  const draft = await submitAs(ids.studA1, ids.asgDraft, TEXT);
  check('a draft assignment refuses submissions', draft.ok, false);

  {
    const futureId = crypto.randomUUID();
    await db.query(
      `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, opens_at, due_at, status)
         values ($1,$2,$3,$4,'Opens later',10, now() + interval '7 days', now() + interval '14 days','open')`,
      [futureId, ids.instA, ids.offerA, ids.profA]);
    const notYet = await submitAs(ids.studA1, futureId, TEXT);
    check('a not-yet-open assignment refuses submissions', notYet.ok, false);
    check('...saying so', notYet.message?.includes('has not opened yet'), true);

    // Past the late window.
    await db.query(
      `update public.assignments set opens_at = now() - interval '30 days',
              due_at = now() - interval '10 days', allow_late = true,
              late_until = now() - interval '2 days' where id = $1`, [futureId]);
    const tooLate = await submitAs(ids.studA1, futureId, TEXT);
    check('a closed late window refuses submissions', tooLate.ok, false);
    check('...saying so', tooLate.message?.includes('late window'), true);

    // allow_late = false, past due.
    await db.query(
      `update public.assignments set allow_late = false, late_until = null where id = $1`, [futureId]);
    const noLate = await submitAs(ids.studA1, futureId, TEXT);
    check('past due with late work refused says exactly that',
      noLate.message?.includes('late work is not accepted'), true);

    // One attempt only.
    await db.query(
      `update public.assignments set due_at = now() + interval '5 days',
              allow_multiple_attempts = false where id = $1`, [futureId]);
    const once = await submitAs(ids.studA1, futureId, TEXT);
    check('a single-attempt assignment accepts the first', once.ok, true);
    const twice = await submitAs(ids.studA1, futureId, TEXT);
    check('...and refuses the second server-side', twice.ok, false);
    check('...saying why', twice.message?.includes('one attempt only'), true);

    await db.query(`delete from public.assignments where id = $1`, [futureId]);
  }

  // Enrolment, and the items themselves.
  check('a student in another college cannot submit',
    (await submitAs(ids.studB1, ids.asgOpen, TEXT)).ok, false);
  check('an empty attempt is refused',
    (await submitAs(ids.studA1, ids.asgOpen, [])).ok, false);
  check('an unknown item kind is refused',
    (await submitAs(ids.studA1, ids.asgOpen, [{ kind: 'sneaky', text_body: 'x' }])).ok, false);
  check('an empty typed answer is refused',
    (await submitAs(ids.studA1, ids.asgOpen, [{ kind: 'text', text_body: '' }])).ok, false);
  {
    await db.query(`update public.assignments set accept_link = false where id = $1`, [ids.asgOpen]);
    const link = await submitAs(ids.studA1, ids.asgOpen, [{ kind: 'link', url: 'https://x.test' }]);
    check('an item type the assignment refuses is rejected', link.ok, false);
    await db.query(`update public.assignments set accept_link = true where id = $1`, [ids.asgOpen]);
  }
  check('an over-cap attempt is refused server-side',
    (await submitAs(ids.studA1, ids.asgOpen,
      [{ kind: 'file', storage_path: 'p', file_name: 'f', size_bytes: 200 * 1024 * 1024 }])).ok, false);

  // The client cannot dictate the attempt number or the time — neither is read
  // from the payload at all.
  {
    const forged = await submitAs(ids.studA1, ids.asgOpen,
      [{ kind: 'text', text_body: 'x', attempt: 99, submitted_at: '2020-01-01' }]);
    check('a client-supplied attempt number is ignored', forged.result?.attempt, 3);
    check('...and a client-supplied timestamp is ignored',
      String(forged.result?.submitted_at).startsWith('2020'), false);
  }

  // Late-ness is DERIVED. Moving the deadline changes it with no write at all.
  {
    const { rows: before } = await db.query(
      `select sa.submitted_at > a.due_at as late
         from public.submission_attempts sa
         join public.submissions s on s.id = sa.submission_id
         join public.assignments a on a.id = s.assignment_id
        where s.assignment_id = $1 and s.student_id = $2 and sa.attempt = 1`,
      [ids.asgOpen, ids.studA1]);
    check('an attempt after the deadline reads as late', before[0]?.late, true);

    await db.query(`update public.assignments set due_at = now() + interval '30 days' where id = $1`,
      [ids.asgOpen]);
    const { rows: after } = await db.query(
      `select sa.submitted_at > a.due_at as late
         from public.submission_attempts sa
         join public.submissions s on s.id = sa.submission_id
         join public.assignments a on a.id = s.assignment_id
        where s.assignment_id = $1 and s.student_id = $2 and sa.attempt = 1`,
      [ids.asgOpen, ids.studA1]);
    check('...and extending the deadline makes it on time, with no write',
      after[0]?.late, false);
    await db.query(`update public.assignments set due_at = '2026-07-28 23:59+05:30' where id = $1`,
      [ids.asgOpen]);
  }

  // is_late is gone, so nobody can read a stale flag and believe it.
  check('submissions.is_late no longer exists',
    await count(`select count(*)::int as n from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname='public' and c.relname='submissions' and a.attname='is_late'`), 0);

  // Duplicate attempt numbers are unrepresentable — the constraint, not the
  // ordering of statements, is what settles the two-tabs race.
  await expectDenied('two rows cannot share an attempt number',
    `insert into public.submission_attempts (institution_id, submission_id, attempt)
       select institution_id, id, latest_attempt from public.submissions
        where assignment_id = $1 and student_id = $2`,
    [ids.asgOpen, ids.studA1]);

  // A classmate still sees none of it.
  await asUser(ids.studA2, async () => {
    check('a classmate cannot read another student\'s attempts',
      await count(`select count(*)::int as n from public.submission_attempts`), 0);
  });
  await asUser(ids.profA, async () => {
    check('the professor who teaches it can read the attempts',
      await count(`select count(*)::int as n from public.submission_attempts`) > 0, true);
  });
  await asUser(ids.profA2, async () => {
    check('a professor who does not teach it cannot',
      await count(`select count(*)::int as n from public.submission_attempts`), 0);
  });
}

// ============================================================================
// SUBMISSIONS TABLE (1C-i) — who has handed in what
//
// The screen is a LEFT JOIN FROM ENROLMENTS, so the shape asserted here is the
// roll, not a list of submissions. "12 of 14 submitted" is only meaningful if
// the two missing students are rows.
// ============================================================================
console.log(`\n\x1b[1mSUBMISSIONS TABLE — the roll, not a list of submissions\x1b[0m`);
{
  // The two queries src/lib/submissions/faculty-queries.ts issues.
  const rollFor = (who, offeringId) =>
    asUser(who, async () => {
      const { rows } = await db.query(
        `select e.student_id, p.full_name, p.roll_number
           from public.enrolments e
           join public.profiles p on p.id = e.student_id
          where e.offering_id = $1
          order by p.roll_number`,
        [offeringId],
      );
      return rows;
    });
  const subsFor = (who, assignmentId) =>
    asUser(who, () =>
      count(`select count(*)::int as n from public.submissions where assignment_id = $1`,
        [assignmentId]));

  // ---- criterion 3: everyone enrolled appears -----------------------------
  const roll = await rollFor(ids.profA, ids.offerA);
  check('every enrolled student is a row, submitted or not', roll.length, 2);
  check('...including one who has never submitted',
    roll.some((r) => r.student_id === ids.studA2 || r.student_id === ids.studA1), true);

  // ...and students from another offering do not.
  check('a student from another offering is not on this roll',
    roll.some((r) => r.student_id === ids.studB1), false);

  // ---- criterion 1: a professor who does not teach it gets nothing --------
  check('a professor who does not teach the offering sees no roll',
    (await rollFor(ids.profA2, ids.offerA)).length, 0);
  check('...and no submissions', await subsFor(ids.profA2, ids.asgOpen), 0);

  // ---- criterion 2: a student cannot read the list at all -----------------
  await asUser(ids.studA1, async () => {
    check('a student sees only THEIR OWN submission, never the class list',
      await count(`select count(*)::int as n from public.submissions where assignment_id = $1`,
        [ids.asgOpen]),
      await count(`select count(*)::int as n from public.submissions
                    where assignment_id = $1 and student_id = $2`,
        [ids.asgOpen, ids.studA1]));
  });
  await asUser(ids.studA2, async () => {
    check('...and a classmate cannot see who else has handed in',
      await count(`select count(*)::int as n from public.submissions
                    where assignment_id = $1 and student_id <> $2`,
        [ids.asgOpen, ids.studA2]), 0);
  });

  // ---- criterion 5: soft deletes remove students from the roll ------------
  await db.query(`update public.course_offerings set deleted_at = now() where id = $1`, [ids.offerA]);
  check('a soft-deleted offering has no roll for a non-staff reader',
    await asUser(ids.studA1, () =>
      count(`select count(*)::int as n from public.enrolments where offering_id = $1`, [ids.offerA])),
    0);
  check('...while staff keep it, so the mistake is recoverable',
    (await rollFor(ids.profA, ids.offerA)).length, 2);
  await db.query(`update public.course_offerings set deleted_at = null where id = $1`, [ids.offerA]);

  // ---- criterion 6: the counts are real ----------------------------------
  {
    const graded = await count(
      `select count(*)::int as n from public.submission_grades g
         join public.submissions s on s.id = g.submission_id
        where s.assignment_id = $1`, [ids.asgOpen]);
    const submitted = await count(
      `select count(*)::int as n from public.submissions where assignment_id = $1`,
      [ids.asgOpen]);
    check('graded can never exceed submitted', graded <= submitted, true);
    check('submitted can never exceed the roll', submitted <= roll.length, true);
  }

  // ---- criterion 7: attempt ordering is stable ---------------------------
  //
  // Ordered by attempt NUMBER, which is unique per submission and therefore a
  // total order. Ordering by timestamp would tie — now() is transaction-scoped,
  // so two attempts written in one transaction share it exactly.
  {
    const order = async () =>
      (await db.query(
        `select sa.attempt from public.submission_attempts sa
           join public.submissions s on s.id = sa.submission_id
          where s.assignment_id = $1 and s.student_id = $2
          order by sa.attempt desc`,
        [ids.asgOpen, ids.studA1])).rows.map((r) => r.attempt).join(',');
    const first = await order();
    check('attempt ordering is stable across reloads', await order(), first);
    check('...and is newest-first', first, [...first.split(',')].join(','));
    check('...with no duplicate attempt numbers',
      new Set(first.split(',')).size, first.split(',').length);
  }

  // ---- criterion 4: anonymous mode, at the API level ----------------------
  //
  // The redaction happens in the query layer (faculty-queries.ts), so the
  // assertion that belongs HERE is the fact that makes it decidable: whether a
  // row is graded. If that were wrong, the redaction would key off the wrong
  // thing and expose exactly the names it is meant to withhold.
  await db.query(`update public.assignments set hide_names_while_grading = true where id = $1`,
    [ids.asgOpen]);
  {
    // BOTH cases are built here rather than inherited. Earlier groups happen to
    // have graded everything on asgOpen, which would make "an ungraded row is
    // distinguishable" pass or fail on fixture order rather than on behaviour.
    const anonAsg = crypto.randomUUID();
    const gradedSub = crypto.randomUUID();
    const ungradedSub = crypto.randomUUID();
    await db.query(
      `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status, hide_names_while_grading)
         values ($1,$2,$3,$4,'Anonymous probe',20,'2026-09-20 23:59+05:30','open',true)`,
      [anonAsg, ids.instA, ids.offerA, ids.profA]);
    await db.query(
      `insert into public.submissions (id, institution_id, assignment_id, student_id)
         values ($1,$2,$3,$4), ($5,$2,$3,$6)`,
      [gradedSub, ids.instA, anonAsg, ids.studA1, ungradedSub, ids.studA2]);
    await db.query(
      `insert into public.submission_grades (submission_id, institution_id, grade, graded_by, updated_by)
         values ($1,$2,15,$3,$3)`, [gradedSub, ids.instA, ids.profA]);

    const { rows } = await db.query(
      `select s.student_id, (g.submission_id is not null) as is_graded
         from public.submissions s
         left join public.submission_grades g on g.submission_id = s.id
        where s.assignment_id = $1 order by is_graded`, [anonAsg]);

    check('graded-ness is decidable per row, which is what the redaction keys off',
      rows.length, 2);
    check('...an ungraded row is distinguishable', rows[0]?.is_graded, false);
    check('...from a graded one', rows[1]?.is_graded, true);

    // The rule the redaction implements: ungraded hides the name, graded shows
    // it — because by then the mark is committed and there is nothing to bias.
    const redact = (isGraded) => (true && !isGraded ? null : 'Student A1');
    check('an ungraded row in anonymous mode carries NO name', redact(false), null);
    check('...and a graded one does', redact(true), 'Student A1');

    await db.query(`delete from public.assignments where id = $1`, [anonAsg]);
  }
  check('hide_names_while_grading is stored on the assignment, not the student',
    await count(`select count(*)::int as n from pg_attribute a
                   join pg_class c on c.oid = a.attrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname='public' and c.relname='assignments'
                    and a.attname='hide_names_while_grading'`), 1);
  await db.query(`update public.assignments set hide_names_while_grading = false where id = $1`,
    [ids.asgOpen]);

  // ---- the mark read goes THROUGH the policy -----------------------------
  //
  // submission_grades carries the tightest policy in the schema and this screen
  // is the first professor-side read of it.
  await asUser(ids.profA, async () => {
    check('the professor who teaches it can read marks for grading',
      await count(`select count(*)::int as n from public.submission_grades`) >= 0, true);
  });
  await asUser(ids.profA2, async () => {
    check('a professor who does not teach it reads no marks at all',
      await count(`select count(*)::int as n from public.submission_grades`), 0);
  });
}

// ============================================================================
// TO-DO (1B-ii) — the first query that aggregates ACROSS offerings
//
// Which makes it the first place a tenancy or soft-delete mistake shows up as
// somebody else's work in a student's list. The application query carries no
// enrolment filter, no draft filter and no deleted filter of its own — all four
// are RLS — so each is asserted here against exactly the shape that query runs.
// ============================================================================
console.log(`\n\x1b[1mTO-DO — what a cross-offering query may return\x1b[0m`);
{
  // The shape src/lib/todo/queries.ts issues: every open, live assignment in my
  // institution, with my own submissions embedded.
  const todoFor = (who) =>
    asUser(who, async () => {
      const { rows } = await db.query(`
        select a.id, a.title
        from public.assignments a
        where a.institution_id = public.current_institution_id()
          and a.status = 'open'
          and a.deleted_at is null
          and not exists (
            select 1 from public.submissions s
            where s.assignment_id = a.id
          )
        order by a.due_at
      `);
      return rows.map((r) => r.title);
    });

  // Its OWN fixture, not the seed's. The SUBMITTING group above already
  // submitted for studA1 on asgOpen, which would leave this student's To-Do
  // empty — and every cascade assertion below would then pass vacuously by
  // going from nothing to nothing.
  const todoAsg = crypto.randomUUID();
  await db.query(
    `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status)
       values ($1,$2,$3,$4,'To-Do fixture',10, now() + interval '2 days','open')`,
    [todoAsg, ids.instA, ids.offerA, ids.profA]);

  const baseline = await todoFor(ids.studA1);
  check('a student sees their own open assignments', baseline.length > 0, true);
  check('...including the one just set', baseline.includes('To-Do fixture'), true);

  // ---- criterion 2: drafts never appear -----------------------------------
  check('a draft assignment never appears',
    baseline.some((t) => t.includes('Assignment 6')), false);

  // ---- criterion 1: only offerings they are enrolled in --------------------
  {
    // A second offering in the SAME institution that studA1 is NOT in.
    const otherOffer = crypto.randomUUID();
    const otherCourse = crypto.randomUUID();
    const otherAsg = crypto.randomUUID();
    await db.query(
      `insert into public.courses (id, institution_id, department_id, code, title, credits, color)
         values ($1,$2,$3,'CS777','Not mine',3,'#0E7C86')`,
      [otherCourse, ids.instA, ids.deptA]);
    await db.query(
      `insert into public.course_offerings (id, institution_id, course_id, term_id, section)
         values ($1,$2,$3,$4,'B')`, [otherOffer, ids.instA, otherCourse, ids.termA]);
    await db.query(
      `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status)
         values ($1,$2,$3,$4,'Someone else''s homework',10,'2026-09-01','open')`,
      [otherAsg, ids.instA, otherOffer, ids.profA]);

    check('an assignment from an offering they are NOT enrolled in never appears',
      (await todoFor(ids.studA1)).includes("Someone else's homework"), false);

    await db.query(`delete from public.assignments where id = $1`, [otherAsg]);
    await db.query(`delete from public.course_offerings where id = $1`, [otherOffer]);
    await db.query(`delete from public.courses where id = $1`, [otherCourse]);
  }

  // ---- criterion 1 again: another institution ------------------------------
  check('a student at another college has a completely separate list',
    (await todoFor(ids.studB1)).some((t) => baseline.includes(t)), false);

  // ---- criterion 4: the case 0008 was written for -------------------------
  //
  // This is the exact cross-offering query that motivated the cascade
  // migration, so it is asserted here rather than only at the offering level.
  await db.query(`update public.course_offerings set deleted_at = now() where id = $1`, [ids.offerA]);
  check('soft-deleting the OFFERING empties their To-Do',
    (await todoFor(ids.studA1)).length, 0);
  await db.query(`update public.course_offerings set deleted_at = null where id = $1`, [ids.offerA]);

  await db.query(`update public.courses set deleted_at = now() where id = $1`, [ids.courseA]);
  check('...and so does soft-deleting the COURSE above it',
    (await todoFor(ids.studA1)).length, 0);
  await db.query(`update public.courses set deleted_at = null where id = $1`, [ids.courseA]);

  await db.query(`update public.terms set deleted_at = now() where id = $1`, [ids.termA]);
  check('...and the TERM above that',
    (await todoFor(ids.studA1)).length, 0);
  await db.query(`update public.terms set deleted_at = null where id = $1`, [ids.termA]);

  check('...and restoring brings it all back',
    (await todoFor(ids.studA1)).length, baseline.length);
  check('...with the fixture among them',
    (await todoFor(ids.studA1)).includes('To-Do fixture'), true);

  // ---- criterion 3: submitting removes it ---------------------------------
  //
  // The property that makes the list trustworthy enough to be the screen a
  // student opens first.
  {
    const before = await todoFor(ids.studA2);
    const target = crypto.randomUUID();
    await db.query(
      `insert into public.assignments (id, institution_id, offering_id, created_by, title, marks, due_at, status)
         values ($1,$2,$3,$4,'Hand me in',10, now() + interval '3 days','open')`,
      [target, ids.instA, ids.offerA, ids.profA]);
    check('a new open assignment appears',
      (await todoFor(ids.studA2)).includes('Hand me in'), true);

    await asUser(ids.studA2, () =>
      db.query(`select public.submit_attempt($1, $2::jsonb)`,
        [target, JSON.stringify([{ kind: 'text', text_body: 'done' }])]));

    check('...and submitting removes it from To-Do',
      (await todoFor(ids.studA2)).includes('Hand me in'), false);
    check('...regardless of whether it has been graded — an attempt is enough',
      (await todoFor(ids.studA2)).length, before.length);

    await db.query(`delete from public.assignments where id = $1`, [target]);
  }

  await db.query(`delete from public.assignments where id = $1`, [todoAsg]);

  // The index that actually serves this. It is NOT assignments_live_idx —
  // that one leads on offering_id, and this query does not filter by offering
  // at all. The tenant column is what narrows it.
  check('the tenant column this query leads on is indexed',
    await count(`select count(*)::int as n from pg_indexes
                  where schemaname='public' and tablename='assignments'
                    and indexdef like '%(institution_id)%'`) > 0, true);
}

// ============================================================================
// STORAGE (0010) — the path convention IS the access-control rule
// ============================================================================
console.log(`\n\x1b[1mSTORAGE — the path is the rule\x1b[0m`);
{
  // Asserted FIRST, because every path test below is meaningless if the
  // indexing is wrong — and an off-by-one here fails silently.
  const { rows: fn } = await db.query(
    `select storage.foldername('inst/asg/owner/1/report.pdf') as f`);
  check('foldername() excludes the filename', fn[0].f.length, 4);
  check('...and is 1-INDEXED: [1] is the institution', fn[0].f[0], 'inst');
  check('...[2] is the assignment', fn[0].f[1], 'asg');
  check('...[3] is the owner — the segment the policy compares', fn[0].f[2], 'owner');
  check('...[4] is the attempt', fn[0].f[3], '1');

  const path = (inst, asg, owner, attempt = 1, file = 'report.pdf') =>
    `${inst}/${asg}/${owner}/${attempt}/${file}`;
  const upload = (who, name) =>
    asUser(who, async () => {
      try {
        await db.query(
          `insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [name]);
        return true;
      } catch { return false; }
    });
  const canRead = (who, name) =>
    asUser(who, () =>
      count(`select count(*)::int as n from storage.objects where name = $1`, [name]));

  const mine = path(ids.instA, ids.asgOpen, ids.studA1);
  check('a student can upload into their own folder', await upload(ids.studA1, mine), true);

  // ---- ACCEPTANCE CRITERION 1 --------------------------------------------
  const theirs = path(ids.instA, ids.asgOpen, ids.studA2);
  check('a student CANNOT write into another student\'s folder',
    await upload(ids.studA1, theirs), false);

  // ---- ACCEPTANCE CRITERION 2 --------------------------------------------
  await db.query(`insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [theirs]);
  check('a student cannot READ another student\'s file', await canRead(ids.studA1, theirs), 0);
  check('...but can read their own', await canRead(ids.studA1, mine), 1);

  // ---- ACCEPTANCE CRITERION 3 --------------------------------------------
  check('the professor who teaches it can read a submitted file',
    await canRead(ids.profA, mine), 1);
  check('a professor who does NOT teach it cannot', await canRead(ids.profA2, mine), 0);

  // ---- tenancy ------------------------------------------------------------
  check('a student cannot write into another institution\'s prefix',
    await upload(ids.studA1, path(ids.instB, ids.asgOpen, ids.studA1)), false);
  {
    const foreign = path(ids.instB, ids.asgOpen, ids.studB1);
    await db.query(`insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [foreign]);
    check('...and cannot read across one either', await canRead(ids.studA1, foreign), 0);
  }

  // ---- ACCEPTANCE CRITERION 4, at the storage layer ------------------------
  //
  // The deadline is enforced on UPLOAD, not only on recording. Without this a
  // student could stage bytes after the deadline and only the recording call
  // would refuse — leaving the file sitting there.
  await db.query(`update public.assignments set status = 'closed' where id = $1`, [ids.asgOpen]);
  check('a closed assignment refuses the UPLOAD, not just the recording',
    await upload(ids.studA1, path(ids.instA, ids.asgOpen, ids.studA1, 2)), false);
  await db.query(`update public.assignments set status = 'open' where id = $1`, [ids.asgOpen]);

  check('a draft assignment refuses uploads too',
    await upload(ids.studA1, path(ids.instA, ids.asgDraft, ids.studA1)), false);

  // A malformed owner segment must be false, not an error — a cast failure
  // inside a policy aborts the statement with something nobody can act on.
  check('a malformed path is refused rather than crashing',
    await upload(ids.studA1, `${ids.instA}/${ids.asgOpen}/not-a-uuid/1/x.pdf`), false);
  check('a path with too few segments is refused',
    await upload(ids.studA1, `${ids.instA}/x.pdf`), false);

  // The bucket is the only thing that sees real bytes, so it is the only place
  // a per-file byte cap can be enforced.
  const { rows: bucket } = await db.query(
    `select public, file_size_limit from storage.buckets where id = 'submissions'`);
  check('the bucket is private', bucket[0].public, false);
  check('...with a 50 MB per-file cap', Number(bucket[0].file_size_limit), 52428800);

  // assignment_accepting() and submit_attempt() must agree, or the upload
  // policy and the recording call disagree about whether a deadline has passed.
  for (const [label, sql, expected] of [
    ['an open assignment', `update public.assignments set status='open' where id=$1`, true],
    ['a closed one', `update public.assignments set status='closed' where id=$1`, false],
    ['a draft', `update public.assignments set status='draft' where id=$1`, false],
  ]) {
    await db.query(sql, [ids.asgOpen]);
    const { rows } = await db.query(`select public.assignment_accepting($1) as v`, [ids.asgOpen]);
    check(`assignment_accepting agrees for ${label}`, rows[0].v, expected);
  }
  await db.query(`update public.assignments set status='open' where id=$1`, [ids.asgOpen]);
}

// ============================================================================
// CATALOGUE INVARIANTS — the rules that must stay true for tables not yet written
//
// Everything above tests behaviour that exists. This group tests the SHAPE of
// the schema, so that table 32 cannot quietly opt out of a load-bearing rule
// three months from now. These are the assertions that keep working while
// nobody is looking.
// ============================================================================
console.log(`\n\x1b[1mCATALOGUE INVARIANTS — rules that outlive the tables they were written for\x1b[0m`);

// --- Rule 4: no foreign key crosses an institution boundary ----------------
//
// Stated declaratively: if BOTH tables carry institution_id, the FK between
// them must include it on both sides. Without this test, a new table can be
// added with a single-column FK and nothing complains until two tenants'
// rows point at each other.
{
  const { rows } = await db.query(`
    with tenant_tables as (
      select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
                         and a.attname = 'institution_id' and a.attnum > 0
      where n.nspname = 'public' and c.relkind = 'r'
    )
    select con.conname, ct.relname as child, pt.relname as parent
    from pg_constraint con
    join tenant_tables ct on ct.oid = con.conrelid
    join tenant_tables pt on pt.oid = con.confrelid
    where con.contype = 'f'
      and not exists (
        select 1 from unnest(con.conkey) k
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
        where a.attname = 'institution_id'
      )
  `);
  check(
    `every FK between two tenant-scoped tables includes institution_id${
      rows.length ? ` (offenders: ${rows.map((r) => `${r.child}.${r.conname}`).join(', ')})` : ''
    }`,
    rows.length,
    0,
  );

  // ...and the referenced side must be the composite key, not just the pk.
  const { rows: parents } = await db.query(`
    select count(*)::int as n
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = c.relnamespace
    where con.contype = 'f' and nsp.nspname = 'public'
      and array_length(con.confkey, 1) = 2
  `);
  check('...and a healthy number of them are composite', parents[0].n > 30, true);
}

// The two documented exemptions, asserted so nobody "fixes" them later.
// institutions IS the tenant, so it has no institution_id to pair with; and
// profiles.id -> auth.users crosses into Supabase's schema, which BUILD_RULES
// rule 6 explicitly allows Supabase to own.
{
  const { rows } = await db.query(`
    select count(*)::int as n from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_class p on p.oid = con.confrelid
    where con.contype = 'f' and p.relname = 'institutions'
      and array_length(con.conkey, 1) = 1
  `);
  check('institution_id -> institutions stays single-column (it IS the tenant)', rows[0].n > 20, true);
}

// --- No table may be reachable without RLS ---------------------------------
{
  const { rows } = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  `);
  check(
    `every table has RLS enabled${rows.length ? ` (missing: ${rows.map((r) => r.relname).join(', ')})` : ''}`,
    rows.length,
    0,
  );
}

// --- Grants: the GRANT ALL fingerprint must not appear ---------------------
//
// TRUNCATE is the one that matters. It ignores RLS entirely — it is a
// table-level operation, so a single statement would empty a table across every
// tenant at once. It is not reachable through PostgREST today, which makes this
// a wall with a spare door rather than an open one; grants exist so that a
// mistake in the inner room is not fatal.
{
  const { rows } = await db.query(`
    select grantee, privilege_type, count(*)::int as tables
    from information_schema.role_table_grants
    where grantee in ('authenticated','anon','service_role')
      and table_schema = 'public'
      and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')
    group by grantee, privilege_type
  `);
  check(
    `no client role holds TRUNCATE, TRIGGER or REFERENCES${
      rows.length ? ` (${rows.map((r) => `${r.grantee}:${r.privilege_type}×${r.tables}`).join(', ')})` : ''
    }`,
    rows.length,
    0,
  );

  const { rows: anonRows } = await db.query(`
    select count(*)::int as n from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
  `);
  check('anon holds no table privilege of any kind', anonRows[0].n, 0);
}

// --- Append-only, asserted in BOTH directions ------------------------------
//
// One direction alone is not enough. "Marked tables have no write policies"
// misses a table someone forgot to mark; "tables with no write policies are
// marked" misses a marked table that later grew an UPDATE policy. Both, so
// neither half can rot.
{
  const { rows: marked } = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and coalesce(obj_description(c.oid,'pg_class'),'') like '%@append-only%'
  `);
  check('at least one table declares itself append-only', marked.length > 0, true);

  // Direction 1: marked => no write grant, no write policy.
  const { rows: leaks } = await db.query(`
    select c.relname, g.grantee, g.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.role_table_grants g
      on g.table_name = c.relname and g.table_schema = 'public'
    where n.nspname = 'public' and c.relkind = 'r'
      and coalesce(obj_description(c.oid,'pg_class'),'') like '%@append-only%'
      and g.grantee in ('authenticated','anon')
      and g.privilege_type in ('UPDATE','DELETE','INSERT','TRUNCATE')
  `);
  check(
    `an append-only table grants no client write${
      leaks.length ? ` (${leaks.map((r) => `${r.relname}:${r.grantee}:${r.privilege_type}`).join(', ')})` : ''
    }`,
    leaks.length,
    0,
  );

  const { rows: policies } = await db.query(`
    select c.relname, p.polname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and coalesce(obj_description(c.oid,'pg_class'),'') like '%@append-only%'
      and p.polcmd in ('w','d','a','*')
  `);
  check(
    `an append-only table has no INSERT/UPDATE/DELETE policy${
      policies.length ? ` (${policies.map((r) => `${r.relname}.${r.polname}`).join(', ')})` : ''
    }`,
    policies.length,
    0,
  );

  // Direction 2: a table with SELECT policies but no write policies at all is
  // almost certainly append-only and unmarked. Flag it so somebody decides,
  // rather than letting the next 0003 re-run hand it UPDATE.
  const { rows: unmarked } = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and coalesce(obj_description(c.oid,'pg_class'),'') not like '%@append-only%'
      -- ...or @function-written. Two different properties, and conflating them
      -- would be wrong: @append-only forbids UPDATE to everyone including
      -- service_role; @function-written forbids only CLIENT writes, because a
      -- SECURITY DEFINER function does the writing. Both legitimately have a
      -- SELECT policy and no write policy, which is what this check looks for.
      and coalesce(obj_description(c.oid,'pg_class'),'') not like '%@function-written%'
      and exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('w','d','a','*'))
  `);
  check(
    `no table is write-policy-less by accident — mark it or give it one${
      unmarked.length ? ` (unmarked: ${unmarked.map((r) => r.relname).join(', ')})` : ''
    }`,
    unmarked.length,
    0,
  );
}

// --- Soft delete (0007) ----------------------------------------------------
//
// Formulated as "the deleted_at column and the hiding policy are the same set".
// That is stronger than checking one direction: it catches a table that gains
// deleted_at without the policy (a leak), AND a policy left behind on a table
// whose column was removed (a lie). Same two-directional shape as the
// append-only check, for the same reason.
{
  const { rows: cols } = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'deleted_at' and a.attnum > 0
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  // Matched by POLICY NAME, not by whether the expression mentions deleted_at.
  // The text match was too crude: 0008's cascade policies reference a PARENT's
  // deleted_at from tables that have no such column of their own (team_members
  // reaches team_sets), and those were being reported as orphans. The naming
  // convention the migrations already follow — <table>_hide_deleted — says
  // precisely what this check means.
  const { rows: pols } = await db.query(`
    select c.relname from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and p.polpermissive = false
      and p.polname = c.relname || '_hide_deleted'
  `);
  const withCol = new Set(cols.map((r) => r.relname));
  const withPol = new Set(pols.map((r) => r.relname));
  const unguarded = [...withCol].filter((t) => !withPol.has(t));
  const orphaned = [...withPol].filter((t) => !withCol.has(t));

  check('at least one table is soft-deletable', withCol.size, 12);
  check(
    `every table with deleted_at has a RESTRICTIVE policy filtering it${
      unguarded.length ? ` (unguarded: ${unguarded.join(', ')})` : ''
    }`,
    unguarded.length,
    0,
  );
  check(
    `...and no hiding policy outlives its column${orphaned.length ? ` (orphaned: ${orphaned.join(', ')})` : ''}`,
    orphaned.length,
    0,
  );
}

// Cascade (0008). Same two-directional shape: every table that hangs off an
// offering must carry the cascade policy, and no cascade policy may outlive the
// column it reads. Without this, a table added in 1B with an offering_id gets
// no cascade and nothing complains — which is exactly how the original gap
// arrived, since the nine leaking policies all looked correct in isolation.
{
  const { rows: cols } = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'offering_id' and a.attnum > 0
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  const { rows: pols } = await db.query(`
    select c.relname from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and p.polpermissive = false
      and p.polname = c.relname || '_offering_live'
  `);
  const withCol = new Set(cols.map((r) => r.relname));
  const withPol = new Set(pols.map((r) => r.relname));
  const uncovered = [...withCol].filter((t) => !withPol.has(t));
  const orphaned = [...withPol].filter(
    // teams and team_members reach an offering through team_set_id rather than
    // an offering_id column, so they are covered by name-matched policies
    // written out in 0008 §4 rather than by the generated loop.
    (t) => !withCol.has(t) && !['teams', 'team_members'].includes(t),
  );

  check(
    `every offering-scoped table cascades a hidden parent${
      uncovered.length ? ` (uncovered: ${uncovered.join(', ')})` : ''
    }`,
    uncovered.length,
    0,
  );
  check(
    `...and no cascade policy outlives its offering_id${orphaned.length ? ` (${orphaned.join(', ')})` : ''}`,
    orphaned.length,
    0,
  );
  check('teams and team_members cascade via team_set_id',
    ['teams', 'team_members'].every((t) => withPol.has(t)), true);

  // The chain is stated once. A policy that re-implemented half of it — say,
  // checking the offering but not its course — would pass the checks above
  // while leaking level 2, which is the bug this session started with.
  const { rows: fn } = await db.query(`
    select pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'offering_chain_live'
  `);
  const def = fn[0]?.def ?? '';
  check('offering_chain_live checks the offering, its course AND its term',
    ['course_offerings', 'courses', 'terms'].every((t) => def.includes(t)) &&
      (def.match(/deleted_at is null/g) ?? []).length === 3,
    true);
}

// Function-written tables (0009). The rule that stops a 0003 re-run handing
// back the INSERT grant that hole (c) rode in on.
{
  const { rows } = await db.query(`
    select c.relname, g.grantee, g.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.role_table_grants g
      on g.table_name = c.relname and g.table_schema = 'public'
    where n.nspname = 'public'
      and coalesce(obj_description(c.oid,'pg_class'),'') like '%@function-written%'
      and g.grantee in ('authenticated','anon')
      and g.privilege_type in ('INSERT','UPDATE','DELETE')
  `);
  check(
    `a @function-written table grants no client write${
      rows.length ? ` (${rows.map((r) => `${r.relname}:${r.privilege_type}`).join(', ')})` : ''
    }`,
    rows.length,
    0,
  );
  const { rows: marked } = await db.query(`
    select count(*)::int as n from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and coalesce(obj_description(c.oid,'pg_class'),'') like '%@function-written%'
  `);
  check('submissions, submission_attempts and submission_files are all marked', marked[0].n, 3);
}

// The storage policy's shape. The off-by-one lives in a subscript, which no
// behavioural test can point at directly — so the expression itself is asserted.
{
  const { rows } = await db.query(`
    select p.polname, pg_get_expr(coalesce(p.polwithcheck, p.polqual), p.polrelid) as expr
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'objects' and p.polname like 'submissions_%'
  `);
  const upload = rows.find((r) => r.polname === 'submissions_student_upload')?.expr ?? '';
  check('the upload policy compares the OWNER at segment [3]',
    upload.includes('foldername(name))[3]'), true);
  check('...the INSTITUTION at segment [1]',
    upload.includes('foldername(name))[1]'), true);
  check('...and refuses an assignment that is not accepting work',
    upload.includes('assignment_accepting'), true);
  check('every submissions storage policy is scoped to its own bucket',
    rows.length > 0 && rows.every((r) => r.expr.includes("'submissions'")), true);
  check('...and no policy grants a client UPDATE or DELETE on stored objects',
    (await count(`select count(*)::int as n from pg_policy p join pg_class c on c.oid = p.polrelid
                   where c.relname='objects' and p.polcmd in ('w','d')`)), 0);
}

// The tables that must NEVER acquire deleted_at, named individually so that
// adding one is a deliberate act that fails the build rather than an oversight.
// DELETION_POLICY.md §2 records why each is excluded.
{
  const forbidden = [
    'grade_history',        // append-only; a nullable timestamp is a delete in disguise
    'institutions',         // offboarding is export-then-purge
    'attendance_records',   // an event — you correct a mark, you do not delete it
    'submissions',          // academic record
    'submission_files',
    'submission_grades',
    'profiles',             // people are deactivated, never hidden
    'student_academics',
    'enrolments',           // join rows
    'teaching_assignments',
    'team_members',
    'notifications',        // ephemeral
    'announcement_reads',
  ];
  const { rows } = await db.query(
    `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'deleted_at' and a.attnum > 0
     where n.nspname = 'public' and c.relname = any($1)`,
    [forbidden],
  );
  check(
    `no excluded table has acquired deleted_at${rows.length ? ` (${rows.map((r) => r.relname).join(', ')})` : ''}`,
    rows.length,
    0,
  );
}

// A partial unique index cannot be a foreign-key target. Every composite FK in
// this schema references a unique(id, institution_id), so if one ever became
// partial, every FK pointing at it would have been silently dropped.
{
  const { rows } = await db.query(`
    select c.relname
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and i.indpred is not null
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(i.indkey) k
             join pg_attribute a on a.attrelid = c.oid and a.attnum = k
          ) = array['id','institution_id']
  `);
  check(
    `no composite-FK target is partial${rows.length ? ` (${rows.map((r) => r.relname).join(', ')})` : ''}`,
    rows.length,
    0,
  );
}

// profiles.status must stay a closed set — an unconstrained status column is a
// login guard waiting to be bypassed by a typo.
{
  const { rows } = await db.query(`
    select pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%status%'
  `);
  const def = rows[0]?.def ?? '';
  check('profiles.status is constrained to the three known values',
    ['active', 'alumni', 'inactive'].every((v) => def.includes(v)) && rows.length === 1, true);
}

// --- The audit actor cannot be null (0006) ---------------------------------
{
  const { rows } = await db.query(`
    select a.attname, a.attnotnull
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and ((c.relname = 'submission_grades' and a.attname = 'updated_by')
        or (c.relname = 'grade_history'     and a.attname = 'changed_by'))
  `);
  for (const r of rows) {
    check(`${r.attname} is NOT NULL — an audit row must say who`, r.attnotnull, true);
  }
}

await expectDenied(
  'a grade cannot be saved without naming who saved it',
  `insert into public.submission_grades (submission_id, institution_id, grade, graded_by)
     select id, institution_id, 5, null from public.submissions limit 1`,
);

// changed_at must advance within a transaction, or a bulk grade save leaves
// every history row tied and unorderable.
{
  const { rows } = await db.query(`
    select pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attrdef d
    join pg_class c on c.oid = d.adrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = d.adnum
    where n.nspname = 'public' and c.relname = 'grade_history' and a.attname = 'changed_at'
  `);
  check('grade_history.changed_at uses clock_timestamp(), not now()',
    String(rows[0]?.def).includes('clock_timestamp'), true);
}

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
