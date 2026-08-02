# PROGRESS.md — where the build is, for a session with no memory of it

Last updated: **2 August 2026**, after Milestone 1C-i.

This file is written for someone picking the project up cold. It assumes you have read
nothing else yet, and it tells you what to read, in what order, and what you would break by
not knowing it.

---

## 1. Where the build is

| Milestone | State |
|---|---|
| **0 — skeleton** | Done. Next.js 16, Supabase, auth, role-based routing, deployed to Vercel. |
| **1A — the assignment exists** | Done. Professor creates/edits; student sees it with a derived state. |
| **1A-fix** | Done. Schema idempotency, human error messages, action-level tests. |
| **Design system** | Done. Tokens, app shell, base components in `src/components/kit/`. |
| **Foundations + integrity + soft delete** | Done. Migrations 0005–0008. |
| **1B-i — the student submits** | Done. Storage, `submit_attempt()`, attempts. |
| **1B-ii — To-Do, the ✓, the bottom bar** | Done. Milestone 1B closed. |
| **1C-i — the Submissions table** | Done. Read-only: who handed in what. |
| **1C-ii — SpeedGrader** | **NEXT.** Not started. |
| **1D — publish grades** | Not started. |

**Test suites: 410 assertions, all passing.**

```
npm run test:domain   112   pure logic — derived states, buckets, penalty, timezone, validation
npm run test:actions   42   the real action pipeline against real Postgres
npm run test:rls      256   policies, grants, storage paths, catalogue invariants
npm test                    all three
```

`npm run build`, `npm run typecheck` and `npm run lint` are all clean. Run the whole gate
before every commit.

### What 1C-ii owes

SpeedGrader: inline rendering of a submission, marks, feedback, autosave, next/previous
through students. **It owns the grade-write path** — 1C-i is deliberately read-only so the
write is built once, in the surface that owns it.

What already exists for it:

- `submission_grades` (0004) with the tightest policy in the schema, and `can_grade_submission()`.
- `grade_history` (0005), append-only, written by a trigger from `submission_grades.updated_by`.
- `submission_attempts` (0009) — every attempt with its own timestamp; the latest is the graded one.
- `src/lib/submissions/faculty-queries.ts` — the roll, states, attempts, penalty suggestions.
- `src/lib/submissions/penalty.ts` — the suggestion. **Show it. Never apply it.** See §5.

**`submission_grades.updated_by` is NOT NULL.** Any grade write must name the actor, or it
fails. That is what feeds `grade_history.changed_by`.

---

## 2. Read these first, in this order

1. **`BUILD_RULES.md`** — the nine load-bearing scale rules and the golden rules. Rules 1, 4,
   6, 7 and 9 are enforced by tests; violating them fails the build, not review.
2. **`PROGRESS.md`** — this file, especially §4 (conventions).
3. **`SPEC.md`** — the product. §4 is the data model and carries Revisions 2–8 recording
   every schema decision and why.
4. **`DESIGN.md`** — tokens, type scale, the rust rule. A screen that works but does not
   match this file is not finished.
5. **`DELETION_POLICY.md`** — soft delete, account status, the cascade. Decided; not up for
   re-litigation.
6. **`FUTUREPROOFING.md`** — what is handled now vs deliberately deferred.
7. **`supabase/tests/rls.test.mjs`** — the fastest way to learn what the security model
   actually guarantees. Read the CATALOGUE INVARIANTS group first.

`HANDOFF.md` is original project background. `README.md` is the setup runbook.

---

## 3. The migrations

Applied by pasting into the **Supabase SQL Editor** (dashboard → SQL Editor → New query),
in order. There is no migration runner.

