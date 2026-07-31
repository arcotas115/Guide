/**
 * Seed one institution and two test users.
 *
 * WHY THIS IS A SCRIPT AND NOT SQL:
 * Auth users live in Supabase's `auth` schema, and their passwords are hashed by
 * the auth service. You cannot INSERT a usable login in the SQL editor. So this
 * calls the Admin API for identity, then writes the tenant rows.
 *
 * SECURITY: this is the only file in the repo that touches SUPABASE_SERVICE_ROLE_KEY.
 * It runs on your machine, never in the app, and never in the browser. The
 * service-role key bypasses every RLS policy — treat it like a root password.
 *
 *   npm run seed
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- What we are creating -------------------------------------------------
const INSTITUTION = {
  name: 'Meridian Institute of Technology',
  slug: 'meridian',
  min_attendance_pct: 75,
};

const PASSWORD = 'campus-test-1234';

const PROFESSOR = {
  email: 'professor@meridian.test',
  full_name: 'Dr. Vikram Shenoy',
  role: 'faculty' as const,
  roll_number: null,
  batch_year: null,
};

/**
 * Thirteen students, not two.
 *
 * The class average and median a student sees in Milestone 1D are computed over
 * whoever is enrolled. Two rows cannot tell a working median from a broken one —
 * with two marks, almost any implementation looks right. Thirteen is odd (so the
 * median is a real element, not an average of two) and large enough that an
 * off-by-one in the sort shows up.
 *
 * The first is the login you already use; the rest exist to be a class.
 */
const STUDENTS = [
  { email: 'student@meridian.test', full_name: 'Ananya Rao', roll_number: '21CS1043', cgpa: 8.4 },
  { email: 'rohan.iyer@meridian.test', full_name: 'Rohan Iyer', roll_number: '21CS1002', cgpa: 7.1 },
  { email: 'meera.nair@meridian.test', full_name: 'Meera Nair', roll_number: '21CS1007', cgpa: 9.1 },
  { email: 'arjun.deshpande@meridian.test', full_name: 'Arjun Deshpande', roll_number: '21CS1011', cgpa: 6.8 },
  { email: 'kavya.reddy@meridian.test', full_name: 'Kavya Reddy', roll_number: '21CS1015', cgpa: 8.9 },
  { email: 'imran.qureshi@meridian.test', full_name: 'Imran Qureshi', roll_number: '21CS1019', cgpa: 7.6 },
  { email: 'sneha.pillai@meridian.test', full_name: 'Sneha Pillai', roll_number: '21CS1023', cgpa: 8.2 },
  { email: 'aditya.kulkarni@meridian.test', full_name: 'Aditya Kulkarni', roll_number: '21CS1027', cgpa: 7.9 },
  { email: 'fatima.sheikh@meridian.test', full_name: 'Fatima Sheikh', roll_number: '21CS1031', cgpa: 9.3 },
  { email: 'nikhil.bhatt@meridian.test', full_name: 'Nikhil Bhatt', roll_number: '21CS1035', cgpa: 6.4 },
  { email: 'divya.menon@meridian.test', full_name: 'Divya Menon', roll_number: '21CS1039', cgpa: 8.7 },
  { email: 'harshith.gowda@meridian.test', full_name: 'Harshith Gowda', roll_number: '21CS1047', cgpa: 7.3 },
  { email: 'priya.saxena@meridian.test', full_name: 'Priya Saxena', roll_number: '21CS1051', cgpa: 8.0 },
] as const;

const COURSE = {
  code: 'CS301',
  title: 'Operating Systems',
  credits: 4,
  // The identity colour lives in the database, not in a constant in the code.
  // Institution #847 wanting a different palette must be an UPDATE, not a deploy.
  color: '#4C5BD4',
};

/** Days from now as an ISO timestamp. */
const days = (n: number) =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

