-- ============================================================================
-- Campus — 0005_foundations.sql
--
-- Three foundations that are cheap now and expensive later:
--   1. institutions.timezone      — the rule-7 fix for the IST constant
--   2. audit columns              — who last changed a row, not just when
--   3. grade_history              — append-only, trigger-written
-- plus the four leftovers from Milestone 1A.
--
-- Every one of these is easier to add while the tables are nearly empty. The
-- point of doing them together is that a column added to a live table across
-- hundreds of institutions is a migration window; today it is a statement.
-- ============================================================================


-- ============================================================================
-- 1. institutions.timezone
--
-- WHY THE CHECK IS A SHAPE TEST AND NOT A CATALOGUE LOOKUP.
--
-- The obvious constraint is `exists (select 1 from pg_timezone_names ...)`. A
-- CHECK cannot contain a subquery, so that has to be wrapped in a function, and
-- that function is where the trouble is:
--
--   * It reads a system catalogue, so it is not IMMUTABLE. A CHECK calling a
--     non-immutable function is accepted by Postgres but is not re-evaluated
--     when the underlying data changes — a tzdata update can silently leave
--     rows that no longer satisfy their own constraint.
--   * COPY validates CHECK constraints, so a restore onto a server with a
--     different tzdata build can fail on data that was valid where it was
--     dumped. Trading a working restore for a typo is a bad trade.
--   * pg_timezone_names is a set-returning scan of the zone database, run per
--     row. It is not free.
--
-- And the deeper reason: Postgres is not the consumer. Every timestamp in this
-- product is rendered by Intl.DateTimeFormat in Node and the browser, against
-- ICU's zone database — a DIFFERENT database from Postgres's. A zone Postgres
-- accepts and ICU does not is still a broken screen. Validating against the
-- thing that actually has to render it is more correct, not merely cheaper.
--
-- So: the database enforces SHAPE (immutable, dump-safe, catches '', 'IST',
-- stray whitespace), and zod enforces EXISTENCE against Intl at the door, which
-- is where a human types it. See isValidTimeZone() in src/lib/timezone.ts.
-- ============================================================================

alter table public.institutions
  add column if not exists timezone text not null default 'Asia/Kolkata';

alter table public.institutions
  drop constraint if exists institutions_timezone_shape,
  add constraint institutions_timezone_shape
    check (
      timezone = 'UTC'
      or timezone ~ '^[A-Za-z][A-Za-z_-]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$'
    );

comment on column public.institutions.timezone is
  'IANA zone name. Every timestamp the app renders resolves through this, never a constant. Existence is validated in the app against Intl; the CHECK here only enforces shape.';


-- ============================================================================
-- 2. AUDIT COLUMNS
--
-- The split is deliberate and it is the whole design:
--
--   updated_at  is maintained by a TRIGGER, so it cannot be forgotten. A
--               timestamp the application is trusted to set is a timestamp that
--               is wrong the first time someone adds a code path.
--
--   updated_by  is set by the APPLICATION, explicitly. The obvious alternative
--               is to read auth.uid() inside the trigger, and it is refused
--               here: that couples every write in the schema to Supabase Auth,
--               and BUILD_RULES rule 6 confines Supabase to swappable edges.
--               A trigger that reads auth.uid() is a trigger that breaks on the
--               day this moves to dedicated Postgres.
-- ============================================================================

alter table public.assignments
  add column if not exists updated_at timestamptz not null default now(),
  -- Composite FK, like every other person-reference in this schema: it is what
  -- makes "no FK crosses an institution boundary" enforced rather than merely
  -- intended. RESTRICT for the same reason as created_by — you deactivate a
  -- professor, you do not erase who edited the assignment.
  add column if not exists updated_by uuid;

