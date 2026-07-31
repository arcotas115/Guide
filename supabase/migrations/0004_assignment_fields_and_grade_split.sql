-- ============================================================================
-- Campus — 0004_assignment_fields_and_grade_split.sql
--
-- ALL schema change for Milestone 1 lands here, in one migration. Two reasons,
-- both from SPEC.md §5: one 0003 grants re-run instead of four, and the
-- submission_grades policy gets written and tested before a single real grade
-- exists to leak.
--
-- Three parts:
--   1. assignments — the create-form fields the prototype had and the spec did
--      not, plus the constraints the late window was always supposed to carry.
--   2. submissions — drop the four grade columns.
--   3. submission_grades — the new table, its policies, its indexes.
--
-- NOTE ON PART 1: `late_until` already exists. It was added in
-- 0001_init_schema.sql, before SPEC.md Revision 2 made it official, so only two
-- of the three columns named in the Milestone 1A brief are actually new here.
-- The constraints on it, however, were never written, and are added below.
-- ============================================================================


-- ============================================================================
-- 1. ASSIGNMENTS — new columns and the late-window constraints
-- ============================================================================

alter table public.assignments
  -- Percent deducted per day late. 0 means no deduction, and 0 is a VALUE, not
  -- a missing concept -- it is what the student-facing "no penalty" copy reads.
  -- Nothing computes with this until SpeedGrader (1C); whether it is applied to
  -- a saved grade or merely shown as a suggestion is still open (SPEC.md
  -- Decisions). Stored now because the table is empty now.
  add column if not exists late_penalty_pct_per_day numeric(5, 2) not null default 0,

  -- Anonymous grading. Display-only, always: it changes what SpeedGrader shows
  -- the professor (roll numbers instead of names) and never what is stored.
  add column if not exists hide_names_while_grading boolean not null default false;

alter table public.assignments
  drop constraint if exists assignments_late_penalty_range,
  add constraint assignments_late_penalty_range
    check (late_penalty_pct_per_day between 0 and 100);

-- A late window that ends before the deadline is not a window.
alter table public.assignments
  drop constraint if exists assignments_late_until_after_due,
  add constraint assignments_late_until_after_due
    check (late_until is null or late_until > due_at);

-- ...and a late window on an assignment that does not accept late work is a
-- contradiction the UI must never be able to store. `allow_late = true` with a
-- null late_until still means "accepted until the assignment is closed".
alter table public.assignments
  drop constraint if exists assignments_late_until_requires_allow_late,
  add constraint assignments_late_until_requires_allow_late
    check (late_until is null or allow_late);

-- The student's assignment list is "everything in this offering that is not a
-- draft, soonest first" -- which is exactly this index.
create index if not exists assignments_offering_status_idx
  on public.assignments (offering_id, status, due_at);


-- ============================================================================
-- 2. SUBMISSIONS — the grade moves out
--
-- Guarded rather than asserted. If a submission exists, this migration refuses
-- to run instead of silently destroying academic data. The brief said "confirm
-- that before running it"; a check the database performs is worth more than a
-- human remembering to look.
-- ============================================================================

do $$
declare n bigint;
begin
  select count(*) into n from public.submissions;
  if n > 0 then
    raise exception
      'REFUSING TO DROP GRADE COLUMNS: public.submissions has % row(s). '
      'This migration assumes an empty table. Migrate the existing grades into '
      'submission_grades first, then remove this guard.', n;
  end if;
end $$;

alter table public.submissions
  drop column if exists grade,
  drop column if exists feedback,
  drop column if exists graded_by,
  drop column if exists graded_at;

-- SPEC.md §4 asks for index(student_id), index(team_id) on submissions.
-- student_id had one from 0001; team_id only had a partial UNIQUE on
-- (assignment_id, team_id), which cannot serve a lookup keyed on team_id alone
-- -- the one the grade policy's team branch performs.
create index if not exists submissions_team_idx
  on public.submissions (team_id) where team_id is not null;


-- ============================================================================
-- 3. SUBMISSION_GRADES
--
-- WHY THIS IS ITS OWN TABLE. Do not fold it back into submissions.
--
-- RLS is ROW-level. It can hide a row; it cannot hide a COLUMN on a row the
-- user is entitled to read. And the student must be able to read their own
-- submissions row from the moment they submit -- that row is what drives the
-- persistent ✓ and the "submitted [time] · awaiting grade" line.
--
-- So if the grade sat on that row, it would be readable over the API the
-- instant the professor saved it, no matter what the UI chose to render. Any
-- student who opened the network tab would see their mark early, and the class
-- would find out one at a time. That breaks both promises in SPEC.md §3.8:
-- that a professor may grade over days and adjust before anyone sees, and that
-- all students find out together.
--
-- Splitting the grade onto its own row turns visibility into a pure row-level
-- question -- which is the exact question RLS answers well.
-- ============================================================================

