-- ============================================================================
-- Campus — 0001_init_schema.sql
-- Full schema per SPEC.md Part 4.
--
-- SCALE DISCIPLINE (BUILD_RULES.md rules 1-9). Every choice below exists to
-- keep this database shardable by tenant later, without an app rewrite:
--   * every table carries institution_id NOT NULL  (rule 1)
--   * every primary key is a UUID                  (rule 2)
--   * NO foreign key crosses an institution        (rule 4) -- see note below
--   * every tenant-scoping / policy column indexed (rule 9)
--
-- HOW RULE 4 IS *ENFORCED*, not merely intended:
--   Each parent table declares  UNIQUE (id, institution_id)  -- redundant on its
--   own, since id is already unique -- purely so children can declare a
--   COMPOSITE foreign key:
--       FOREIGN KEY (course_id, institution_id)
--         REFERENCES courses (id, institution_id)
--   The child's own institution_id is therefore part of the reference. Pointing
--   a row at a parent in another institution is not "discouraged" -- it is
--   rejected by Postgres. This is the same belt-and-braces reasoning SPEC.md
--   applies to team_members (one-team-per-set enforced by a DB constraint, not
--   just app logic).
--
-- RLS is enabled and policies are defined in 0002_rls_policies.sql. Until that
-- file runs, every table here is default-deny to the anon/authenticated roles.
-- ============================================================================

-- gen_random_uuid() is core Postgres since 13 (Supabase runs 15+), so no
-- extension is required here.


-- ============================================================================
-- 1. TENANCY & PEOPLE
-- ============================================================================

create table public.institutions (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  slug                text        not null unique,
  -- Config-as-data (rule 7): the attendance threshold is a row, never a
  -- constant in code. Institution #847 with an 80% rule is an UPDATE.
  min_attendance_pct  int         not null default 75
                        check (min_attendance_pct between 0 and 100),
  created_at          timestamptz not null default now()
);

-- institutions is the tenant root, so it needs no composite key of its own:
-- a child's  institution_id -> institutions(id)  reference cannot cross a
-- tenant boundary, because that column *defines* the boundary.


create table public.departments (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  name            text        not null,
  code            text        not null,
  created_at      timestamptz not null default now(),
  unique (institution_id, code),
  unique (id, institution_id)
);
create index departments_institution_idx on public.departments (institution_id);


-- profiles.id === auth.users.id. Supabase Auth owns identity; this table owns
-- everything the app knows about the person.
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  department_id   uuid,
  role            text        not null
                    check (role in ('student', 'faculty', 'admin', 'placement_officer')),
  full_name       text        not null,
  email           text        not null,
  roll_number     text,
  batch_year      int,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  -- RESTRICT, not SET NULL: a composite FK's SET NULL would try to null
  -- institution_id too (which is NOT NULL) and fail at delete time. Blocking
  -- the delete is also the right behaviour -- reassign people, then remove the
  -- department.
  foreign key (department_id, institution_id)
    references public.departments (id, institution_id) on delete restrict
);
-- Roll numbers are unique per institution, but only for those who have one
-- (faculty and admins do not) -- hence a partial index, not a table constraint.
create unique index profiles_institution_roll_uniq
  on public.profiles (institution_id, roll_number)
  where roll_number is not null;
create index profiles_institution_idx on public.profiles (institution_id);
create index profiles_institution_role_idx on public.profiles (institution_id, role);
create index profiles_department_idx on public.profiles (department_id);


create table public.student_academics (
  student_id      uuid primary key,
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  cgpa            numeric(4, 2) check (cgpa >= 0 and cgpa <= 10),
  backlogs        int         not null default 0 check (backlogs >= 0),
  batch_year      int,
  resume_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, institution_id),
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index student_academics_institution_idx on public.student_academics (institution_id);


-- ============================================================================
-- 2. COURSES & OFFERINGS
--    A course is a catalog entry. An OFFERING is that course running in one
--    term + section, and is what everything else hangs off (SPEC.md Part 2).
-- ============================================================================

