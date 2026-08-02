# DELETION POLICY — decide this before writing the migration

`FUTUREPROOFING.md` item 1 says: *"Decide the cascade/anonymize policy deliberately per
relationship... Write it down."* This is that document. It is deliberately written before
any `deleted_at` column exists, because a mechanism built before its policy ends up
expressing the wrong thing.

Status: **DECIDED, 31 July 2026.** Each section records the question, the options, and the
answer taken. Implemented by `0007_soft_delete.sql`.

---

## 0. The insight that shapes everything else

"Delete a student" is not one operation. It is **four**, and they have different legal
bases, different retention outcomes, and different mechanisms. Conflating them into a
single `deleted_at` is the mistake to avoid.

| # | Operation | Trigger | What happens to data |
|---|---|---|---|
| 1 | **Deactivate** | graduation, transfer out, staff leaving | Everything retained. Account can no longer sign in. They stop appearing in current rosters. |
| 2 | **Soft-delete** | a mistake — duplicate course, wrong offering, session created on the wrong day | Row hidden, fully reversible, nothing anonymised. |
| 3 | **Erase (DPDP)** | a person exercises their right to erasure | Personal data anonymised. Academic records **kept**, because a college has an independent legal duty to retain marks and attendance. |
| 4 | **Purge** | an institution offboards | Export everything, then hard-delete the entire tenant. |

Only #2 is soft-delete in the classic sense. #1 is a status field. #3 is anonymisation,
not deletion. #4 is a batch job that does not exist yet and does not need to.

**Recommendation: build #1 and #2 now. Design the schema so #3 is possible. Defer #4.**

The reason #3 only needs to be *possible* rather than built: an erasure request is rare,
manual, and legally reviewed. It does not need a button. It needs a schema where the
personal data is in identifiable places and can be nulled without destroying the academic
record hanging off it.

---

## 1. Deactivation is a status, not a deletion. DECIDE.

A graduated student is not deleted. Their transcript must survive; their name must still
appear next to the work they submitted in 2026. What changes is that they cannot sign in
and they do not appear in current lists.

**Recommendation:** `profiles.status text not null default 'active'`, with values
`active` / `inactive`. Separate from `deleted_at` entirely. Auth is blocked on `inactive`;
historical records render exactly as before.

**DECIDED: alumni keep read-only access to their own historical records.**

That makes `status` a three-value column rather than a boolean, because "graduated, welcome
back any time" and "removed, no access" are different permissions and one flag cannot say
both:

| value | meaning |
|---|---|
| `active` | full access |
| `alumni` | may sign in; read-only; own historical records only |
| `inactive` | may not sign in at all |

These describe **access level, not biography.** A retired professor the college wants to
keep out is `inactive`; one they are happy to let browse their old courses is `alumni`.

**What is built now: the column and the login guard.** The read-only alumni surface itself
is a feature — its own routes, its own navigation, everything write-shaped removed — and it
is deliberately deferred. Nobody graduates during a twelve-week pilot, so it is not needed
before it exists. What matters is that the schema does not foreclose it, and a status
column does not.

---

## 2. Which tables get `deleted_at`. DECIDE.

Not all 31. `FUTUREPROOFING.md` says *core entities*, and the distinction that matters is
whether the row is a **thing someone created** (can be created by mistake) or an **event
that happened** (cannot be un-happened).

**Recommended: yes to `deleted_at`**
`departments` · `terms` · `courses` · `course_offerings` · `assignments` ·
`announcements` · `materials` · `team_sets` · `teams` · `placement_drives` · `companies` ·
`attendance_sessions`

All of these are things a human creates and can create wrongly.

**Recommended: NO `deleted_at`**

- `grade_history` — append-only. A nullable timestamp anyone can set is a delete wearing a
  different hat. Excluding it is not optional.