create table if not exists public.submission_grades (
  submission_id   uuid primary key,
  institution_id  uuid          not null references public.institutions (id) on delete cascade,
  grade           numeric(6, 2) not null check (grade >= 0),
  feedback        text,
  graded_by       uuid,
  graded_at       timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),

  -- No `unique (id, institution_id)` here, unlike every other table: that
  -- redundant key exists purely so CHILD tables can declare a composite FK,
  -- and nothing hangs off a grade. The composite FK below still does the real
  -- work -- it makes a grade pointing at another institution's submission
  -- unrepresentable.
  foreign key (submission_id, institution_id)
    references public.submissions (id, institution_id) on delete cascade,
  -- RESTRICT, not SET NULL: a composite SET NULL would try to null
  -- institution_id, which is NOT NULL. It is also the right policy for an
  -- academic record -- you deactivate a professor, you do not erase who graded.
  foreign key (graded_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);

create index if not exists submission_grades_institution_idx
  on public.submission_grades (institution_id);
create index if not exists submission_grades_graded_by_idx
  on public.submission_grades (graded_by);

drop trigger if exists submission_grades_touch on public.submission_grades;
create trigger submission_grades_touch
  before update on public.submission_grades
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- 3a. Helpers
--
-- SECURITY DEFINER for the same reason as every helper in 0002, plus one that
-- is specific to this table: a policy expression that reads `submissions`
-- would have SUBMISSIONS' OWN RLS applied to it. The grade's visibility would
-- then silently depend on the submission policy, so a future edit to that
-- unrelated policy could quietly widen who sees unpublished marks. Reading
-- through a definer function makes this policy say what it means, on its own.
-- search_path is pinned on both, as always -- a SECURITY DEFINER function with
-- a mutable search_path is a privilege-escalation vector.
-- ----------------------------------------------------------------------------

-- The student read path. Two conditions, and BOTH must hold:
--   1. the submission is theirs (or their team's), and
--   2. the parent assignment has grades_released = true.
-- Condition 2 is the entire feature. Without it a professor's working draft of
-- a mark is API-readable the moment it is saved.
create or replace function public.can_read_grade(p_submission_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.submissions s
    join public.assignments a
      on a.id = s.assignment_id
    where s.id = p_submission_id
      and a.grades_released
      and (
        s.student_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = s.team_id
            and tm.student_id = auth.uid()
        )
      )
  )
$$;

-- The faculty write path: whoever teaches the offering the submission belongs
-- to. Admins are included for the same reason they are everywhere else --
-- somebody has to be able to fix a grade when a professor has left.
create or replace function public.can_grade_submission(p_submission_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.submissions s
    join public.assignments a
      on a.id = s.assignment_id
    where s.id = p_submission_id
      and (
        public.teaches_offering(a.offering_id)
        or (public.same_institution(a.institution_id) and public.is_admin())
      )
  )
$$;


-- ----------------------------------------------------------------------------
-- 3b. Policies
--
-- Default-deny: RLS is enabled and only what is written below is permitted.
-- Note the shape -- the student gets a SELECT-only policy and no other. There
-- is deliberately no student INSERT or UPDATE policy, so a student cannot
-- author or amend a mark even for themselves.
-- ----------------------------------------------------------------------------

alter table public.submission_grades enable row level security;

drop policy if exists submission_grades_student_read on public.submission_grades;
drop policy if exists submission_grades_teacher_all on public.submission_grades;

create policy submission_grades_student_read on public.submission_grades
  for select to authenticated
  using (public.can_read_grade(submission_id));

create policy submission_grades_teacher_all on public.submission_grades
  for all to authenticated
  using (public.can_grade_submission(submission_id))
  with check (
    public.can_grade_submission(submission_id)
    and public.same_institution(institution_id)
  );


-- ----------------------------------------------------------------------------
-- 3c. Indexes the policies join through
--
-- Both helpers walk submission_grades -> submissions -> assignments. The first
-- two hops are primary-key lookups and need nothing extra. The third condition
-- is `a.grades_released`, which is a filter on an already-located row, not a
-- join key -- so a standalone index on that boolean would never be chosen by
-- the planner. What IS worth indexing is the question 1D will actually ask of
-- it: "which assignments in this offering have had grades released?"
-- ----------------------------------------------------------------------------

create index if not exists assignments_released_idx
  on public.assignments (offering_id) where grades_released;

-- The team branch of can_read_grade: "is this student in that team?"
create index if not exists team_members_student_idx
  on public.team_members (student_id);


-- ----------------------------------------------------------------------------
-- 3d. Grants
--
-- 0003 grants ON ALL TABLES, which is a snapshot taken when it runs -- so this
-- brand-new table has no grants at all until it is re-run, and the symptom is
-- a 42501 that looks nothing like its cause. Granted inline here so the
-- migration is self-sufficient; re-running 0003 afterwards is still correct
-- and remains the documented habit.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on public.submission_grades
  to authenticated, service_role;
revoke all on public.submission_grades from anon;