| # | What it did, and why |
|---|---|
| **0001** `init_schema` | 29 tables. Tenant isolation enforced by **composite foreign keys**, not convention — every parent carries a redundant `unique (id, institution_id)` so children can reference the pair. |
| **0002** `rls_policies` | RLS on every table, default-deny, 63 policies, plus the `SECURITY DEFINER` helpers (`current_institution_id`, `teaches_offering`, `enrolled_in_offering`, …) that policies call to avoid recursion. |
| **0003** `grants` | Table privileges. The project has Supabase's "auto-expose new tables" **off**, so a new table has no grants at all until this runs. **Re-run it after any migration that adds a table.** It reads table comments to decide what NOT to grant — see §4. |
| **0004** `assignment_fields_and_grade_split` | Added `late_penalty_pct_per_day`, `hide_names_while_grading`. **Moved the grade off `submissions` onto `submission_grades`** — RLS hides rows, not columns, and a student must read their own submission row, so a grade living there was API-readable the instant it was saved. |
| **0005** `foundations` | `institutions.timezone` (config-as-data); audit columns (`updated_at` by trigger, `updated_by` by the app); **`grade_history`**, append-only and trigger-written; plus the 1A leftovers (`allow_multiple_attempts`, `marks > 0`, "accepts at least one submission type"). |
| **0006** `tenant_integrity` | Mostly confirmation — all 48 cross-tenant FKs were already composite. What changed: the audit actor became `NOT NULL`, `grade_history.changed_at` moved to `clock_timestamp()` (`now()` is transaction-scoped and ties), and append-only tables started declaring themselves. |
| **0007** `soft_delete` | `profiles.status` (active/alumni/inactive — people are deactivated, never hidden) and `deleted_at` on the twelve tables a human *creates*. Hiding is a **RESTRICTIVE** policy, not a rewrite of twelve existing ones. Six business keys became partial uniques so a retired course code is reusable. |
| **0008** `soft_delete_cascade` | A soft-deleted term/course/offering now hides its content. It did not, because a policy reaching a parent through a `SECURITY DEFINER` helper does not inherit its RLS while a direct subquery does — cascade was being decided by that accident. One function, `offering_chain_live()`, states the chain once. |
| **0009** `submit_attempts` | `submission_attempts` (an attempt is an entity; `unique (submission_id, attempt)` makes the two-tabs race unrepresentable). Dropped `submissions.is_late` — late-ness is derived per attempt so extending a deadline self-corrects. **Submitting became `submit_attempt()`**; clients lost all direct write on submissions. |
| **0010** `storage` | Private `submissions` bucket and its policies, in a migration rather than the dashboard. Path is `{institution}/{assignment}/{owner}/{attempt}/{file}` — institution first, so tenant isolation is visible in the path itself. |

**Before starting 1C-ii, confirm 0009 and 0010 are applied** to the live project, and that
0003 has been re-run since. The test suite runs every migration from scratch, so a green
suite does not prove the live database is current.

---

## 4. Conventions you would violate without knowing

These are the ones that are invisible until something breaks. Most are enforced by tests in
`supabase/tests/rls.test.mjs`, so violating them fails the build — but knowing *why* saves
you working out what the test means.

### 4.1 Two table-comment markers, read by `0003_grants.sql`

`0003` grants `select, insert, update, delete` on **all** tables. Two markers carve out
exceptions, and `0003` reads them from the catalogue so no list is hand-maintained:

| Marker | Means | Tables today |
|---|---|---|
| `@append-only` | **Nobody** may UPDATE or DELETE — including `service_role`. No client INSERT either. | `grade_history` |
| `@function-written` | No **client** may write. A `SECURITY DEFINER` function does, and `service_role` keeps full access for seeds and repairs. | `submissions`, `submission_attempts`, `submission_files` |

Put the token in the table's `COMMENT`. If you add such a table and forget, the next 0003
re-run hands the grant back **silently** — that has nearly happened twice, which is why the
markers exist and why the invariant checks both directions.

### 4.2 Catalogue invariants, and mutation-testing them

`rls.test.mjs` has a CATALOGUE INVARIANTS group that asserts the *shape* of the schema
rather than its behaviour, so table 32 cannot quietly opt out of a rule. It currently
covers: composite FKs, RLS everywhere, no `TRUNCATE` for any client role, append-only
consistency (both directions), soft-delete guarded (both directions), the excluded-table
list, no partial composite-FK targets, the audit actor, and the storage policy's shape.

**When you add an invariant, mutation-test it.** Write a throwaway script that applies the
migrations, injects the violation, and confirms the check fires. Every invariant in this
suite has been through that, and it has caught invariants that asserted nothing. A passing
test you have never seen fail is not evidence.

### 4.3 Soft delete: restrictive policies, never rewrites

Hiding is added as a `RESTRICTIVE` policy, which is ANDed with the existing permissive ones
and therefore can only ever *narrow* access. It is generated from the catalogue — "does
this table have a `deleted_at` column", "does it have an `offering_id`" — so a new table is
covered when it exists rather than when someone remembers.