create table public.terms (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  name            text        not null,
  starts_on       date        not null,
  ends_on         date        not null,
  created_at      timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (institution_id, name),
  unique (id, institution_id)
);
create index terms_institution_idx on public.terms (institution_id);


create table public.courses (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  department_id   uuid,
  code            text        not null,
  title           text        not null,
  credits         int         not null default 3 check (credits >= 0),
  -- The course identity colour that carries across card, calendar block,
  -- to-do row, grades and the tinted subsection headers.
  color           text        not null default '#4C5BD4'
                    check (color ~* '^#[0-9a-f]{6}$'),
  created_at      timestamptz not null default now(),
  unique (institution_id, code),
  unique (id, institution_id),
  foreign key (department_id, institution_id)
    references public.departments (id, institution_id) on delete restrict
);
create index courses_institution_idx on public.courses (institution_id);
create index courses_department_idx on public.courses (department_id);


create table public.course_offerings (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  course_id       uuid        not null,
  term_id         uuid        not null,
  section         text        not null default 'A',
  created_at      timestamptz not null default now(),
  unique (course_id, term_id, section),
  unique (id, institution_id),
  foreign key (course_id, institution_id)
    references public.courses (id, institution_id) on delete cascade,
  foreign key (term_id, institution_id)
    references public.terms (id, institution_id) on delete cascade
);
create index course_offerings_institution_idx on public.course_offerings (institution_id);
create index course_offerings_term_idx on public.course_offerings (term_id);
create index course_offerings_course_idx on public.course_offerings (course_id);


