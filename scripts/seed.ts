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

const USERS = [
  {
    email: 'student@meridian.test',
    full_name: 'Ananya Rao',
    role: 'student' as const,
    roll_number: '21CS1043',
    batch_year: 2021,
  },
  {
    email: 'professor@meridian.test',
    full_name: 'Dr. Vikram Shenoy',
    role: 'faculty' as const,
    roll_number: null,
    batch_year: null,
  },
];

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
  for (const user of USERS) {
    const userId = await ensureAuthUser(user.email, user.full_name);

    const profile = await admin
      .from('profiles')
      .upsert(
        {
          id: userId,
          institution_id: institution.id,
          department_id: department.id,
          role: user.role,
          full_name: user.full_name,
          email: user.email,
          roll_number: user.roll_number,
          batch_year: user.batch_year,
        },
        { onConflict: 'id' },
      )
      .select()
      .single();

    if (profile.error) throw profile.error;
    console.log(`${user.role.padEnd(12)} ${user.email}  (${userId})`);
  }

  console.log(`\nDone. Sign in at http://localhost:3000/login`);
  console.log(`  student@meridian.test    ${PASSWORD}   -> /student`);
  console.log(`  professor@meridian.test  ${PASSWORD}   -> /faculty`);
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