Do **not** rewrite an existing `USING` clause to add a `deleted_at` check. That means
restating logic like `assignments_read`'s draft rule, and one typo there is a silent leak.

`submissions` and `attendance_records` deliberately do **not** cascade — they are academic
record, and a student keeps sight of their own work even when a course is hidden.
`DELETION_POLICY.md` §5b.

### 4.4 `live()` for every read of a soft-deletable table

`src/lib/soft-delete.ts`. RLS already hides deleted rows from students, but **staff can see
them by design**, so without the helper a professor's list quietly grows the rows they
deleted last week. Reads go through `live(query)`; seeing deleted rows is something a call
site asks for with `{ includeDeleted: true }`, never something it gets by forgetting.

It cannot cover an *embedded* resource — `courses(...)` inside a select on `enrolments`
comes back regardless. Those are filtered in TypeScript; see `toOfferingSummary`.

### 4.5 `format.ts` requires an explicit `timeZone` — there is no default

Every function that renders or interprets a wall-clock time takes `timeZone` as a
**required** argument, from `profile.timeZone` (which reads `institutions.timezone`).

A default would compile everywhere and silently show Indian time to a college in Dubai.
`new Date("2026-08-12T23:59")` parses in the **server's** zone — UTC on Vercel — which is
hours of error on every deadline while looking perfect in local development.

`deriveAssignmentState()` takes one too, because it builds the human label. Day boundaries
go through `startOfDayInZone()`, which does calendar arithmetic rather than adding
86,400,000 ms — that is wrong across any DST transition.

### 4.6 No foreign key crosses an institution boundary

Every FK between two tables that both carry `institution_id` includes it on both sides:

```sql
foreign key (course_id, institution_id) references courses (id, institution_id)
```

Two exemptions, both deliberate: `<table>.institution_id → institutions(id)` (institutions
*is* the tenant) and `profiles.id → auth.users(id)` (Supabase owns identity).

**No `unique (id, institution_id)` may ever become partial** — a partial index cannot be a
foreign-key target, and those keys are what every composite FK references. Postgres refuses
the drop, and a test asserts it anyway.

### 4.7 Submitting goes through `submit_attempt()`, never a direct write

Clients hold **no** INSERT or UPDATE on `submissions`, `submission_attempts` or
`submission_files`. `submit_attempt(p_assignment_id, p_items)` is the only way in.

It exists because three things RLS cannot do had to happen at once: a student could not
resubmit at all (bumping `latest_attempt` is an UPDATE, and it failed silently at 0 rows);
granting them UPDATE would also grant `submitted_at`, and RLS cannot compare OLD to NEW; and
the old file-insert policy checked ownership without ever looking at the assignment, so work
could be appended to an assignment that closed weeks earlier.

The function verifies enrolment, that the assignment is currently accepting work, and the
attempt policy; it computes the attempt number **from the database** and the timestamp from
the **server clock**. A client-supplied attempt number or timestamp is not read at all.

**1C-ii's grade write should follow the same shape** if it needs anything RLS cannot
express. If it does not, an ordinary policied UPDATE on `submission_grades` is fine — that
table already has the right policy.

### 4.8 Storage

Uploads go **client-direct** with the student's session so RLS applies and no file passes
through the Next.js server. The server then re-validates that the recorded path matches the
caller and the assignment before writing the row. Both, because the client chooses the path.

`storage.foldername()` is **1-indexed** and excludes the filename, so the owner is segment
**`[3]`**. An off-by-one there fails silently; the indexing is asserted before any path test
uses it.

Everything Supabase-specific about storage is behind `src/lib/storage/` — an adapter, not
twenty call sites, because institution-provided storage is a real scale-stage lever.

**Never render an untrusted upload inline.** Only PDF, images and plain text may render;
everything else is forced to download. A student uploading `evil.html` and a professor
clicking "view" in SpeedGrader is script execution in the professor's session. **This is
1C-ii's problem directly** — the adapter already sets the disposition; use it.

---

## 5. Decisions taken, and where each is recorded

Do not re-open these without a reason. Each is written down where the work is.