- `institutions` — offboarding is export-then-purge (#4), not a hidden row.
- `attendance_records` — an event. You do not delete a student's attendance mark, you
  *correct* it, and the spec already says past sessions are editable.
- `submissions` / `submission_files` / `submission_grades` — academic record. A student's
  submitted work is the thing a dispute is about. Removing a submission is #3 territory,
  handled by anonymising the student, not by hiding the work.
- `enrolments` / `teaching_assignments` / `team_members` — join rows. `team_members`
  already hard-deletes on "leave team" and that is correct behaviour. Enrolment ending is
  better expressed as a status or an end date than as a deletion.
- `notifications` / `announcement_reads` — ephemeral. Hard delete is fine.
- `profiles` — **see section 3.** This is the one that needs its own answer.

---

## 3. Profiles: the hard one. DECIDE.

A profile is simultaneously a login, a person's identity, a foreign-key target for
everything they ever did, and a bundle of PII. It cannot be soft-deleted like a course.

**Recommendation:** profiles get `status` (section 1) but **not** `deleted_at`. A person
is deactivated, never hidden. Their name continues to appear next to their work, because
otherwise the professor's submissions list develops holes.

An erasure request (#3) is then handled by **anonymisation**, not deletion:

- `full_name` → `'Removed student'`
- `email` → a non-routable placeholder that keeps the unique constraint satisfied
- `roll_number` → **kept**, because it is the academic record's key, not personal contact
  data. Confirmed by the decision in §4 that roll numbers are never reused: the number stays
  attached to exactly one person for all time, anonymised or not. Worth confirming with a
  lawyer before the first real erasure request, not before the first line of code.
- `student_academics` (CGPA, resume URL) → the resume is the clearest personal data in the
  schema and should be deleted outright.

Everything the person *did* — submissions, grades, attendance — stays, attached to an
anonymised profile. That is the standard shape for erasure against a legitimate retention
duty.

**Open question for you:** is that the right split? The alternative is deleting the
profile row entirely and letting the composite FKs cascade, which would destroy the
academic record of a class the student was in. I do not recommend it, but you should
decide it rather than inherit it.

---

## 4. Unique constraints: only SOME become partial. DECIDE.

This is the part that is easy to get wrong mechanically. The rule is:

> A unique becomes `where deleted_at is null` **only if you want the value to be reusable
> after the row is hidden.**

Applying that to what actually exists in `0001_init_schema.sql`:

| Constraint | Partial? | Why |
|---|---|---|
| `courses (institution_id, code)` | **yes** | A retired CS301 should not block a new CS301. |
| `departments (institution_id, code)` | **yes** | Same reasoning, rarer. |
| `terms (institution_id, name)` | **yes** | A term created by mistake should free its name. |
| `course_offerings (course_id, term_id, section)` | **yes** | A wrongly-created Section A must be recreatable. |
| `attendance_sessions (offering_id, held_on)` | **yes** | Session opened on the wrong day → delete, open the right one. |
| `companies (institution_id, name)` | **yes** | Duplicate company entries are the common case. |
| `profiles (institution_id, roll_number)` | **NO — DECIDED** | A roll number is issued once and never reused, ever. Since profiles carry no `deleted_at` at all (§3), this needs no change: the existing index already guarantees it. Reusing a number while the previous holder's grades exist would let one person's marks surface under another's name. |
| `submissions (assignment, student/team)` | **NO** | No `deleted_at` on this table at all. |
| `team_members (team_set_id, student_id)` | **NO** | Hard delete, by design. |
| `drive_applications (drive_id, student_id)` | **NO** | Moot — the table carries no `deleted_at`. Withdrawing is a hard delete, so re-applying works without any constraint change. |

**The leak this prevents:** a partial unique means a soft-deleted row and a live row can
share a business key. Any query that joins on that key without filtering `deleted_at`
silently returns duplicates. That is why roll number stays reserved.

---

## 5. What a hidden row does to derived numbers. DECIDE.

If an offering is soft-deleted, or a student deactivated:

- Does their submission still count in the professor's "12 / 14 submitted"?
- Does their attendance still sit in the class denominator?
- Does their grade still feed the class average and median students see?

**DEFERRED, deliberately — and on inspection this was the right call.**

I first described this as simple. It is not. The narrow case is easy: when a student
withdraws from a course, the admin removes their `enrolments` row and every denominator
corrects itself, because the counts are already taken over enrolments. That works today
with no change.

The hard case is a student deactivated at the *college* level whose enrolment rows still
exist. Answering it properly means modelling an enrolment lifecycle — enrolled / withdrawn
/ completed, with dates — so that "how many were in this class" can be answered both for
today and for a semester in 2030. That is its own piece of design and it does not belong
inside a soft-delete migration.

**Deferring is safe because this is query logic, not schema.** Nothing in `0007` forecloses
any answer. And nobody is deactivated during a twelve-week pilot, so the case cannot arise
before it is designed.

---

## 5b. What happens to the CHILDREN. DECIDED, 2 August 2026.

The gap that let a real bug through: this document said which tables get `deleted_at` and
said nothing about what a hidden parent does to its content. Two things were true and
neither was intended.

**The bug.** `FORCE ROW LEVEL SECURITY` is set nowhere, so the table owner bypasses RLS —
and every `SECURITY DEFINER` helper runs as that owner. A policy reaching another table by
**direct subquery** inherits its RLS; one reaching it through a **helper function** does
not. Cascade behaviour was being decided by that accident. Measured, not inferred: with an
offering soft-deleted, an enrolled student could still read its assignments,
announcements, team sets, attendance sessions, timetable slots, course info and mark
split. With the *course* deleted, the offering itself stayed visible too.

**DECIDED: a hidden parent hides its children, enforced in RLS.**

- One function, `offering_chain_live(offering_id)`, states the whole chain once: the
  offering, its course and its term must all be live. A policy cannot implement half of it.
- A RESTRICTIVE policy on every offering-scoped table, generated from the catalogue by
  "does this table have an `offering_id`". Restrictive means it is ANDed with the existing
  permissive policies, so it can only narrow access and nothing existing had to be edited.
- Staff keep visibility via `is_staff()`, because otherwise undelete is impossible.
- Implemented in `0008_soft_delete_cascade.sql`; asserted, and mutation-tested, in
  `supabase/tests/rls.test.mjs`.

**Two tables deliberately do NOT cascade: `submissions` and `attendance_records`.**

Both policies open with `student_id = auth.uid()`, a branch with no subquery, so a student
keeps sight of their own submission and their own attendance marks even when the offering
is hidden. That is left as it is, on purpose:

- §2 excludes these tables from `deleted_at` because they are **academic record** — "a
  student's submitted work is the thing a dispute is about". Cascading the visibility away
  would achieve indirectly what that decision forbids directly.
- It is not a confidentiality leak. A student sees only their own rows; a classmate still
  sees nothing.
- If an admin hides a course by mistake, a student losing sight of their own work is the
  worse of the two failures. That evidence is what they need most when something is wrong.

## 5c. Should a parent with live children be deletable at all? DECIDED, 2 August 2026.

**No — and the answer belongs in the server action, not the database.**

`DELETION_POLICY.md` frames soft-delete as a fix for **mistakes**, and a mistake has no
content yet. An offering with twelve assignments and a term of attendance is not a
mistake; it is a course someone wants rid of, which is a different request with a
different answer (archive the term, or end the enrolments).

The orphan case above is the evidence. Cascade cannot cleanly cover `submissions` and
`attendance_records` without contradicting §2 — so hiding a parent that has them leaves a
student holding work that belongs to a course they can no longer see. The way to make
that state unreachable is not a cleverer cascade; it is to refuse to create it.

**The split, and why it is a split:**

- **RLS is the safety net.** It cascades unconditionally, so if a delete does happen —
  through a script, a repair, an admin using the API directly — nothing leaks. A safety
  net that can be talked out of catching you is not one.
- **The server action is the behaviour.** It counts live children and refuses with the
  number: *"This offering has 12 assignments and 340 attendance records. Delete those
  first, or archive the term instead."* A count is a better refusal than a warning,
  because it tells the person what they are actually about to do.

A database trigger was considered and rejected: it would also block legitimate end-of-life
tidying, and it would make undelete-then-redelete fail in ways nobody could read.

**Not built this session** — nothing deletes anything yet, so there is no action to put it
in. Recorded here so the delete button ships with it rather than after it.

## 6. Enforcement — the part that decides whether this holds

A `deleted_at` that queries forget to filter is worse than no `deleted_at`, because it
looks safe. Two mechanisms, both needed:

1. **A shared query helper** that applies `deleted_at is null` by default, so forgetting is
   the exception rather than the norm.
2. **A catalogue invariant**, in the same style as the append-only and composite-FK tests
   that already exist: for every table carrying `deleted_at`, every RLS policy on it must
   filter `deleted_at`. That family of tests has already caught real problems and has been
   mutation-tested, so it is the right shape.

Without #2, table 33 gets `deleted_at` in six months and one policy forgets, and nothing
complains until a deleted student appears in someone's roster.

---

## Decisions taken — 31 July 2026

0. **A hidden parent hides its children** (§5b), enforced in RLS via
   `offering_chain_live()`. `submissions` and `attendance_records` deliberately excepted.
   **A parent with live children should not be deletable at all** (§5c) — refused in the
   server action, with RLS as the safety net beneath it.
1. **Alumni keep read-only access.** Three-value `status`; the surface itself is deferred.
2. **Erasure anonymises, never deletes.** Academic record survives; resume is destroyed.
3. **Profiles carry `status`, never `deleted_at`.** People are deactivated, not hidden.
4. **Course codes reusable; roll numbers never.** Issued once, held for all time.
5. **Denominators deferred.** Query logic, not schema — nothing here forecloses it.

Open for later, recorded so it is not lost:

- The alumni read-only surface (from §1).
- Enrolment lifecycle modelling — enrolled / withdrawn / completed (from §5).
- Whether a roll number counts as personal data under DPDP (from §3) — a question for a
  lawyer, before the first real erasure request.
