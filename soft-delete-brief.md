# Session: soft-delete and account status

Read `BUILD_RULES.md`, `DELETION_POLICY.md` (new — the decisions are recorded there and
they are not up for re-litigation in this session), `FUTUREPROOFING.md` item 1, and
`SPEC.md` §4.

One migration, `0007_soft_delete.sql`, plus the query helper and the catalogue invariants.

**No UI. No new feature.** Nothing in the app deletes anything today, so this session adds
capability and changes no behaviour — same shape as 0006. Every existing assertion must
still pass. If one breaks, bring it to me.

---

## 1. `profiles.status` — people are deactivated, never hidden

```
status text not null default 'active'
  check (status in ('active', 'alumni', 'inactive'))
```

The values describe **access level, not biography**:

- `active` — full access
- `alumni` — may sign in, read-only, own historical records only
- `inactive` — may not sign in at all

**Profiles get NO `deleted_at`.** Hiding a person leaves holes wherever their name appears
next to their work — a submissions list with a mark and no student attached. Deactivation
is a status; the person stays.

**What to build now:** the column, and the login guard. `active` signs in as today;
`alumni` and `inactive` are both refused for now, with a distinct, warm message for each
(an alumnus being told "your account is closed" is wrong, even while the read-only surface
does not exist yet).

**What NOT to build:** the alumni read-only surface. It is its own routes and its own
navigation, and `DELETION_POLICY.md` §1 defers it deliberately. Leave the guard obviously
ready for it rather than pretending it exists.

Index `(institution_id, status)` — every roster query will filter on it.

## 2. `deleted_at` — only on things a human creates

```
deleted_at timestamptz null
```

**Add to:** `departments` · `terms` · `courses` · `course_offerings` · `assignments` ·
`announcements` · `materials` · `team_sets` · `teams` · `placement_drives` · `companies` ·
`attendance_sessions`

**Do NOT add to, and the reasons matter:**

- `grade_history` — append-only. A nullable timestamp anyone can set is a delete in
  disguise. This one is not a judgement call.
- `institutions` — offboarding is export-then-purge, not a hidden row.
- `attendance_records` — an event. You correct a mark, you do not delete it.
- `submissions`, `submission_files`, `submission_grades` — academic record. Removing a
  student's work is an erasure question, answered by anonymising the person.
- `profiles`, `student_academics` — see §1.
- `enrolments`, `teaching_assignments`, `team_members` — join rows. `team_members` already
  hard-deletes on "leave team" and that is correct.
- `notifications`, `announcement_reads` — ephemeral.

Index `deleted_at` where the table is large enough to matter; say which you chose and why.

## 3. Partial uniques — only where reuse is wanted

The rule: a unique becomes `where deleted_at is null` **only if the value should be
reusable after the row is hidden.**

**Make partial:** `courses (institution_id, code)` · `departments (institution_id, code)` ·
`terms (institution_id, name)` · `course_offerings (course_id, term_id, section)` ·
`attendance_sessions (offering_id, held_on)` · `companies (institution_id, name)`

**Leave alone:** everything else. In particular `profiles_institution_roll_uniq` needs no
change at all — profiles carry no `deleted_at`, so a roll number is issued once and held
for all time, which is the decision in `DELETION_POLICY.md` §4.

**Watch for a collision.** A partial unique index cannot be a foreign-key target. The
`unique (id, institution_id)` keys from 0001 are what every composite FK references, so
none of them may become partial. The list above is business keys only and none of them is
an FK target — but verify that rather than trusting me, because getting it wrong drops
referential integrity across the schema.

## 4. Policies — students must never see a hidden row

This is the security boundary, and it belongs in RLS rather than in a query.

- **Students and any non-staff reader: a soft-deleted row does not exist.** Enforced in the
  policy, so no forgotten `where` clause can leak it.
- **Faculty and admins may read hidden rows**, because otherwise nothing can ever be
  undeleted and a mistake becomes permanent.
- The application then **hides them by default for everyone**, and staff opt in explicitly
  where a "recently deleted" view eventually exists.

Deleting is an UPDATE setting `deleted_at`, so it is already covered by the existing
teacher/admin write policies. Do not add delete policies.

## 5. The query helper

A `deleted_at` that queries forget to filter is worse than no `deleted_at`, because it
looks safe. Provide one shared way to build a query that applies `deleted_at is null` by
default, so forgetting is the exception rather than the default. Then use it wherever the
app currently reads a soft-deletable table.

## 6. The invariants — the part that decides whether this holds in six months

Extend the catalogue tests in the same style as the append-only and composite-FK ones, and
**mutation-test them the way you did last session** — an invariant nobody has watched fail
is an invariant that might be asserting nothing.

At minimum:

- Every table carrying `deleted_at` has a policy that filters it for non-staff readers.
- No `unique (id, institution_id)` key is partial. (Composite FK targets must stay total.)
- `grade_history` has no `deleted_at`, and never acquires one.
- `profiles` has no `deleted_at`.

Propose better formulations if you have them — you have twice improved on what I asked
for, and the append-only two-directional check was a better idea than my version.

## 7. Tests

- A soft-deleted assignment is invisible to an enrolled student, asserted at the database.
- The same row is still readable by the professor who teaches it.
- Undelete restores student visibility.
- Two courses may share a code once the first is soft-deleted; two live courses may not.
- A soft-deleted course does not break the composite FK from its offerings.
- `alumni` and `inactive` cannot sign in; `active` can.
- Every existing assertion still passes.

---

## Done means

Migration applied, `0003_grants.sql` re-run (no new tables, but the habit and the
idempotency test both stay). All 227 existing assertions green plus the new ones. Build,
typecheck, lint clean. `SPEC.md` §4 updated to record `status`, `deleted_at`, and which
tables deliberately lack them — with the reasons, so nobody adds them later thinking it
was an oversight.

Report: which tables you indexed and why, how you formulated the invariants, whether any
existing policy needed rewriting rather than extending, and anything in
`DELETION_POLICY.md` that turned out to be unimplementable as written.