| Decision | Recorded in |
|---|---|
| Grade lives on `submission_grades`, never on `submissions` | SPEC §4 (Rev 2), `0004` header |
| `status` and `grades_released` are different things | SPEC §4, `0001` |
| The five student states are DERIVED, never stored | SPEC §3.7, `src/lib/assignments/state.ts` |
| Late-ness is derived per attempt; `is_late` dropped | SPEC §4 (Rev 7), `0009` §2 |
| **Late penalty: SHOW, never apply.** Any part of a day counts as a day | SPEC §4 Decisions (Rev 8), `src/lib/submissions/penalty.ts` |
| `hide_names_while_grading` binds to the Submissions table **and** SpeedGrader | SPEC §4 (Rev 8), `faculty-queries.ts` |
| An attempt is an entity (`submission_attempts`), not `min(uploaded_at)` | SPEC §4 (Rev 7), `0009` §1 |
| Timezone is config-as-data; DB checks shape, zod checks existence against Intl | `0005` §1, `src/lib/timezone.ts` |
| Audit actor is `NOT NULL` on the column, not a trigger RAISE | `0006` §3 |
| People are deactivated (`status`), never soft-deleted | DELETION_POLICY §1, §3 |
| Which tables get `deleted_at`, and why each excluded one is excluded | DELETION_POLICY §2, SPEC §4 (Rev 5) |
| Course codes reusable after deletion; roll numbers never | DELETION_POLICY §4 |
| A parent with live children should not be deletable — refuse in the action, RLS as the net | DELETION_POLICY §5c |
| Erasure anonymises; it never deletes the academic record | DELETION_POLICY §3 |
| Course tint/wash/washBorder are derived from `courses.color`, not stored | DESIGN.md §4, `globals.css` |
| The late-penalty badge is **not** rust (the prototype is wrong) | DESIGN.md §5 |
| "This week" in To-Do means the next seven days | `src/lib/todo/buckets.ts` — **not yet in SPEC** |

---

## 6. Open items

### 6.1 The fixture-vacuity failure mode — **this has now bitten twice**

A test group that reuses seed state which an *earlier* group has mutated can end up
asserting nothing while still passing.

- **1B-ii:** the To-Do group inherited an assignment the SUBMITTING group had already
  submitted against, so the student's To-Do was empty and every cascade assertion went from
  nothing to nothing — passing.
- **1C-i:** every submission on the shared fixture happened to be graded, so "an ungraded
  row is distinguishable from a graded one" was passing on fixture order rather than
  behaviour.

**The rule going forward: a test group that depends on a particular starting state must
create it, not inherit it.** Both groups now build their own fixtures. When you add a group
to `rls.test.mjs`, assert a positive baseline first — if the thing you are about to hide is
not visible to begin with, hiding it proves nothing.

### 6.2 Not yet verified in a browser

I cannot drive a browser. These are covered by tests end-to-end at the database and query
layer, but the round trip through the real UI is unconfirmed:

- The full submit flow through Supabase Storage (upload → record → see both attempts).
- The Submissions table rendering with real data.
- To-Do at 390px.

### 6.3 Smaller things

- **`soft-delete-brief.md` is committed at the repo root.** It is a session brief that got
  swept in by `git add -A`. Harmless, probably wants deleting.
- **`professorName` takes the first teaching assignment.** Co-taught offerings are legal
  (SPEC §2); "Prof. A and Prof. B" is a copy decision for whenever co-teaching ships.
- **The notification dot is deliberately absent** from the bottom bar until Notifications
  exists. A dot that is never lit means nothing.
- **Three student tabs are honest placeholders** — Calendar, Notifications, More. More
  carries sign-out permanently.
- **`AUDIT.md` was referenced by a brief but has never existed** in the repo.
- **Orphaned uploads** — an upload that succeeds while the recording call fails leaves a
  file with no row. Accepted at pilot scale; the cleanup is described in
  `src/lib/storage/index.ts` and is a scheduled job for later.
- **`FORCE ROW LEVEL SECURITY` is set nowhere.** The table owner therefore bypasses RLS,
  which is what makes `SECURITY DEFINER` helpers work. It is also what caused the 0008
  cascade bug. Worth understanding before writing a policy that reaches another table.

---

## 7. Working agreements

From `BUILD_RULES.md` and how the sessions have actually run:

- **One feature per session, commit at logical points.** Small verified steps.
- **Verify claims against a running database rather than by reading.** Every migration in
  this project was validated against PGlite — real Postgres in WASM — before the user ran
  it. Several briefs contained premises that turned out to be already handled, and several
  contained real bugs that only showed up when probed.
- **Test the ugly paths**, not the happy one.
- **Say what is not done.** A greyed control explains itself; a missing feature is stated
  rather than implied.