/** Insert if absent, otherwise return the existing row. Makes reruns safe. */
async function upsertByUnique<T extends { id: string }>(
  table: string,
  match: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<T> {
  const existing = await admin.from(table).select('*').match(match).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as T;

  const inserted = await admin.from(table).insert(values).select().single();
  if (inserted.error) throw inserted.error;
  return inserted.data as T;
}

async function main() {
  console.log(`Seeding into ${url}\n`);

  // 1. The tenant.
  const institution = await upsertByUnique<{ id: string }>(
    'institutions',
    { slug: INSTITUTION.slug },
    INSTITUTION,
  );
  console.log(`institution  ${INSTITUTION.name}  (${institution.id})`);

  // 2. A department and a term — the minimum context a course needs later.
  const department = await upsertByUnique<{ id: string }>(
    'departments',
    { institution_id: institution.id, code: 'CSE' },
    {
      institution_id: institution.id,
      name: 'Computer Science & Engineering',
      code: 'CSE',
    },
  );
  console.log(`department   Computer Science & Engineering  (${department.id})`);

  const term = await upsertByUnique<{ id: string }>(
    'terms',
    { institution_id: institution.id, name: 'Odd Semester 2026' },
    {
      institution_id: institution.id,
      name: 'Odd Semester 2026',
      starts_on: '2026-07-01',
      ends_on: '2026-12-15',
    },
  );
  console.log(`term         Odd Semester 2026  (${term.id})\n`);

  // 3. Identity, then profile. Two separate systems: auth.users is Supabase's,
  //    public.profiles is ours. The id is the join between them.
  const professorId = await ensureAuthUser(PROFESSOR.email, PROFESSOR.full_name);
  await upsertProfile({
    id: professorId,
    institution_id: institution.id,
    department_id: department.id,
    role: 'faculty',
    full_name: PROFESSOR.full_name,
    email: PROFESSOR.email,
    roll_number: null,
    batch_year: null,
  });
  console.log(`faculty      ${PROFESSOR.full_name}  <${PROFESSOR.email}>`);

  const studentIds: string[] = [];
  for (const s of STUDENTS) {
    const id = await ensureAuthUser(s.email, s.full_name);
    await upsertProfile({
      id,
      institution_id: institution.id,
      department_id: department.id,
      role: 'student',
      full_name: s.full_name,
      email: s.email,
      roll_number: s.roll_number,
      batch_year: 2021,
    });

    // student_academics drives placement eligibility later; seeded now so that
    // surface has real spread to work against rather than thirteen identical rows.
    const academics = await admin.from('student_academics').upsert(
      {
        student_id: id,
        institution_id: institution.id,
        cgpa: s.cgpa,
        backlogs: 0,
        batch_year: 2021,
      },
      { onConflict: 'student_id' },
    );
    if (academics.error) throw academics.error;

    studentIds.push(id);
  }
  console.log(`students     ${studentIds.length} enrolled-eligible profiles\n`);

  // 4. The teaching context: a course, an offering of it this term, the
  //    professor assigned to teach it, and everyone enrolled.
  const course = await upsertByUnique<{ id: string }>(
    'courses',
    { institution_id: institution.id, code: COURSE.code },
    { institution_id: institution.id, department_id: department.id, ...COURSE },
  );
  console.log(`course       ${COURSE.code} ${COURSE.title}  (${COURSE.color})`);

  const offering = await upsertByUnique<{ id: string }>(
    'course_offerings',
    { course_id: course.id, term_id: term.id, section: 'A' },
    {
      institution_id: institution.id,
      course_id: course.id,
      term_id: term.id,
      section: 'A',
    },
  );
  console.log(`offering     ${COURSE.code} · Odd Semester 2026 · Section A`);

  const teaching = await admin.from('teaching_assignments').upsert(
    {
      institution_id: institution.id,
      offering_id: offering.id,
      faculty_id: professorId,
    },
    { onConflict: 'offering_id,faculty_id' },
  );
  if (teaching.error) throw teaching.error;
  console.log(`teaching     ${PROFESSOR.full_name} teaches it`);

  const enrolments = await admin.from('enrolments').upsert(
    studentIds.map((student_id) => ({
      institution_id: institution.id,
      offering_id: offering.id,
      student_id,
    })),
    { onConflict: 'offering_id,student_id' },
  );
  if (enrolments.error) throw enrolments.error;
  console.log(`enrolments   all ${studentIds.length} students\n`);

  // 5. One assignment per student-facing state.
  //
  //    Dates are RELATIVE TO NOW, never literals. A hardcoded "due 2026-08-10"
  //    seeds an Open assignment today and a silently Overdue one next month, and
  //    the person who hits that has no reason to suspect the fixture rather than
  //    the derivation. Every state below stays true whenever this is run.
  await seedAssignments({
    institutionId: institution.id,
    offeringId: offering.id,
    professorId,
    testStudentId: studentIds[0]!,
  });

  console.log(`\nDone. Sign in at http://localhost:3000/login`);
  console.log(`  ${STUDENTS[0].email}    ${PASSWORD}   -> /student`);
  console.log(`  ${PROFESSOR.email}  ${PASSWORD}   -> /faculty`);
  console.log(`\n  The other 12 students share the same password.`);
}

type ProfileRow = {
  id: string;
  institution_id: string;
  department_id: string;
  role: 'student' | 'faculty' | 'admin' | 'placement_officer';
  full_name: string;
  email: string;
  roll_number: string | null;
  batch_year: number | null;
};

async function upsertProfile(row: ProfileRow) {
  const { error } = await admin.from('profiles').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

/**
 * One assignment per student-facing state, so all five can be seen at once.
 *
 * The five states are DERIVED, never stored (SPEC.md §3.7) — there is no `state`
 * column and there must never be one. What is seeded here is the raw material
 * the derivation reads: status, opens_at, due_at, allow_late, late_until, the
 * student's own submission, and grades_released. If a screen shows the wrong
 * state, the bug is in deriveState(), not in a column someone forgot to update.
 */
async function seedAssignments(ctx: {
  institutionId: string;
  offeringId: string;
  professorId: string;
  testStudentId: string;
}) {
  const base = {
    institution_id: ctx.institutionId,
    offering_id: ctx.offeringId,
    created_by: ctx.professorId,
  };

  const specs = [
    {
      key: 'draft',
      renders: 'invisible to students',
      row: {
        ...base,
        title: 'Assignment 7 — Virtual memory',
        instructions:
          'Not finished writing this yet. Students must not be able to see it, and the RLS policy — not the UI — is what guarantees that.',
        marks: 25,
        opens_at: days(3),
        due_at: days(21),
        status: 'draft',
      },
    },
    {
      key: 'upcoming',
      renders: 'Upcoming',
      row: {
        ...base,
        title: 'Lab 6 — Deadlock detection',
        instructions:
          'Implement a wait-for graph and detect cycles. Starter code will be attached when this opens.',
        marks: 20,
        opens_at: days(9),
        due_at: days(23),
        status: 'open',
      },
    },
    {
      key: 'open',
      renders: 'Open',
      row: {
        ...base,
        title: 'Lab 5 — CPU scheduling simulator',
        instructions:
          'Simulate FCFS, SJF and Round Robin over the supplied trace. Submit your source plus a one-page comparison of average waiting time.',
        marks: 20,
        opens_at: days(-4),
        due_at: days(6),
        status: 'open',
        allow_late: true,
        late_until: days(9),
        late_penalty_pct_per_day: 10,
      },
    },
    {
      key: 'overdue',
      renders: 'Overdue (the only rust state)',
      row: {
        ...base,
        title: 'Assignment 5 — Page replacement',
        instructions:
          'Compare FIFO, LRU and Optimal on the reference string in the handout. Show the fault count for each.',
        marks: 15,
        opens_at: days(-18),
        due_at: days(-3),
        status: 'open',
        allow_late: true,
        late_until: days(4), // drives the "accepted till …" line
        late_penalty_pct_per_day: 5,
      },
    },
    {
      key: 'submitted',
      renders: 'Submitted · awaiting grade',
      row: {
        ...base,
        title: 'Lab 4 — System calls',
        instructions:
          'Trace the system calls made by a small program using strace and explain each one.',
        marks: 20,
        opens_at: days(-16),
        due_at: days(2),
        status: 'open',
      },
    },
    {
      key: 'graded',
      renders: 'Graded (grades_released = true)',
      row: {
        ...base,
        title: 'Assignment 4 — Process synchronisation',
        instructions:
          'Solve the readers–writers problem with semaphores. Prove that your solution is free of starvation.',
        marks: 25,
        opens_at: days(-34),
        due_at: days(-20),
        status: 'closed',
        grades_released: true,
        grades_released_at: days(-12),
      },
    },
  ] as const;

  const created: Record<string, string> = {};
  for (const spec of specs) {
    const row = await upsertByUnique<{ id: string }>(
      'assignments',
      { offering_id: ctx.offeringId, title: spec.row.title },
      spec.row,
    );
    created[spec.key] = row.id;
    console.log(`assignment   ${spec.renders.padEnd(34)} ${spec.row.title}`);
  }

  // Two submissions for the test student only — the minimum that makes
  // "Submitted" and "Graded" real states rather than states we assert exist.
  // The submission UI itself is 1B; this is fixture data, not a feature.
  const submitted = await upsertSubmission(
    ctx.institutionId,
    created.submitted!,
    ctx.testStudentId,
    days(-1),
  );
  console.log(`submission   ${submitted.id.slice(0, 8)}…  (drives the persistent ✓)`);

  const graded = await upsertSubmission(
    ctx.institutionId,
    created.graded!,
    ctx.testStudentId,
    days(-22),
  );

  const grade = await admin.from('submission_grades').upsert(
    {
      submission_id: graded.id,
      institution_id: ctx.institutionId,
      grade: 21,
      feedback:
        'Clean semaphore usage and the starvation argument is correct. Mark the critical section boundaries more explicitly next time.',
      graded_by: ctx.professorId,
    },
    { onConflict: 'submission_id' },
  );
  if (grade.error) throw grade.error;
  console.log(`grade        21 / 25 on "Assignment 4" — released, so visible`);
}

async function upsertSubmission(
  institutionId: string,
  assignmentId: string,
  studentId: string,
  submittedAt: string,
): Promise<{ id: string }> {
  const existing = await admin
    .from('submissions')
    .select('id')
    .match({ assignment_id: assignmentId, student_id: studentId })
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await admin
    .from('submissions')
    .insert({
      institution_id: institutionId,
      assignment_id: assignmentId,
      student_id: studentId,
      submitted_at: submittedAt,
      // Computed here rather than trusted, mirroring what the 1B submit action
      // will do: is_late is (submitted_at > due_at), never a client-sent flag.
      is_late: false,
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

/**
 * Create the auth user, or find them if a previous run already did.
 * `email_confirm: true` skips the confirmation email — these are test accounts
 * on a .test domain that could never receive one.
 */
async function ensureAuthUser(email: string, fullName: string): Promise<string> {
  const created = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (!created.error && created.data.user) return created.data.user.id;

  const alreadyExists =
    created.error?.status === 422 ||
    /already been registered|already exists/i.test(created.error?.message ?? '');

  if (!alreadyExists) throw created.error;

  // listUsers is paginated; for a seed with a handful of users page 1 is enough.
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (list.error) throw list.error;

  const found = list.data.users.find((u) => u.email === email);
  if (!found) throw new Error(`User ${email} exists but could not be found.`);

  // Reset the password so a rerun always leaves you with known credentials.
  const updated = await admin.auth.admin.updateUserById(found.id, {
    password: PASSWORD,
  });
  if (updated.error) throw updated.error;

  return found.id;
}

main().catch((err) => {
  console.error('\nSeed failed:');
  console.error(err);
  process.exit(1);
});
