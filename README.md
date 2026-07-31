# Campus

A mobile-first campus platform for Indian colleges. Multi-tenant from day one —
one deployment serves many institutions, and no query ever crosses between them.

Source of truth for *what* to build: [SPEC.md](SPEC.md).
Source of truth for *how*: [BUILD_RULES.md](BUILD_RULES.md).
Project background: [HANDOFF.md](HANDOFF.md).

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 + shadcn/ui, Meadow palette as CSS tokens |
| Database | Supabase (Postgres 15+) with Row Level Security on every table |
| Auth | Supabase Auth, cookie sessions via `@supabase/ssr` |

---

## Local setup

```bash
npm install
cp .env.example .env.local     # fill in from Supabase → Project Settings → API
npm run dev
```

`.env.local` needs three values:

| Variable | Where it is used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server (publishable, `sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **`scripts/seed.ts` only** (secret, `sb_secret_…`) |

The service-role key bypasses every RLS policy. It is read by exactly one file
and is deliberately absent from [src/lib/env.ts](src/lib/env.ts), so no React
component can reach it through a stray import. It is **not** set in Vercel.

---

## Database

Migrations are plain SQL, applied by pasting into the Supabase **SQL Editor**
(dashboard → SQL Editor → New query), in order:

| File | What it does |
|---|---|
| [`0001_init_schema.sql`](supabase/migrations/0001_init_schema.sql) | 29 tables. Tenant isolation enforced by *composite* foreign keys, not convention. |
| [`0002_rls_policies.sql`](supabase/migrations/0002_rls_policies.sql) | RLS helpers, RLS enabled on every table, 63 policies. Default-deny. |
| [`0003_grants.sql`](supabase/migrations/0003_grants.sql) | Table privileges. **Re-run this after any migration that adds a table.** |
| [`0004_assignment_fields_and_grade_split.sql`](supabase/migrations/0004_assignment_fields_and_grade_split.sql) | Assignment form fields; moves the grade off `submissions` onto `submission_grades` so an unpublished mark is unreadable, not just unrendered. |

Then seed a test institution and two users:

```bash
npm run seed
```

| Email | Password | Lands on |
|---|---|---|
| `student@meridian.test` | `campus-test-1234` | `/student` |
| `professor@meridian.test` | `campus-test-1234` | `/faculty` |

The seed is idempotent — re-running resets both passwords rather than failing.

### Two different gates, and they fail differently

- **RLS** decides *which rows* a role may touch. Wrong policy → wrong data, silently.
- **GRANT** decides whether it may touch the table *at all*. Missing grant →
  `42501 permission denied`, which reading the policies will never explain.

`0003` exists because this project has Supabase's "automatically expose new
tables" turned off, so a new table starts with no grants at all.

---

## Checks

```bash
npm test             # domain + rls, 96 assertions, no network
npm run test:domain  # 40 — derived states, late window, timezone, validation
npm run test:rls     # 56 — policies and grants on a real Postgres (PGlite/WASM)
npm run typecheck
npm run lint
npm run build
```

`test:rls` runs every migration against an in-process Postgres, seeds **two**
institutions, and queries as each role with RLS in force — so "a student cannot
read another student's data" is asserted, not assumed. It also covers the
tightest case in the schema: a saved-but-unreleased grade returns zero rows to
the student who owns it, while their submission row still returns one.

`test:domain` covers the pure logic: the five derived assignment states and
their precedence, the late-acceptance window, the IST round-trip, and every
form validation rule. Run both before every deploy.

---

## Deploying

Pushes to `main` deploy automatically once the repo is connected to Vercel.

Vercel needs only the two `NEXT_PUBLIC_*` variables, set for Production,
Preview and Development. After the first deploy, set the production URL in
Supabase → **Authentication → URL Configuration → Site URL**.

---

## Conventions worth knowing before editing

- **`institution_id` is `NOT NULL` on every table.** No foreign key crosses an
  institution boundary; parents carry a redundant `UNIQUE (id, institution_id)`
  purely so children can declare a composite FK that makes it impossible.
- **Config is data.** The attendance threshold lives in
  `institutions.min_attendance_pct`. Never hardcode 75.
- **Two separate publish concepts.** `assignments.status` (draft/open/closed)
  controls whether students see the assignment; `assignments.grades_released`
  controls whether they see marks. Never conflate them.
- **Auth checks live in layouts**, not pages, so new routes inherit them.
- **`auth.getUser()`, never `auth.getSession()`** on the server. The first
  revalidates the JWT; the second trusts the cookie.
- **Colour is identity** (each course owns one) and **rust is urgency only** —
  overdue work and attendance below threshold, nothing else.
