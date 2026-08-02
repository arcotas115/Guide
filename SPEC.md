# SPEC.md — Campus: full product specification

This is the authoritative spec for the Campus app. Read it before building.
Companion: `BUILD_RULES.md` (operating rules and stack). Where this
spec and code disagree, this spec wins — update it if requirements change.

**Revision 8 (Submissions table, 1C-i).** No schema change. Two decisions recorded: the
late penalty is **shown, never applied** (see Decisions below, replacing the open question
carried since 1A), and `hide_names_while_grading` binds to the **Submissions table as well
as SpeedGrader** — §3.7 described it as a SpeedGrader behaviour, but a professor who can
read the names on the table simply reads them there first, which makes the anonymity in
SpeedGrader theatre. Search "Revision 8".

**Revision 7 (submitting, `0009_submit_attempts.sql` + `0010_storage.sql`).** Three
changes: `submissions.is_late` is **dropped** and late-ness derived per attempt; a new
`submission_attempts` table makes an attempt an entity; and submitting moves out of RLS
into `submit_attempt()`, a SECURITY DEFINER function that is now the only way in. Storage
gets a private bucket and policies, both in a migration. Search "Revision 7".

**Revision 6 (soft-delete cascade, `0008_soft_delete_cascade.sql`).** A soft-deleted term,
course or offering now hides its content from non-staff at the RLS level. Previously it
did not, because policies reaching a parent through a `SECURITY DEFINER` helper do not
inherit its RLS while ones using a direct subquery do — so cascade behaviour was decided
by that accident. Search "Revision 6".

**Revision 5 (soft delete, `0007_soft_delete.sql`).** Implements `DELETION_POLICY.md`.
`profiles.status` (active / alumni / inactive) replaces any notion of deleting a person;
`deleted_at` lands on the twelve tables a human *creates* and on none of the ones that
record an *event* or an academic record. Six business-key uniques become partial so a
retired course code is reusable; roll numbers deliberately are not. Hiding is enforced by
a RESTRICTIVE RLS policy rather than by queries. Search "Revision 5".

**Revision 4 (tenant integrity, `0006_tenant_integrity.sql`).** Mostly a confirmation:
the composite-foreign-key convention below was already enforced everywhere (48 of 48
cross-table FKs), and `authenticated` already held no `TRUNCATE`. What changed is that
both are now asserted by catalogue tests rather than by convention, the audit actor
became `NOT NULL`, `grade_history.changed_at` moved to `clock_timestamp()`, and
append-only tables declare themselves with an `@append-only` comment token instead of
appearing in a hand-maintained list. Search "Revision 4".

**Revision 3 (foundations migration, `0005_foundations.sql`).** Four changes, all made
before real grade data existed: (1) `institutions.timezone` — every timestamp the app
renders now resolves through the institution, never through a constant; (2) audit
columns `assignments.updated_at`/`updated_by` and `submission_grades.updated_by`;
(3) a new append-only `grade_history` table, written by a trigger, unreadable by
students; (4) the four leftovers from 1A — `allow_multiple_attempts`, a CHECK that an
assignment accepts at least one submission type, and `marks > 0` so the database and zod
finally agree. Search "Revision 3" to find each change.

**Revision 2 (Milestone 1A).** Three amendments, all made before any assignment or
grade row existed: (1) grades moved off `submissions` onto their own table so an
unpublished grade is physically unreadable rather than merely unrendered;
(2) `late_until`, `late_penalty_pct_per_day` and `hide_names_while_grading` added to
`assignments` — the prototype's create-assignment form had all three and this spec did
not; (3) Milestone 1 split into four sessions. Search "Revision 2" to find each change.

---

## 0. What this is, in one paragraph

A mobile-first campus platform for Indian colleges. Students (on phones) see their
courses, deadlines, timetable, grades, attendance, placements, and project teams.
Professors (on laptops) run their courses: post content, create and grade assignments,
take attendance, manage teams. Admins (on laptops) set up the institution: terms,
departments, courses, offerings, people, enrolments, timetable. It is calm, warm, and
genuinely pleasant to use — that experience quality is the entire competitive edge.

---

## 1. Roles

- **student** — mobile-first. Sees only their own data.
- **faculty (professor)** — desktop. Manages the courses (offerings) they teach.
- **admin** — desktop. Sets up and manages the whole institution.
- (placement_officer — later; for now placement drives can be managed by admin.)

A `role` field on the user's profile drives everything. RLS policies enforce that a
student sees only their rows, a professor only their offerings' rows, an admin only
their institution.

---

## 2. Core structural model (the important bit)

Read this carefully; the whole app hangs off it.

- An **institution** has **departments**, **terms**, a set of **courses** (the catalog),
  and **people** (profiles: students, faculty, admins).
- A **course** (e.g. "CS301 Operating Systems") is a catalog entry. It does not run by
  itself.
- A **course offering** is a course running in a specific **term** and **section**
  (e.g. CS301 · Monsoon 2026 · Section A). This is the unit that has a professor,
  enrolled students, a timetable, assignments, attendance, etc.
  **This course-vs-offering split is the #1 thing to get right.** Skipping it breaks
  history the moment a second term starts.
- **teaching_assignments** link faculty to offerings (a course can be co-taught).
- **enrolments** link students to offerings.

Everything students and professors touch (assignments, submissions, announcements,
files, attendance, teams) hangs off an **offering**, never off the bare course.

---

## 3. Feature spec by surface

### 3.1 STUDENT — navigation
Bottom bar (5 tabs): **Home · Calendar · To-Do · Notifications · More**

- **Home** = vertical scroll of course cards for this term. Each card: course code,
  course name, professor, and the course's identity color (shown as a left accent bar +
  the code in that color). Identity-only — no due counts on the card. Tap → course.
- **Calendar** = week-view timetable (Indian style), classes as hour blocks tinted by
  course color, room shown, "now" line. Tap a class → its course.
- **To-Do** = deadlines aggregated across all courses, **time-bucketed**: Overdue /
  Today / This Week / Later. Only unfinished items (submitting removes it). Warm empty
  state. Each row tinted with course color; tap → assignment.