alter table public.assignments
  drop constraint if exists assignments_updated_by_fkey,
  add constraint assignments_updated_by_fkey
    foreign key (updated_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict;

create index if not exists assignments_updated_by_idx
  on public.assignments (updated_by);

drop trigger if exists assignments_touch on public.assignments;
create trigger assignments_touch
  before update on public.assignments
  for each row execute function public.touch_updated_at();


alter table public.submission_grades
  add column if not exists updated_by uuid;

alter table public.submission_grades
  drop constraint if exists submission_grades_updated_by_fkey,
  add constraint submission_grades_updated_by_fkey
    foreign key (updated_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict;

create index if not exists submission_grades_updated_by_idx
  on public.submission_grades (updated_by);

comment on column public.submission_grades.graded_by is
  'Who first marked this submission.';
comment on column public.submission_grades.updated_by is
  'Who last changed it. On a post-publish correction this is frequently a different person from graded_by, and that difference is the point.';


-- ============================================================================
-- 3. GRADE_HISTORY — append-only
-- ============================================================================

create table if not exists public.grade_history (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid          not null references public.institutions (id) on delete cascade,
  submission_id   uuid          not null,
  old_grade       numeric(6, 2),          -- null on the first grade
  new_grade       numeric(6, 2) not null,
  old_feedback    text,
  new_feedback    text,
  changed_by      uuid,
  changed_at      timestamptz   not null default now(),

  foreign key (submission_id, institution_id)
    references public.submissions (id, institution_id) on delete cascade,
  foreign key (changed_by, institution_id)
    references public.profiles (id, institution_id) on delete restrict
);

-- ORDERING NOTE for whoever builds the history UI in 1C: changed_at resolves to
-- the millisecond, so two corrections saved in the same millisecond tie. Always
-- order by (changed_at desc, id desc) — the uuid tiebreak is arbitrary but
-- STABLE, which is what stops the same list rendering in two different orders on
-- consecutive loads. A monotonic sequence would be the tidier fix and is
-- deliberately not used: BUILD_RULES rule 2 rules out auto-increment integers
-- because they collide across shards.
create index if not exists grade_history_submission_idx
  on public.grade_history (submission_id, changed_at desc, id desc);
create index if not exists grade_history_institution_idx
  on public.grade_history (institution_id);

-- The `@append-only` token is machine-readable: 0003 reads it from the catalogue
-- to decide which tables must not receive UPDATE/DELETE grants, so the list is
-- never hand-maintained. See 0006 for why a comment rather than a registry.
comment on table public.grade_history is
  '@append-only Written only by the trigger on submission_grades; no role may UPDATE or DELETE. Students may never read it, published or not.';


-- ----------------------------------------------------------------------------
-- 3a. The writer
--
-- A trigger, not the application. An audit log the app is trusted to write is
-- an audit log that stops being written the first time someone adds a code path
-- and forgets — and the code path that forgets is exactly the one worth
-- auditing.
--
-- SECURITY DEFINER so the insert succeeds without granting any client role
-- INSERT on the table. See the policy note in 3b for why that matters.
--
-- changed_by comes from NEW.updated_by, which the application has just set. So
-- the actor is recorded without the database knowing anything about the auth
-- provider — no auth.uid() anywhere in here.
-- ----------------------------------------------------------------------------

create or replace function public.record_grade_history()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- An update that changes neither the mark nor the feedback is not a change,
  -- and a history full of no-op rows is a history nobody reads. Who touched the
  -- row and when is still captured by submission_grades.updated_by/updated_at.
  if tg_op = 'UPDATE'
     and old.grade is not distinct from new.grade
     and old.feedback is not distinct from new.feedback then
    return new;
  end if;

  insert into public.grade_history (
    institution_id, submission_id,
    old_grade, new_grade, old_feedback, new_feedback,
    changed_by
  )
  values (
    new.institution_id,
    new.submission_id,
    case when tg_op = 'UPDATE' then old.grade else null end,
    new.grade,
    case when tg_op = 'UPDATE' then old.feedback else null end,
    new.feedback,
    new.updated_by
  );

  return new;
end;
$$;

drop trigger if exists submission_grades_history on public.submission_grades;
create trigger submission_grades_history
  after insert or update on public.submission_grades
  for each row execute function public.record_grade_history();


-- ----------------------------------------------------------------------------
-- 3b. Policies
--
-- SELECT only, for faculty who teach the offering and for admins in the
-- institution. There is NO update policy and NO delete policy: append-only is
-- enforced by their absence plus the revokes in 0003.
--
-- STUDENTS CANNOT READ THIS AT ALL — not their own rows, and not after
-- grades_released flips. "Your grade was changed from 12 to 18" would undo the
-- whole publish flow in SPEC.md §3.8, which exists so that a professor can
-- revise a mark before anyone sees it. There is deliberately no student policy
-- below, so the default deny is what applies.
--
-- DIVERGENCE FROM THE BRIEF, FLAGGED: the brief asked for an INSERT policy as
-- well. One is not created, because a client-facing INSERT policy would let a
-- professor POST a fabricated history row straight to PostgREST — which is the
-- same hole as letting them edit one, and the brief's own reasoning ("a history
-- a professor can edit is not a history") argues against it. The trigger is
-- SECURITY DEFINER and therefore needs no policy to do its job. If you would
-- rather have the explicit policy, it is one statement; say so.
-- ----------------------------------------------------------------------------

alter table public.grade_history enable row level security;

drop policy if exists grade_history_staff_read on public.grade_history;
create policy grade_history_staff_read on public.grade_history
  for select to authenticated
  using (
    public.can_grade_submission(submission_id)
  );


-- ============================================================================
-- 4. LEFTOVERS FROM 1A
-- ============================================================================

-- The prototype's "Allow more than one attempt" toggle. Column only this
-- session; the behaviour and the UI are 1B's.
alter table public.assignments
  add column if not exists allow_multiple_attempts boolean not null default true;

-- A professor could uncheck Files, A link and Typed text and leave students no
-- way to hand anything in. zod has refused this since 1A-fix; the database
-- should not be the only place it is legal.
alter table public.assignments
  drop constraint if exists assignments_accepts_something,
  add constraint assignments_accepts_something
    check (accept_file or accept_link or accept_text);

-- marks >= 0 -> marks > 0, so the database and zod finally agree. Guarded the
-- way 0004 guarded the column drop: the database checks, rather than a human
-- remembering to look.
do $$
declare n bigint;
begin
  select count(*) into n from public.assignments where marks <= 0;
  if n > 0 then
    raise exception
      'REFUSING TO TIGHTEN assignments_marks_check: % assignment(s) have marks <= 0. '
      'Fix those rows first, then re-run this migration.', n;
  end if;
end $$;

alter table public.assignments
  drop constraint if exists assignments_marks_check,
  add constraint assignments_marks_check check (marks > 0);

-- The old `default 0` can no longer satisfy that constraint, so an insert that
-- omitted marks would fail with a confusing check violation. Dropping the
-- default makes the same mistake fail as what it is: a missing required value.
alter table public.assignments
  alter column marks drop default;


-- ============================================================================
-- 5. GRANTS
--
-- grade_history is new, so 0003's ON ALL TABLES snapshot does not cover it.
-- Granted inline here so this migration is self-sufficient; re-running 0003
-- afterwards is still correct and remains the documented habit.
--
-- NOTE what is NOT granted: no INSERT, UPDATE or DELETE to authenticated. The
-- trigger writes as its definer, and append-only means append-only.
-- ============================================================================

grant select on public.grade_history to authenticated;
grant select, insert on public.grade_history to service_role;
revoke update, delete on public.grade_history from authenticated, service_role;
revoke all on public.grade_history from anon;

notify pgrst, 'reload schema';