create table public.teaching_assignments (
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  faculty_id      uuid        not null,
  created_at      timestamptz not null default now(),
  primary key (offering_id, faculty_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (faculty_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
-- faculty_id first: "which offerings do I teach?" is the hot path (every RLS
-- check for a professor runs it). The PK already covers offering_id.
create index teaching_assignments_faculty_idx on public.teaching_assignments (faculty_id);
create index teaching_assignments_institution_idx on public.teaching_assignments (institution_id);


create table public.enrolments (
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  student_id      uuid        not null,
  enrolled_at     timestamptz not null default now(),
  primary key (offering_id, student_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index enrolments_student_idx on public.enrolments (student_id);
create index enrolments_institution_idx on public.enrolments (institution_id);


-- ============================================================================
-- 3. TIMETABLE  (feeds student Calendar AND the attendance projection)
-- ============================================================================

create table public.timetable_slots (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  day_of_week     int         not null check (day_of_week between 1 and 6), -- 1=Mon .. 6=Sat
  starts_at       time        not null,
  ends_at         time        not null,
  room            text,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade
);
create index timetable_slots_offering_idx on public.timetable_slots (offering_id);
create index timetable_slots_institution_day_idx on public.timetable_slots (institution_id, day_of_week);


-- ============================================================================
-- 4. COURSE CONTENT
-- ============================================================================

create table public.course_info (
  offering_id     uuid primary key,
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  description     text,
  office_hours    text,
  meeting_days    text,
  room            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (offering_id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade
);
create index course_info_institution_idx on public.course_info (institution_id);


-- Weights must sum to 100. That is a cross-row invariant, so it is checked in
-- the professor's save action (one transaction), not by a table constraint.
create table public.mark_split_items (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  label           text        not null,
  weight_pct      int         not null check (weight_pct between 0 and 100),
  position        int         not null default 0,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade
);
create index mark_split_items_offering_idx on public.mark_split_items (offering_id);
create index mark_split_items_institution_idx on public.mark_split_items (institution_id);


create table public.materials (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  uploaded_by     uuid        not null,
  title           text        not null,
  kind            text        not null check (kind in ('file', 'link')),
  storage_path    text,
  url             text,
  file_name       text,
  size_bytes      bigint,
  created_at      timestamptz not null default now(),
  -- a file needs a storage_path; a link needs a url. Enforced, not assumed.
  check (
    (kind = 'file' and storage_path is not null and url is null) or
    (kind = 'link' and url is not null and storage_path is null)
  ),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (uploaded_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);
create index materials_offering_idx on public.materials (offering_id, created_at desc);
create index materials_institution_idx on public.materials (institution_id);


create table public.announcements (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  author_id       uuid        not null,
  title           text        not null,
  body            text        not null,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (author_id, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);
create index announcements_offering_idx on public.announcements (offering_id, created_at desc);
create index announcements_institution_idx on public.announcements (institution_id);


create table public.announcement_reads (
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  announcement_id uuid        not null,
  student_id      uuid        not null,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, student_id),
  foreign key (announcement_id, institution_id)
    references public.announcements (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index announcement_reads_student_idx on public.announcement_reads (student_id);
create index announcement_reads_institution_idx on public.announcement_reads (institution_id);


-- ============================================================================
-- 5. TEAMS  (multiple independent team sets per offering)
--    Declared before assignments: a team assignment points at a team set.
-- ============================================================================

create table public.team_sets (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  name            text        not null,
  min_size        int         not null default 1 check (min_size >= 1),
  max_size        int         not null default 5 check (max_size >= 1),
  is_visible      boolean     not null default true,
  locked          boolean     not null default false,
  created_at      timestamptz not null default now(),
  check (max_size >= min_size),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade
);
create index team_sets_offering_idx on public.team_sets (offering_id);
create index team_sets_institution_idx on public.team_sets (institution_id);


create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  team_set_id     uuid        not null,
  name            text        not null,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (team_set_id, institution_id)
    references public.team_sets (id, institution_id) on delete cascade
);
create index teams_team_set_idx on public.teams (team_set_id);
create index teams_institution_idx on public.teams (institution_id);


create table public.team_members (
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  team_id         uuid        not null,
  -- Denormalised from teams purely so the constraint below can exist.
  team_set_id     uuid        not null,
  student_id      uuid        not null,
  joined_at       timestamptz not null default now(),
  primary key (team_id, student_id),
  -- SPEC.md: makes "one team per set" impossible to violate even if app logic
  -- slips. This is the whole reason team_set_id is duplicated onto this row.
  unique (team_set_id, student_id),
  foreign key (team_id, institution_id)
    references public.teams (id, institution_id) on delete cascade,
  foreign key (team_set_id, institution_id)
    references public.team_sets (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index team_members_student_idx on public.team_members (student_id);
create index team_members_institution_idx on public.team_members (institution_id);


-- ============================================================================
-- 6. ASSIGNMENTS & SUBMISSIONS
-- ============================================================================

create table public.assignments (
  id                  uuid primary key default gen_random_uuid(),
  institution_id      uuid        not null references public.institutions (id) on delete cascade,
  offering_id         uuid        not null,
  created_by          uuid        not null,
  title               text        not null,
  instructions        text,
  marks               numeric(6, 2) not null default 0 check (marks >= 0),
  opens_at            timestamptz,
  due_at              timestamptz not null,
  allow_late          boolean     not null default true,
  late_until          timestamptz,
  accept_file         boolean     not null default true,
  accept_link         boolean     not null default true,
  accept_text         boolean     not null default true,
  is_team             boolean     not null default false,
  team_set_id         uuid,

  -- TWO DISTINCT PUBLISH CONCEPTS. Do not conflate (SPEC.md is emphatic):
  --  (a) status         -- the ASSIGNMENT's own lifecycle.
  --                        draft  = students cannot see it at all
  --                        open   = students can submit
  --                        closed = no longer accepting
  --                      The "accepted till" late window is DERIVED from
  --                      due_at + allow_late/late_until -- never a status.
  status              text        not null default 'draft'
                        check (status in ('draft', 'open', 'closed')),
  --  (b) grades_released -- whether the GRADES have been published to students
  --                        ("Publish all grades"). Fully independent of status.
  --                        A grade with graded_at set while this is false is
  --                        "graded (unpublished)" and the student still sees
  --                        "awaiting grade".
  grades_released     boolean     not null default false,
  grades_released_at  timestamptz,

  created_at          timestamptz not null default now(),

  -- a team assignment must name the team set it grades against; a solo one must not.
  check ((is_team and team_set_id is not null) or (not is_team and team_set_id is null)),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (created_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict,
  foreign key (team_set_id, institution_id)
    references public.team_sets (id, institution_id) on delete restrict
);
create index assignments_offering_due_idx on public.assignments (offering_id, due_at);
create index assignments_institution_idx on public.assignments (institution_id);
create index assignments_team_set_idx on public.assignments (team_set_id);


create table public.assignment_files (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  assignment_id   uuid        not null,
  storage_path    text        not null,
  file_name       text        not null,
  size_bytes      bigint,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (assignment_id, institution_id)
    references public.assignments (id, institution_id) on delete cascade
);
create index assignment_files_assignment_idx on public.assignment_files (assignment_id);
create index assignment_files_institution_idx on public.assignment_files (institution_id);


-- DECIDED MODEL (SPEC.md says do not offer alternatives): exactly ONE row per
-- student per assignment -- or per TEAM per assignment. Resubmissions append to
-- submission_files and bump latest_attempt. The grade lives on this row, and
-- there is deliberately NO per-submission publish flag: visibility is governed
-- by assignments.grades_released.
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  assignment_id   uuid        not null,
  student_id      uuid,
  team_id         uuid,
  submitted_at    timestamptz not null default now(),
  -- computed server-side at submit time (submitted_at > due_at), never trusted
  -- from the client.
  is_late         boolean     not null default false,
  latest_attempt  int         not null default 1 check (latest_attempt >= 1),
  grade           numeric(6, 2) check (grade >= 0),
  feedback        text,
  graded_by       uuid,
  graded_at       timestamptz,
  created_at      timestamptz not null default now(),
  -- exactly one of student_id / team_id. (Which one is correct for a given
  -- assignment is enforced in the submit action against assignments.is_team.)
  check (num_nonnulls(student_id, team_id) = 1),
  -- a grade is only meaningful alongside its grader and timestamp
  check ((grade is null) = (graded_at is null)),
  unique (id, institution_id),
  foreign key (assignment_id, institution_id)
    references public.assignments (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade,
  foreign key (team_id, institution_id)
    references public.teams (id, institution_id) on delete cascade,
  -- RESTRICT for the same reason as profiles.department_id: composite SET NULL
  -- cannot null institution_id. It also encodes the right policy for an
  -- academic record -- you deactivate a professor, you do not erase who graded.
  foreign key (graded_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);
-- partial uniques because exactly one of the two columns is populated
create unique index submissions_assignment_student_uniq
  on public.submissions (assignment_id, student_id) where student_id is not null;
create unique index submissions_assignment_team_uniq
  on public.submissions (assignment_id, team_id) where team_id is not null;
create index submissions_student_idx on public.submissions (student_id);
create index submissions_assignment_idx on public.submissions (assignment_id);
create index submissions_institution_idx on public.submissions (institution_id);


create table public.submission_files (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  submission_id   uuid        not null,
  attempt         int         not null default 1 check (attempt >= 1),
  kind            text        not null check (kind in ('file', 'link', 'text')),
  storage_path    text,
  url             text,
  text_body       text,
  file_name       text,
  uploaded_at     timestamptz not null default now(),
  check (
    (kind = 'file' and storage_path is not null) or
    (kind = 'link' and url is not null) or
    (kind = 'text' and text_body is not null)
  ),
  unique (id, institution_id),
  foreign key (submission_id, institution_id)
    references public.submissions (id, institution_id) on delete cascade
);
create index submission_files_submission_idx on public.submission_files (submission_id, attempt);
create index submission_files_institution_idx on public.submission_files (institution_id);


-- ============================================================================
-- 7. ATTENDANCE
-- ============================================================================

create table public.attendance_sessions (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  offering_id     uuid        not null,
  held_on         date        not null,
  taken_by        uuid        not null,
  status          text        not null default 'open' check (status in ('open', 'closed')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  -- The live 6-digit code is NOT stored -- it rotates every ~60s. Only this
  -- seed is stored; the valid code is derived from (code_seed + the current
  -- 60s window), and validation accepts the current OR immediately-previous
  -- window to forgive clock skew and typing lag. Anti-proxy without a code table.
  code_seed       text        not null,
  created_at      timestamptz not null default now(),
  unique (offering_id, held_on),
  unique (id, institution_id),
  foreign key (offering_id, institution_id)
    references public.course_offerings (id, institution_id) on delete cascade,
  foreign key (taken_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);
create index attendance_sessions_offering_idx on public.attendance_sessions (offering_id, held_on desc);
create index attendance_sessions_institution_idx on public.attendance_sessions (institution_id);


create table public.attendance_records (
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  session_id      uuid        not null,
  student_id      uuid        not null,
  status          text        not null check (status in ('present', 'absent', 'excused')),
  marked_via      text        not null check (marked_via in ('code', 'manual')),
  marked_at       timestamptz not null default now(),
  primary key (session_id, student_id),
  foreign key (session_id, institution_id)
    references public.attendance_sessions (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index attendance_records_student_idx on public.attendance_records (student_id);
create index attendance_records_institution_idx on public.attendance_records (institution_id);


-- ============================================================================
-- 8. PLACEMENTS
-- ============================================================================

create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  name            text        not null,
  website         text,
  created_at      timestamptz not null default now(),
  unique (institution_id, name),
  unique (id, institution_id)
);
create index companies_institution_idx on public.companies (institution_id);


create table public.placement_drives (
  id                  uuid primary key default gen_random_uuid(),
  institution_id      uuid        not null references public.institutions (id) on delete cascade,
  company_id          uuid        not null,
  role_title          text        not null,
  job_description     text,
  ctc_lpa             numeric(6, 2) check (ctc_lpa >= 0),
  location            text,
  min_cgpa            numeric(4, 2) not null default 0 check (min_cgpa >= 0 and min_cgpa <= 10),
  max_backlogs        int         not null default 999 check (max_backlogs >= 0),
  eligible_batch_year int,
  apply_deadline      timestamptz not null,
  apply_url           text,
  status              text        not null default 'open'
                        check (status in ('draft', 'open', 'closed', 'completed')),
  created_by          uuid        not null,
  created_at          timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (company_id, institution_id)
    references public.companies (id, institution_id) on delete cascade,
  foreign key (created_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);
create index placement_drives_institution_idx on public.placement_drives (institution_id, status);
create index placement_drives_company_idx on public.placement_drives (company_id);


create table public.drive_departments (
  institution_id  uuid not null references public.institutions (id) on delete cascade,
  drive_id        uuid not null,
  department_id   uuid not null,
  primary key (drive_id, department_id),
  foreign key (drive_id, institution_id)
    references public.placement_drives (id, institution_id) on delete cascade,
  foreign key (department_id, institution_id)
    references public.departments (id, institution_id) on delete cascade
);
create index drive_departments_department_idx on public.drive_departments (department_id);
create index drive_departments_institution_idx on public.drive_departments (institution_id);


create table public.drive_applications (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  drive_id        uuid        not null,
  student_id      uuid        not null,
  applied_at      timestamptz not null default now(),
  status          text        not null default 'applied'
                    check (status in ('applied', 'shortlisted', 'interview',
                                      'offered', 'accepted', 'rejected', 'withdrawn')),
  created_at      timestamptz not null default now(),
  unique (drive_id, student_id),
  unique (id, institution_id),
  foreign key (drive_id, institution_id)
    references public.placement_drives (id, institution_id) on delete cascade,
  foreign key (student_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
create index drive_applications_student_idx on public.drive_applications (student_id);
create index drive_applications_institution_idx on public.drive_applications (institution_id);


-- ============================================================================
-- 9. NOTIFICATIONS
-- ============================================================================

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid        not null references public.institutions (id) on delete cascade,
  user_id         uuid        not null,
  type            text        not null,          -- v1: 'announcement'
  payload         jsonb       not null default '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (id, institution_id),
  foreign key (user_id, institution_id)
    references public.profiles (id, institution_id) on delete cascade
);
-- the unread badge query: "my notifications, unread first, newest first"
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create index notifications_institution_idx on public.notifications (institution_id);


-- ============================================================================
-- 10. updated_at maintenance
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger student_academics_touch
  before update on public.student_academics
  for each row execute function public.touch_updated_at();

create trigger course_info_touch
  before update on public.course_info
  for each row execute function public.touch_updated_at();