- **Notifications** = one aggregated stream of professor announcements across all
  courses, newest first, unread dot, read items visually quieter. Tap → the course/announcement.
- **More** = profile, Attendance (aggregate), Placements, settings. (NO fees.)

### 3.2 STUDENT — course detail
Tap a course → course-color-tinted header + a vertical list of sections (Canvas-mobile
style, NOT top tabs): **Info · Assignments · Announcements · Grades · Files · Attendance · Teams**
Each section opens as its own screen with a light course-color-tinted header and a
contextual back button (e.g. "← Operating Systems", never generic "Back").

- **Info** — course description/outline, professor, office hours, credits, class
  days/room, mark-split (e.g. Labs 40% / Mid 25% / End 35%). Read-only for students;
  written by the professor.
- **Assignments** — list of the course's assignments, each showing its STATE (see 3.7).
  Tap → assignment detail + submission.
- **Announcements** — professor's posts for this course, newest first.
- **Grades** — student's own marks per assessment; for each, the anonymous **class
  average and median** ("You 18 · Class avg 14 · Median 15"). A term summary (their
  own average). **No ranking, ever.** Only shows PUBLISHED grades (see 3.8).
- **Files** — professor's materials (any file type) and links, downloadable.
- **Attendance** — this course's % + plain-language projection ("You can miss 3 more
  and stay above 75%" / "Short by 2 — attend the next 5"). See 3.9.
- **Teams** — this course's team sets and the student's join/leave flow. See 3.6.

### 3.3 STUDENT — persistent submitted receipt
Once a student submits an assignment, a quiet green ✓ persists everywhere that
assignment appears (course list, To-Do, home) so they never doubt "did it go through?".

