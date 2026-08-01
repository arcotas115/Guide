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
