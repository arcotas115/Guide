# SPEC.md — Campus: full product specification

This is the authoritative spec for the Campus app. Read it before building.
Companion: `CLAUDE.md` (operating rules and stack). Where this spec and code
disagree, this spec wins — update it if requirements change.

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
  status. Create/edit assignment (see 3.7). Extending a deadline auto-posts an announcement.
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
  If allow_late, shows "accepted till [date]" (derived from due_at + the allowed window).
(Draft assignments are not visible to students at all.)

Assignment properties (set by professor on create):
- title, instructions, attached files, marks, open date, due date.
- **late submission allowed?** — a per-assignment toggle (drives the "accepted till" state).
- **submission types accepted** — any combination of file(s) (any type) / link / text.
  Default: all allowed. (v1: open by default.)
- **is team assignment?** — if yes, pick which **team set** it grades against.
- Multiple attempts allowed; the newest submission is the graded one.

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
- Grade states (derived): Not graded (no graded_at) → **Graded (unpublished)** (graded_at
  set, grades_released=false) → **Published** (grades_released=true).
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
designed to be shardable by tenant. Enforce ALL of these (see CLAUDE.md load-bearing
rules): every table has `institution_id NOT NULL`; all PKs are UUIDs; no foreign key
crosses an institution boundary; every query is tenant-scoped (zero cross-tenant queries
ever); institution-specific rules are config-as-data (not hardcoded); index every
tenant-scoping column. The app speaks standard SQL so the DB can move to dedicated/sharded
Postgres at scale without an app rewrite. Do NOT build sharding/infra now — build the
shardability now, the shards later.

Every domain table has `institution_id uuid not null references institutions(id)` and
RLS enabled with policies keyed off the requesting user's profile. Timestamps
(`created_at timestamptz not null default now()`) on everything. IDs are uuid default
`gen_random_uuid()` unless noted.

### Tenancy & people
- **institutions**(id, name, slug unique, min_attendance_pct int default 75)
- **departments**(id, institution_id, name, code) — unique(institution_id, code)
- **profiles**(id = auth.users.id, institution_id, department_id?, role
  check in ('student','faculty','admin','placement_officer'), full_name, email,
  roll_number?, batch_year?) — unique(institution_id, roll_number)
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
  accept_file boolean default true, accept_link boolean default true,
  accept_text boolean default true, is_team boolean default false,
  team_set_id? → team_sets, created_at)
  — TWO DISTINCT publish concepts, do not conflate:
    • `status` check in ('draft','open','closed') default 'draft' — the assignment's
      own lifecycle. Draft = students can't see it yet; Open = students can submit;
      Closed = past due / no longer accepting. (Late-accepted window is derived from
      due_at + allow_late, not a separate status.)
    • `grades_released` boolean default false + `grades_released_at` timestamptz? —
      whether the GRADES for this assignment have been published to students (the
      "Publish all grades" action). Independent of `status`.
  index(offering_id, due_at)
- **assignment_files**(id, assignment_id, storage_path, file_name) — prof-attached files.
- **submissions** — DECIDED model (do not offer alternatives): exactly ONE submission
  row per student per assignment (or per team per assignment for team assignments).
  Resubmissions add a new attempt to `submission_files` and bump the submission's
  `latest_attempt`; the grade lives on this single row.
  (id, assignment_id, student_id?, team_id?, submitted_at, is_late boolean default false,
   latest_attempt int default 1, grade numeric(6,2)?, feedback text?, graded_by?,
   graded_at?)
  — individual: unique(assignment_id, student_id); team: unique(assignment_id, team_id).
    Exactly one of student_id / team_id is set (team_id iff the assignment is_team).
  — NO per-submission publish flag. Whether a grade is visible to students is governed by
    the assignment's `grades_released` (see assignments). A grade with graded_at set but
    grades_released=false is "graded (unpublished)". index(student_id)
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

### RLS policy shape (write one set per table)
- Enable RLS on every table.
- **student:** can select their own rows / rows for offerings they're enrolled in;
  can insert submissions/team-joins/attendance-marks/drive-applications as themselves.
- **faculty:** can select/modify rows for offerings they teach (via teaching_assignments).
- **admin / placement_officer:** can select/modify rows within their institution.
- All policies also scope by institution_id. Index every column a policy compares
  (student_id, faculty_id via join, institution_id, offering_id).
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
- **Grade write atomicity (team assignments).** Writing one grade to all team members
  must be atomic — do it in a single transaction / RPC so all members get it or none do.
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

**Milestone 1 — the end-to-end assignment slice** (proves the whole system):
1. Admin (or seed data): institution, a term, a department, a course + offering, one
   professor assigned, a few students enrolled.
2. Professor: create an assignment in that offering.
3. Student: see it in the course + To-Do, submit a file.
4. Professor: see submissions, grade in SpeedGrader (unpublished), Publish all.
5. Student: see the published grade + class average.
This single loop exercises auth, roles, RLS, storage, and the core cycle. Get it solid.

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