### 3.4 STUDENT — placements (final-years; lives in More)
- Browse company drives (company, role, CTC, location, eligibility criteria, deadline).
- Eligibility shown clearly ("You meet all criteria" vs "Not eligible — needs CGPA 8.0,
  you have 7.8"), auto-checked from the student's academics.
- Drive detail → Apply (opens the company's external application page; the app is not
  the ATS). Shortlists come back as a post from the placement cell.
- "My applications" → track status: Applied → Shortlisted → Interview → Offer.

### 3.5 PROFESSOR — navigation and course workspace
- **Professor home:** warm greeting (no workload tally), color-coded course cards each
  with actionable per-course hints ("16 submissions to grade", "attendance not taken
  today"), and a "Your Day" schedule with contextual actions. NO stat boxes.
- Tap a course → **course workspace** with a calm left sidebar (rust badge = needs
  attention, gray badge = neutral count). Sidebar sections:
  **Course info · Assignments · Submissions · Announcements · Files · Attendance · Teams · Roster.**
  Land on Assignments (no separate "Overview" dashboard).
- **Course info** — form to edit the info students read; mark-split with live "= 100%".
- **Assignments** — table with each assignment's state, submitted progress, and grading
  status. Create/edit assignment (see 3.7). **Publishing** an assignment and
  **extending** a deadline both auto-post an announcement to the course. (Revision 2:
  the prototype's create form states this on publish; this spec previously mentioned it
  only on extend. Implemented in the Announcements session, not Milestone 1A.)
- **Submissions** — per assignment, a table of students with submission state,
  timestamps, late flags, marks. Click a student → SpeedGrader (see 3.8).
- **Announcements** — posted list + compose. Posting appears instantly on student phones.
- **Files** — upload (any type) or add a link; list with remove.
- **Attendance** — start a live session + past sessions with edit. See 3.9.
- **Teams** — manage team sets. See 3.6.
- **Roster** — enrolled students with attendance % and submission counts (read-only).

### 3.6 TEAMS (multiple team sets per course)
A course can have **multiple independent team sets**, each for a different purpose
(e.g. "Lab pairs" size 2, "Term project" size 5, "Seminar groups" size 3).

- **Team set** = name, min size, max size, its own teams, its own locked/unlocked state,
  and an on/off toggle for whether students see it. All independent per set.
- **Professor:** create a team set (name + min/max), view its teams (with "Full" /
  "Under minimum" flags), and Lock it. At lock time, if any team is under-minimum or any
  student hasn't joined, show a SOFT warning naming them but ALLOW locking anyway
  (never hard-block). Professor decides; the app only flags.
- **Student:** in a course's Teams section, sees each team set; per set can Create a team
  (creating does NOT auto-join the creator), Join any non-full team, or Leave. A student
  can be in only ONE team per set (but different teams across different sets). After a set
  is locked, it's view-only.
- **Team assignments:** a team assignment links to ONE team set. Its grade is entered
  once per team and applied to all members of that team.

### 3.7 ASSIGNMENT (the core object) — state machine
These student-facing states are DERIVED (not a stored field) from the assignment's
stored `status` (draft/open/closed) + `opens_at`/`due_at`/`allow_late` + the student's
own submission + `grades_released`:
- **Upcoming** — opens_at in the future ("opens Aug 2"), visible but not actionable.
- **Open** — status=open and now ≤ due_at (or within the late window); submittable.
- **Submitted** — the student has a submission; "submitted [time] · awaiting grade".
- **Graded** — has a grade AND grades_released=true; shows mark + feedback.
- **Overdue** — past due_at, no submission. The only state with the rust accent.
  If allow_late, shows "accepted till [date]" — read from the assignment's stored
  `late_until`. (Revision 2: this previously said "derived from due_at + the allowed
  window", but no such window was ever defined anywhere in this spec, which made the
  derivation impossible as written. The window is now stored explicitly.)
(Draft assignments are not visible to students at all.)

Assignment properties (set by professor on create):
- title, instructions, attached files, marks, open date, due date.
- **late submission allowed?** — a per-assignment toggle. When on, an explicit
  **late until** date sets the end of the late-acceptance window and is what the
  "accepted till [date]" copy reads. When on with no date set, late work is accepted
  until the assignment is closed.
- **late penalty** — percent per day, `0` meaning no deduction (UI presets 0 / 5 / 10 /
  20, custom value allowed). `0` is what the student-facing "no penalty mentioned" copy
  renders — the absence of a penalty is a value, not a missing concept.
- **hide names while grading** — anonymous grading. The professor sees roll numbers
  instead of names in SpeedGrader until a grade is saved for that submission.
  Display-only; it never changes stored data.
- **submission types accepted** — any combination of file(s) (any type) / link / text.
  Default: all allowed. (v1: open by default.)
- **is team assignment?** — if yes, pick which **team set** it grades against.
- Multiple attempts allowed; the newest submission is the graded one.

(Revision 2: the last three of these come from the prototype's create-assignment form
and were absent from this spec. They are columns on `assignments`, added in 1A while
the table was still empty. Their UI ships in the session that uses each one.)

The same assignment object appears in its course's Assignments AND (if open/overdue)
aggregated in the student's To-Do. Submitting removes it from To-Do and sets the ✓.

### 3.8 GRADING — SpeedGrader + publish flow
**SpeedGrader** (professor, opens from Submissions): a focused split screen —
- Left: the student's submission rendered INLINE (no download): PDF inline, images
  inline, text shown, links openable. Non-renderable types (zip, code) → download button.
  Show submitted time, late flag, attempt number.
- Right: marks input (out of total), feedback text box, Save, Next/Previous to move
  through students in a rhythm, and a progress indicator ("12 of 38 graded").
- Autosave each grade; show "saved · not published". Keyboard shortcuts: arrows =
  next/prev, Enter = save.
- **Team assignment:** grade PER TEAM (one grade + feedback applied to all members);
  next/prev moves between teams.

**Publish flow** — grades are private until released (governed by
`assignments.grades_released`, NOT a per-submission flag):
- Grade states (derived): Not graded (no `submission_grades` row) → **Graded
  (unpublished)** (row exists, grades_released=false) → **Published** (row exists,
  grades_released=true).
- **This is enforced in the DATABASE, not in the UI.** An unpublished grade is
  physically unreadable by the student, not merely unrendered — see `submission_grades`
  in §4. (Revision 2.)
- Saving a grade sets graded_at but does not release it; student still sees "awaiting grade".
- Submissions table distinguishes Not submitted / Submitted / Graded (unpublished) /
  Published, and has a **"Publish all grades"** action (flips grades_released=true for the
  assignment, releasing all its grades to students at once; confirm the count).
- Rationale: professor can grade over days and adjust before anyone sees; all students
  find out together; the class average/median students see is complete and honest.
- **Post-publish correction:** once published, editing an individual grade goes live to
  that student immediately (no second publish step in v1).

### 3.9 ATTENDANCE — code sessions + manual override + projection
- **Professor** starts a session for today's class → app generates a rotating 6-digit
  code (+ QR) to project. Code rotates every ~60s (anti-proxy).
- **Students** enter the code / scan → auto-marked present; professor watches a live
  roster fill.
- **Manual override:** professor can tap any student to mark present/absent (dead phone,
  no phone) and toggle any student while the session is open. Ending the session locks
  it; unmarked = absent. Past sessions are editable for corrections.
- **Current %** = present ÷ sessions-actually-held (exact, from real marked sessions).
- **Projection** ("can miss X more" / "short by X") = computed using the timetable
  (remaining classes = weekly meeting pattern × weeks left in term) against the 75%
  threshold. Term dates come from Term setup. Phrase projections calmly and in plain
  language; a soft hedge ("about 3 more, based on the schedule") is fine.
- Student sees per-course attendance (in the course) and an aggregate view (in More),
  grouped "Needs attention" vs "Fine".

### 3.10 ADMIN — setup surfaces (desktop, left sidebar)
Sidebar groups: INSTITUTION (Overview, Term, Departments) · ACADEMICS (Courses,
Offerings, Timetable) · PEOPLE (Students, Faculty, Enrolment).

- **Overview** — a genuine setup checklist: what's incomplete (offerings without a
  professor, offerings not scheduled, offerings with nobody enrolled). This IS the
  admin's job, so a checklist/summary here is correct (unlike the professor side).
- **Term** — name, first/last day of class (drives attendance projection). Shows
  derived teaching weeks/days.
- **Departments** — list (code, name, #courses, #people) + add.
- **Courses** — the catalog (code, title, department, credits) + "New course". Shows
  which sections run this term / "+ offer it".
- **Offerings** — a course running this term with its professor(s), enrolment count,
  and timetable slot. Create offering (course + term + section + professor). Rust flags
  for "Nobody assigned / Assign a professor" and "Not scheduled".
- **Timetable** — set which days/times/rooms each offering meets (week grid +
  per-offering list). Feeds student Calendar and attendance projection.
- **Students** — list (name, roll number, department, batch/year, #courses) with
  department filters and **bulk import ("Bring in a list" / CSV)**. Add/edit.
- **Faculty** — list (name, department, what they teach this term) + add.
- **Enrolment** — assign students to offerings; two-panel (not-enrolled → enrolled),
  multi-select, batch enrol, section/year filters.

---

## 4. Data model (Postgres / Supabase)

**SCALE DISCIPLINE (target: 1,000+ institutions across many cities):** This schema is
designed to be shardable by tenant. Enforce ALL of these (see BUILD_RULES.md load-bearing
rules): every table has `institution_id NOT NULL`; all PKs are UUIDs; no foreign key
crosses an institution boundary; every query is tenant-scoped (zero cross-tenant queries
ever); institution-specific rules are config-as-data (not hardcoded); index every
tenant-scoping column. The app speaks standard SQL so the DB can move to dedicated/sharded
Postgres at scale without an app rewrite. Do NOT build sharding/infra now — build the
shardability now, the shards later.

**SOFT DELETE — `deleted_at`, and where it deliberately is not (Revision 5).**

`deleted_at timestamptz null` is on the twelve tables that hold a thing **a human
created**, and which they can therefore create by mistake:
`departments` · `terms` · `courses` · `course_offerings` · `assignments` ·
`announcements` · `materials` · `team_sets` · `teams` · `placement_drives` ·
`companies` · `attendance_sessions`

**It is deliberately absent from the rest, and the reasons matter — nobody should add one
later thinking it was an oversight:**

| Table | Why not |
|---|---|
| `grade_history` | Append-only. A nullable timestamp anyone can set is a delete wearing a different hat. Not a judgement call. |
| `institutions` | Offboarding is export-then-purge, not a hidden row. |
| `attendance_records` | An event. You *correct* a mark; you do not delete it. |
| `submissions`, `submission_files`, `submission_grades` | Academic record. Removing a student's work is an erasure question, answered by anonymising the person. |
| `profiles`, `student_academics` | People are deactivated, never hidden — see `status` above. |
| `enrolments`, `teaching_assignments`, `team_members` | Join rows. `team_members` already hard-deletes on "leave team", which is correct. |
| `notifications`, `announcement_reads` | Ephemeral. Hard delete is fine. |

- **A hidden parent hides its children (Revision 6).** `offering_chain_live(offering_id)`
  states the chain once — the offering, its course and its term must all be live — and a
  RESTRICTIVE policy on every offering-scoped table enforces it. Generated from the
  catalogue by "has an `offering_id` column", so a table added later is covered
  automatically. `teams`/`team_members` reach an offering through `team_set_id` and carry
  their own named policies. **`submissions` and `attendance_records` deliberately do NOT
  cascade** — they are academic record, and a student keeps sight of their own work and
  attendance even when the offering is hidden (DELETION_POLICY.md §5b).
- **Hiding is enforced in RLS, not in queries.** Each soft-deletable table carries a
  RESTRICTIVE policy `deleted_at is null or is_staff()`, which is ANDed with its existing
  permissive policies. So a forgotten `where` clause cannot leak a hidden row to a
  student, and staff keep read access because otherwise nothing could ever be undeleted.
  Deleting is an UPDATE, already covered by the existing write policies — there are no
  delete policies and none are needed.
- **Reads go through `live()`** (`src/lib/soft-delete.ts`), which applies
  `deleted_at is null` by default, so seeing hidden rows is something a call site asks
  for rather than something it gets by forgetting.
- **Six business keys became partial** (`where deleted_at is null`), so the value is
  reusable once the row is hidden: `courses (institution_id, code)`,
  `departments (institution_id, code)`, `terms (institution_id, name)`,
  `course_offerings (course_id, term_id, section)`,
  `attendance_sessions (offering_id, held_on)`, `companies (institution_id, name)`.
  **No `unique (id, institution_id)` key may ever become partial** — a partial index
  cannot be a foreign-key target, and those keys are what every composite FK references.
  Asserted by a catalogue test, and Postgres itself refuses the drop.

**COMPOSITE FOREIGN KEYS — how rule 4 is enforced rather than intended (Revision 4).**
BUILD_RULES rule 4 says no foreign key crosses an institution boundary. That is a
property the database enforces here, not a convention reviewers watch for:

- Every parent table carries a redundant `unique (id, institution_id)`. Redundant on its
  own — `id` is already the primary key — and it exists solely so children can reference
  the pair.
- Every foreign key **between two tables that both carry `institution_id`** is composite:
  `foreign key (parent_id, institution_id) references parent (id, institution_id)`. That
  makes a child row pointing at another institution's parent unrepresentable, rather than
  merely discouraged.
- **Two deliberate exemptions.** `<table>.institution_id → institutions(id)` is
  single-column because `institutions` has no `institution_id` — it *is* the tenant. And
  `profiles.id → auth.users(id)` crosses into Supabase's auth schema, which has no tenant
  column; that is the identity edge BUILD_RULES rule 6 allows Supabase to own.
- **A new table must follow this.** `supabase/tests/rls.test.mjs` asserts the invariant
  against the catalogue, so a single-column FK between two tenant-scoped tables fails the
  build. The cost is ~20 extra unique indexes, paid on write; it was paid in 0001 and is
  the standard price of declarative tenant integrity.

**APPEND-ONLY TABLES (Revision 4).** A table that must never be updated or deleted from
declares itself by carrying the literal token `@append-only` in its table comment.
`0003_grants.sql` reads the catalogue for that token and revokes write grants, so the
list is never hand-maintained — the previous hand-written array would have silently
re-granted UPDATE on any table someone forgot to add. The test asserts the marker and the
policies agree in both directions.

Every domain table has `institution_id uuid not null references institutions(id)` and
RLS enabled with policies keyed off the requesting user's profile. Timestamps
(`created_at timestamptz not null default now()`) on everything. IDs are uuid default
`gen_random_uuid()` unless noted.

### Tenancy & people
- **institutions**(id, name, slug unique, min_attendance_pct int default 75,
  timezone text not null default 'Asia/Kolkata')
  — **`timezone` is config-as-data (Revision 3).** Every date the app renders resolves
    through it; `src/lib/format.ts` takes it as a REQUIRED argument so a screen cannot
    silently fall back to one country's time. IANA name ('Asia/Kolkata', 'Asia/Dubai').
  — Validation is split on purpose. The DB CHECK enforces SHAPE only (`UTC` or
    `Region/City`), because a constraint that looked the name up in `pg_timezone_names`
    could not be IMMUTABLE and would turn a tzdata difference into a restore failure.
    EXISTENCE is validated in zod against `Intl` — which is the database that actually
    renders every timestamp, and a different one from Postgres's. See
    `src/lib/timezone.ts`. Note that ICU accepts bare abbreviations and resolves them
    badly (`EST` → `America/Panama`, a fixed −05:00 zone with no DST), so the app
    requires the `Region/City` form too.
- **departments**(id, institution_id, name, code) — unique(institution_id, code)
- **profiles**(id = auth.users.id, institution_id, department_id?, role
  check in ('student','faculty','admin','placement_officer'), full_name, email,
  roll_number?, batch_year?, status text not null default 'active'
  check in ('active','alumni','inactive')) — unique(institution_id, roll_number)
  — **`status` is access level, not biography (Revision 5).** `active` = full access;
    `alumni` = may sign in, read-only, own historical records (the surface itself is
    deferred — the login guard refuses alumni for now, with its own warm message);
    `inactive` = may not sign in. A retired professor the college wants kept out is
    `inactive`; one they are happy to let browse old courses is `alumni`.
  — **profiles NEVER get `deleted_at` (Revision 5).** Hiding a person leaves holes
    wherever their name sits beside their work — a submissions list with a mark and no
    student attached. Erasure is handled by ANONYMISING the profile (name, email, resume)
    while the academic record stays, not by deleting the row. See DELETION_POLICY.md §3.
  — **The roll-number unique is deliberately NOT partial.** A roll number is issued once
    and held for all time; reusing one while the previous holder's grades exist would let
    one person's marks surface under another's name.
  — index(institution_id, status) — every roster query filters on that pair.
- **student_academics**(student_id pk → profiles, cgpa numeric(4,2), backlogs int
  default 0, batch_year int, resume_url?, updated_at)

### Courses & offerings
- **terms**(id, institution_id, name, starts_on date, ends_on date)
- **courses**(id, institution_id, department_id?, code, title, credits int, color)
  — unique(institution_id, code). `color` is the course identity color.
- **course_offerings**(id, course_id, term_id, section default 'A')
  — unique(course_id, term_id, section)
- **teaching_assignments**(offering_id, faculty_id) — pk(offering_id, faculty_id)
- **enrolments**(offering_id, student_id, enrolled_at) — pk(offering_id, student_id);
  index(student_id)

### Timetable
- **timetable_slots**(id, offering_id, day_of_week int (1=Mon..6=Sat), starts_at time,
  ends_at time, room text) — an offering can have several (e.g. Mon/Wed/Fri).

### Course content
- **course_info**(offering_id pk, description text, office_hours text, meeting_days text,
  room text) — the editable Info; mark_split below.
- **mark_split_items**(id, offering_id, label text, weight_pct int) — must sum to 100.
- **materials**(id, offering_id, uploaded_by, title, kind check in ('file','link'),
  storage_path? , url?, file_name?, size_bytes?, created_at)
- **announcements**(id, offering_id, author_id, title, body, created_at)
- **announcement_reads**(announcement_id, student_id, read_at) — pk(announcement_id, student_id)

### Assignments & submissions
- **assignments**(id, offering_id, created_by, title, instructions, marks numeric(6,2),
  opens_at timestamptz?, due_at timestamptz, allow_late boolean default true,
  late_until timestamptz?, late_penalty_pct_per_day numeric(5,2) not null default 0,
  hide_names_while_grading boolean not null default false,
  allow_multiple_attempts boolean not null default true,
  accept_file boolean default true, accept_link boolean default true,
  accept_text boolean default true, is_team boolean default false,
  team_set_id? → team_sets, created_at,
  updated_at timestamptz not null default now(), updated_by? → profiles)
  — TWO DISTINCT publish concepts, do not conflate:
    • `status` check in ('draft','open','closed') default 'draft' — the assignment's
      own lifecycle. Draft = students can't see it yet; Open = students can submit;
      Closed = past due / no longer accepting. (Late-accepted window is derived from
      due_at + allow_late, not a separate status.)
    • `grades_released` boolean default false + `grades_released_at` timestamptz? —
      whether the GRADES for this assignment have been published to students (the
      "Publish all grades" action). Independent of `status`.
  — **THE LATE WINDOW IS STORED, NOT DERIVED** (Revision 2). `late_until` is the
    explicit end of the late-acceptance window and is what the student's "accepted till
    [date]" copy reads. Constraints: `late_until is null or late_until > due_at`, and
    `late_until` must be null when `allow_late` is false. `allow_late = true` with a
    null `late_until` means late work is accepted until the assignment is closed.
  — `late_penalty_pct_per_day numeric(5,2) not null default 0`, constrained between 0
    and 100. `0` = no deduction. Whether this is APPLIED to a saved grade is an open
    question deferred to Milestone 1C — see Decisions below. Nothing computes with it
    before then.
  — `hide_names_while_grading` — anonymous grading in SpeedGrader (Milestone 1C).
    Display-only: it never alters stored data and never changes the Submissions table's
    own counts.
  — **`marks > 0`** (Revision 3). Was `>= 0`; zod already rejected zero, and a zero-mark
    assessment is meaningless. The `default 0` was dropped with it, so omitting marks now
    fails as a missing required value rather than as a confusing CHECK violation.
  — **`check (accept_file or accept_link or accept_text)`** (Revision 3). A professor
    could previously uncheck all three and leave students no way to hand anything in.
  — **`allow_multiple_attempts`** (Revision 3) — the prototype's "Allow more than one
    attempt" toggle. Column only; the behaviour and UI are Milestone 1B's.
  — **`updated_at` / `updated_by`** (Revision 3). The split is deliberate: `updated_at`
    is maintained by a TRIGGER so it cannot be forgotten, and `updated_by` is set by the
    APPLICATION. The trigger deliberately does NOT read `auth.uid()` — that would couple
    every write in the schema to Supabase Auth, which BUILD_RULES rule 6 confines to
    swappable edges.
  index(offering_id, due_at), index(offering_id, status, due_at), index(updated_by)
- **assignment_files**(id, assignment_id, storage_path, file_name) — prof-attached files.
- **submissions** — DECIDED model (do not offer alternatives): exactly ONE submission
  row per student per assignment (or per team per assignment for team assignments).
  Resubmissions add a new attempt to `submission_files` and bump the submission's
  `latest_attempt`.
  (id, assignment_id, student_id?, team_id?, submitted_at, latest_attempt int default 1)
  — **`is_late` was DROPPED (Revision 7).** It was stored at submit time, which
    contradicts the product: the announcement copy promises that extending a deadline
    makes work show *as on time*, and a frozen boolean cannot do that. Late-ness is now
    DERIVED per attempt — `attempt.submitted_at > assignment.due_at` — so it self-corrects
    with no write. A stored column nothing reads is a trap for whoever reads it next.
  — Attempt 1 on time and attempt 2 late are both true and both shown. **The app does not
    decide which one counts**; it flags each honestly and shows the professor all of them,
    the same philosophy §3.6 applies to locking team sets.
  — individual: unique(assignment_id, student_id); team: unique(assignment_id, team_id).
    Exactly one of student_id / team_id is set (team_id iff the assignment is_team).
  — **The grade does NOT live on this row** (Revision 2 — it used to). See
    `submission_grades` below. index(student_id), index(team_id)

- **submission_grades**(submission_id pk → submissions, grade numeric(6,2) not null,
  feedback text?, graded_by → profiles, graded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), updated_by **not null** → profiles)
  — **`updated_by` is NOT NULL** (Revision 4). An audit trail that cannot say who
    changed a grade is not an audit trail. Enforced on the column rather than by a
    RAISE in the trigger, so it is declarative, visible in a schema dump, and covers
    write paths the trigger never sees.
  — **`graded_by` vs `updated_by`** (Revision 3). `graded_by` is who FIRST marked it;
    `updated_by` is who LAST changed it. On a post-publish correction those are
    frequently different people, and that difference is the whole point of having both.
    `updated_by` is also what the grade_history trigger records as the actor.
  — **WHY THIS IS A SEPARATE TABLE. Do not fold it back into `submissions`.**
    RLS is ROW-level. It can hide a row; it cannot hide a *column* on a row the user is
    entitled to read. A student must be able to read their own `submissions` row from
    the moment they submit — that row is what drives the persistent ✓ and the
    "submitted [time] · awaiting grade" line. If the grade lived on that row, it would
    be readable over the API the instant the professor saved it, no matter what the UI
    chose to render. That breaks both promises in §3.8: that a professor can grade over
    days and adjust before anyone sees, and that all students find out together.
    Splitting the grade onto its own row turns visibility into a pure row-level
    question, which is precisely what RLS enforces well.
  — Existence of the row = "graded". Visibility of the row to a student is governed by
    the parent assignment's `grades_released`. There is still NO per-submission publish
    flag — that part of the original decision is unchanged.
  — Team assignments: one `submissions` row per team means one `submission_grades` row
    per team, which is what applies a single grade to every member.
  — index(graded_by). The student read path joins
    submission_grades → submissions → assignments, so all three join columns must be
    indexed (see RLS notes below).
- **grade_history**(id, institution_id, submission_id → submissions,
  old_grade numeric(6,2)?, new_grade numeric(6,2) not null,
  old_feedback text?, new_feedback text?, changed_by **not null** → profiles,
  changed_at timestamptz not null default clock_timestamp())
  — **`clock_timestamp()`, not `now()`** (Revision 4). `now()` is
    `transaction_timestamp()` and is constant for a whole transaction, so a bulk grade
    save would write every history row with an identical timestamp and no way to say
    which correction came first. Measured: three inserts in one transaction produced one
    distinct `now()` and three distinct `clock_timestamp()`. It is still not a guaranteed
    total order, so the `id` tiebreak on the index stays — `clock_timestamp` makes the
    ordering meaningful, the tiebreak makes it deterministic.
  — **APPEND-ONLY, AND WRITTEN BY A TRIGGER** (Revision 3). Not by the application: an
    audit log the app is trusted to write is an audit log that stops being written the
    first time someone adds a code path and forgets — and that code path is exactly the
    one worth auditing. The trigger on `submission_grades` fires on insert and update,
    skips no-op updates, and takes `changed_by` from `NEW.updated_by`, so the actor is
    recorded without the database knowing anything about the auth provider.
  — **No role may UPDATE or DELETE**, including faculty and including admin. Enforced
    twice: no such policy exists, and the grants are revoked (see the append-only
    section of `0003_grants.sql`, which must not re-grant them on a re-run). There is
    also no client INSERT policy — the trigger is SECURITY DEFINER, so granting one
    would only let a professor forge a row.
  — **STUDENTS CANNOT READ IT AT ALL** — not their own rows, and not after
    `grades_released` flips. "Your grade was changed from 12 to 18" would undo the whole
    publish flow in §3.8, which exists so a professor can revise a mark before anyone
    sees it. Faculty who teach the offering can read it; admins can within their
    institution.
  — index(submission_id, changed_at desc, id desc), index(institution_id). The uuid
    tiebreak matters: `changed_at` resolves to the millisecond, so two corrections saved
    in the same millisecond tie and would otherwise render in a different order on
    consecutive loads.

- **submission_attempts**(id, institution_id, submission_id → submissions, attempt int,
  submitted_at timestamptz not null default now()) — **unique(submission_id, attempt)**
  — **An attempt is an entity (Revision 7).** Deriving its time from `min(uploaded_at)`
    over its items gives three candidate answers when an attempt holds a file, a link and
    a typed answer, and moves if an item is ever replaced.
  — The unique constraint is what makes the two-tabs race **unrepresentable** rather than
    merely unlikely: two browser tabs both reading `latest_attempt = 1` cannot both write
    attempt 2.
  — index(submission_id, attempt desc), index(institution_id)

- **submission_files**(id, submission_id, attempt int default 1, kind check in
  ('file','link','text'), storage_path?, url?, text_body?, file_name?, uploaded_at)
  — one submission can have several items in one attempt (a file + a link + text), and
    several attempts over time. The graded attempt is the latest (submissions.latest_attempt).

### Attendance
- **attendance_sessions**(id, offering_id, held_on date, taken_by,
  status check in ('open','closed') default 'open', opened_at, closed_at?,
  code_seed text) — unique(offering_id, held_on).
  NOTE on the rotating code: do NOT store the live 6-digit code as a column (it changes
  every ~60s). Store a per-session `code_seed`; the current valid code is derived from
  (code_seed + current 60s time-window), and server-side validation accepts a code that
  matches the current or immediately-previous window (grace for clock skew / entry lag).
  The QR encodes the same current code. This keeps it anti-proxy without a code table.
- **attendance_records**(session_id, student_id, status check in
  ('present','absent','excused'), marked_via check in ('code','manual'),
  marked_at) — pk(session_id, student_id).
  Current % for a course = present ÷ (# closed sessions for the offering). Projection is
  computed from timetable_slots (weekly meetings) × weeks remaining (from the term's
  ends_on) against the 75% threshold — NOT stored, computed on read.

### Teams (team sets)
- **team_sets**(id, offering_id, name, min_size int, max_size int, is_visible boolean
  default true, locked boolean default false, created_at)
- **teams**(id, team_set_id, name, created_at)
- **team_members**(team_id, team_set_id, student_id, joined_at) — pk(team_id, student_id);
  `team_set_id` is denormalized from the team to enforce the rule at the DB level:
  **unique(team_set_id, student_id)** makes "one team per set" impossible to violate.

### Placements
- **companies**(id, institution_id, name, website?)
- **placement_drives**(id, institution_id, company_id, role_title, job_description,
  ctc_lpa numeric(6,2)?, location text?, min_cgpa numeric(4,2) default 0,
  max_backlogs int default 999, eligible_batch_year int?, apply_deadline timestamptz,
  apply_url text?, status check in ('draft','open','closed','completed') default 'open',
  created_by, created_at)
- **drive_departments**(drive_id, department_id) — pk(drive_id, department_id)
- **drive_applications**(id, drive_id, student_id, applied_at, status check in
  ('applied','shortlisted','interview','offered','accepted','rejected','withdrawn')
  default 'applied') — unique(drive_id, student_id); index(student_id)

### Notifications
- **notifications**(id, user_id, type text, payload jsonb default '{}', read_at?,
  created_at) — index(user_id, read_at). v1 type = 'announcement'; extensible later.

### Submitting — a FUNCTION, not a policy (Revision 7)

`submit_attempt(p_assignment_id uuid, p_items jsonb)` is the **only** way to create or
extend a submission. Clients hold no INSERT or UPDATE on `submissions`,
`submission_attempts` or `submission_files`; all three carry the `@function-written`
marker that `0003_grants.sql` reads to keep it that way across re-runs.

It exists because three things RLS cannot do had to happen at once:

1. **A student could not resubmit at all.** Bumping `latest_attempt` is an UPDATE, and
   the only UPDATE policy on `submissions` is the professor's. It failed silently, at 0
   rows affected.
2. **The obvious fix was worse.** Granting students UPDATE also grants `submitted_at` —
   and RLS cannot compare OLD to NEW, so nothing would stop a student backdating their own
   work. The same trap already documented for `profiles.role`.
3. **The resubmission path skipped the deadline entirely.** The old
   `submission_files_student_insert` checked ownership and never looked at the assignment;
   a student could append work to an assignment that closed weeks earlier, labelled any
   attempt number they chose. Verified against a running database before it was closed.

The function verifies enrolment, that the assignment is open / past `opens_at` / within
`due_at` or the late window, and the multiple-attempts policy; computes the attempt number
from the database inside one statement; and sets `submitted_at` from the server clock. A
client-supplied attempt number or timestamp is not read at all.

### Storage — the path convention IS the access-control rule (Revision 7)

Private bucket `submissions`, created and governed in `0010_storage.sql` rather than
through the dashboard, because configuration that exists only in a web UI cannot be
reviewed, diffed or restored.

```
{institution_id}/{assignment_id}/{owner_id}/{attempt}/{filename}
```

Institution FIRST, deliberately: tenant isolation is visible in the path itself, which is
what makes a later move to per-tenant buckets or institution-provided storage a migration
rather than a rewrite (FUTUREPROOFING item 5). `storage.foldername()` is 1-indexed, so the
owner is segment **[3]** — asserted in the test suite, because an off-by-one there fails
silently.

Policies: a student writes and reads only where the owner segment is their own id (or a
team they belong to) **and** the assignment is currently accepting work — so a missed
deadline stops the bytes, not merely the row. Faculty who teach the offering read all of
it. Nothing crosses an institution. No client holds UPDATE or DELETE: nothing is removed
on resubmit.

Caps are enforced in three places because each catches what the others cannot: the browser
(fast feedback, bypassable), the bucket's `file_size_limit` (the only thing that sees
actual bytes — 50 MB per file), and `submit_attempt()` (item count and claimed total —
150 MB, 20 items). A 50 MB cap with unlimited files is not a cap.

Uploads go **client-direct** with the student's session so RLS applies and no file passes
through the Next.js server; the server then re-validates that the recorded path matches
the caller and the assignment before writing the row. Both, because the client chooses the
path.

### RLS policy shape (write one set per table)
- Enable RLS on every table.
- **student:** can select their own rows / rows for offerings they're enrolled in;
  can insert submissions/team-joins/attendance-marks/drive-applications as themselves.
- **faculty:** can select/modify rows for offerings they teach (via teaching_assignments).
- **admin / placement_officer:** can select/modify rows within their institution.
- **submission_grades is the tightest policy in the schema** (Revision 2). Faculty who
  teach the offering: full select/insert/update. Student: SELECT ONLY where the parent
  submission is their own (or belongs to their team) AND the parent assignment has
  `grades_released = true`. Students never get INSERT or UPDATE. This policy is what
  makes "grade privately, release together" real rather than cosmetic, so it deserves
  its own explicit tests in `test:rls`, including the ugly path: a graded-but-
  unpublished row must be invisible to the student it belongs to.
- **grade_history is read-only to everyone and invisible to students** (Revision 3).
  Faculty who teach the offering and admins in the institution may SELECT; nobody may
  INSERT, UPDATE or DELETE from a client. See the table above.
- All policies also scope by institution_id. Index every column a policy compares
  (student_id, faculty_id via join, institution_id, offering_id, and for
  submission_grades: submissions.student_id, submissions.team_id,
  assignments.grades_released).
- Recommended: write small SQL helper functions — e.g. `current_institution_id()`,
  `current_role()`, `teaches_offering(offering_id)`, `enrolled_in_offering(offering_id)`
  — marked STABLE, and reference them in policies. Keeps policies readable and consistent.
  Ensure the joins they do are indexed.

### Decisions & gaps captured on review (read these)
- **profiles needs `email`** (mirrors auth.users email; used for display and, later,
  notification fallback). Add it.
- **Attendance threshold is configurable, not hardcoded.** Put `min_attendance_pct int
  default 75` on **institutions** (and optionally override per course later). All the
  "stay above 75%" copy reads from this value — never hardcode 75 in code.
- **One-team-per-set guard.** Enforce in the join action (a server action/route that
  checks the student isn't already in another team of the same team_set before inserting
  into team_members) AND back it with a DB safeguard: a unique index on
  (team_set_id, student_id) via a helper — since team_members is keyed by team_id, add a
  denormalized team_set_id column to team_members and put unique(team_set_id, student_id)
  on it. This makes "one team per set" impossible to violate even if app logic slips.
- **Grade write atomicity (team assignments) — resolved by the model** (Revision 2).
  A team assignment has ONE `submissions` row per team, therefore ONE
  `submission_grades` row per team. There is no fan-out write left to make atomic;
  every member reads the same row. The original concern no longer applies.
- **Late penalty application — DECIDED, 2 August 2026 (Revision 8): SHOW, NEVER APPLY.**
  `late_penalty_pct_per_day` is stored from 1A and nothing computes with it. The
  Submissions table and SpeedGrader STATE the arithmetic next to a late attempt — *"2 days
  late · 10% suggested"* — and the professor types whatever number they mean.
  - **Why not auto-reduce.** Silently altering a professor's mark is exactly the kind of
    thing that costs their trust, and their trust is the product. A number they did not
    type, appearing against a student's name, is the worst version of that.
  - It matches the principle already governing team-set locking in §3.6 — *"show a SOFT
    warning… never hard-block. Professor decides; the app only flags."*
  - A professor waiving the penalty for a student whose laptop died simply types the
    number. There is no override UI to design, no audit question about who overrode what,
    and no second code path.
  - **Rounding: any part of a day counts as a day.** One hour late on a 5%/day assignment
    suggests 5%. Rounding down would make the entire first day free, which is the opposite
    of what a deadline is for. The ELAPSED time is shown alongside the suggestion — *"1
    hour late · 5% suggested"* — precisely because that rounding is harsh at the edges, and
    the professor should be able to see the harshness and judge it. The two deliberately
    disagree: 49 hours reads "2 days" and charges three.
  - The suggestion is capped at 100%. A deduction above that is not a deduction, it is a
    fine. See `src/lib/submissions/penalty.ts`.
- **Publish-grades atomicity.** "Publish all grades" flips assignment.grades_released =
  true in one write; individual post-publish corrections just update that submission's
  grade (visible immediately because grades_released is already true).
- **Admin bootstrapping.** The very first admin + institution are created out-of-band
  (seed script / Supabase dashboard) for the pilot, not via a public signup. There is no
  self-serve institution creation in v1. New users (students/faculty) are created by the
  admin; they receive login credentials. (How invites/credentials are delivered can be
  simple in v1 — even admin-set passwords or magic links.)
- **Storage buckets.** Use separate Supabase Storage buckets with their own access rules
  for: assignment prof-attachments, student submissions, course materials, resumes.
  Submissions bucket especially must be locked down by RLS-equivalent storage policies
  (a student reads only their own submitted files; the professor of the offering reads all).
- **Late flag** on a submission is computed at submit time (submitted_at > due_at), not
  trusted from the client.
- **Eligibility for a drive** is computed on read from student_academics (cgpa, backlogs,
  batch_year) vs the drive's criteria + drive_departments — not stored per student.

---

## 5. Build order (vertical slice first, then expand)

**Milestone 0 — skeleton.** Next.js + TS + Tailwind + shadcn scaffold. Supabase project.
Load schema. `@supabase/ssr` browser+server clients. Auth + login. Middleware route
guard. Role-based redirect (student→mobile home, faculty→prof home, admin→admin).
Deploy to Vercel. Two test users (a student, a professor) can log in and land on the
right home. Nothing else. Commit.

**Milestone 1 — the end-to-end assignment slice** (proves the whole system). Split
into FOUR sessions, one feature each, per BUILD_RULES.md rule 4 (Revision 2 — as originally
written this was four features in one session, which is not bisectable when it breaks):

- **1A — the assignment exists.** One migration carrying ALL schema change for this
  milestone: the three new `assignments` columns, the `submission_grades` table with
  its policies and indexes. Re-run `0003_grants.sql` once afterwards. Extend the seed
  to a real teaching context (course, offering, professor assigned, ~13 students
  enrolled). Professor creates and edits an assignment; student sees it in the course
  with the correct derived state. No submissions yet.
- **1B — the student submits.** Storage bucket + storage policies, submission and
  attempts, the persistent ✓, the assignment appearing in and disappearing from To-Do.
- **1C — the professor grades.** Submissions table, SpeedGrader, grade written to
  `submission_grades` and held unpublished. Settle the late-penalty question first.
- **1D — publish.** "Publish all grades" flips `grades_released`; the student Grades
  screen shows their own mark plus class average and median computed over the
  published set ONLY.

All schema change lands in 1A deliberately: it means one grants re-run instead of
several, and it means the `submission_grades` policy is written and tested by
`test:rls` before a single real grade exists. This loop exercises auth, roles, RLS,
storage, and the core cycle. Get it solid.

**Then expand, one feature per session, reusing the proven pattern:**
- Announcements (prof post → student stream + notifications)
- Files (prof upload/link → student files)
- Course info (prof edit → student Info)
- Attendance (prof session + code + manual override → student % + projection)
- Timetable (admin set → student Calendar → feeds attendance projection)
- Teams / team sets (prof manage → student join/leave → team-graded assignments)
- Placements (drives → eligibility → apply/track)
- Admin surfaces fully (departments, courses, offerings, people, enrolment, bulk import)
- Polish: persistent ✓, dual deadline display, copy-to-clipboard, SpeedGrader
  keyboard shortcuts + autosave, PWA + push notifications, Sentry, backups.

**Quality gate before calling anything done:** RLS verified (a student truly cannot read
another student's data via the API), input validated with zod, empty/error states
handled, and the feature tested on the ugly paths — not just the happy path.

---

## 6. Notes for the pilot (why the build serves the plan)
The pilot is one CSE department at Mahindra. The metric that matters is week-12
retention (are students and professors still using it without being nagged), not
signups. So prioritize: reliability during submission/exam weeks, speed of the daily
loops (grading, attendance, checking what's due), and never losing a student's
submission or a professor's grades. Those are the trust-makers. Everything else is secondary.
