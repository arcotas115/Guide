-- ============================================================================
-- Campus — 0008_soft_delete_cascade.sql
--
-- A soft-deleted parent must hide its children. Today it does not, and the
-- inconsistency is accidental rather than designed.
--
-- WHY IT LEAKS. FORCE ROW LEVEL SECURITY is set nowhere, so the table owner
-- bypasses RLS — and every SECURITY DEFINER helper runs as that owner. So a
-- policy that reaches another table by DIRECT SUBQUERY inherits that table's
-- RLS, and one that reaches it through a HELPER FUNCTION does not. Cascade
-- behaviour was being decided by which of the two a policy happened to use:
--
--   assignment_files, submissions, attendance_records  -> subquery their parent
--                                                         directly, so they
--                                                         already cascade.
--   nine policies                                      -> go through
--                                                         can_read_offering(),
--                                                         which reaches
--                                                         enrolments — a table
--                                                         with no deleted_at.
--                                                         The student is still
--                                                         enrolled, so it still
--                                                         returns true.
--
-- Measured before writing this, not inferred. With the offering soft-deleted, a
-- student could still read all seven of assignments, announcements, team_sets,
-- attendance_sessions, timetable_slots, course_info and mark_split_items. With
-- the COURSE soft-deleted, the offering itself stayed visible too, because
-- course_offerings_read is same_institution() and never looks at courses.
--
-- Nothing is reachable today because nothing can be deleted yet. It goes live
-- the moment a delete button ships, and 1B's To-Do screen is exactly where it
-- would surface — that query spans every offering a student is enrolled in.
--
-- ----------------------------------------------------------------------------
-- THE SHAPE, AND WHY
--
-- One function for the whole chain, plus RESTRICTIVE policies generated from
-- the catalogue. Same pattern as 0007, for the same three reasons:
--
--   * A restrictive policy is ANDed with the permissive ones, so it can only
--     narrow access. It cannot accidentally widen anything.
--   * Nothing existing is edited. The nine policies keep their logic; the
--     cascade is a separate, uniform, auditable rule sitting beside them.
--   * It is driven by "does this table have an offering_id column", so a table
--     added in 1B is covered the moment it exists, rather than when somebody
--     remembers.
--
-- The alternative — teaching can_read_offering() to check deleted_at — was
-- rejected. It is a smaller diff but it fixes only the nine policies that
-- happen to call it, leaves course_offerings itself unfixed, and buries a
-- visibility rule inside a function whose name promises a permission check.
-- ============================================================================


-- ============================================================================
-- 1. The chain, in one place
--
-- An offering is visible only if IT, its COURSE and its TERM are all live.
-- Putting the whole chain in one function means the two-level rule is stated
-- once — a policy cannot implement half of it.
-- ============================================================================

create or replace function public.offering_chain_live(p_offering_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
    join public.terms   t on t.id = o.term_id
    where o.id = p_offering_id
      and o.deleted_at is null
      and c.deleted_at is null
      and t.deleted_at is null
  )
$$;

comment on function public.offering_chain_live(uuid) is
  'True when an offering and both its parents (course, term) are live. The single statement of the term/course -> offering -> content cascade; policies must not re-implement any part of it.';

-- The indexes these lookups run through. offering_chain_live is called once per
-- row scanned by nine policies, so it is worth the three partial indexes.
create index if not exists course_offerings_live_idx
  on public.course_offerings (id) where deleted_at is null;
create index if not exists courses_live_idx
  on public.courses (id) where deleted_at is null;
create index if not exists terms_live_idx
  on public.terms (id) where deleted_at is null;


-- ============================================================================
-- 2. Every table that hangs off an offering
--
-- Generated from the catalogue rather than listed, so the rule cannot go stale.
-- Note this deliberately INCLUDES enrolments and teaching_assignments: if an
-- offering has been deleted, a student has no business seeing their enrolment
-- in it either. Staff keep visibility through is_staff(), and the membership
-- helpers (enrolled_in_offering, teaches_offering) are SECURITY DEFINER, so
-- hiding those rows from a student does not break the permission checks that
-- read them.
-- ============================================================================

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
                       and a.attname = 'offering_id' and a.attnum > 0
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop policy if exists %I on public.%I',
                   t.relname || '_offering_live', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (public.offering_chain_live(offering_id) or public.is_staff()) '
      'with check (public.offering_chain_live(offering_id) or public.is_staff())',
      t.relname || '_offering_live', t.relname);
  end loop;
end $$;


-- ============================================================================
-- 3. course_offerings itself — the level above
--
-- Its own deleted_at is already handled by the _hide_deleted policy from 0007.
-- What was missing is its PARENTS: a soft-deleted course or term left every one
-- of its offerings visible.
-- ============================================================================

drop policy if exists course_offerings_parents_live on public.course_offerings;
create policy course_offerings_parents_live on public.course_offerings
  as restrictive for all to authenticated
  using (public.offering_chain_live(id) or public.is_staff())
  with check (public.offering_chain_live(id) or public.is_staff());


-- ============================================================================
-- 4. teams and team_members — the two that reach an offering indirectly
--
-- Written out rather than generated, because their only link to an offering is
-- team_set_id, and the obvious generalisation ("every table with a team_set_id")
-- would also catch `assignments`, where team_set_id is nullable and null on
-- every solo assignment — which would hide all of them.
--
-- team_sets itself is covered by the loop in section 2; this adds the level
-- below it, including team_sets' own deleted_at, which the loop cannot see from
-- a child row.
-- ============================================================================

drop policy if exists teams_offering_live on public.teams;
create policy teams_offering_live on public.teams
  as restrictive for all to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.team_sets ts
      where ts.id = teams.team_set_id
        and ts.deleted_at is null
        and public.offering_chain_live(ts.offering_id)
    )
  )
  with check (
    public.is_staff()
    or exists (
      select 1 from public.team_sets ts
      where ts.id = teams.team_set_id
        and ts.deleted_at is null
        and public.offering_chain_live(ts.offering_id)
    )
  );

drop policy if exists team_members_offering_live on public.team_members;
create policy team_members_offering_live on public.team_members
  as restrictive for all to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.team_sets ts
      where ts.id = team_members.team_set_id
        and ts.deleted_at is null
        and public.offering_chain_live(ts.offering_id)
    )
  )
  with check (
    public.is_staff()
    or exists (
      select 1 from public.team_sets ts
      where ts.id = team_members.team_set_id
        and ts.deleted_at is null
        and public.offering_chain_live(ts.offering_id)
    )
  );


-- ============================================================================
-- 5. What is NOT here — and the one case that is deliberate rather than free
--
-- INHERITED FOR FREE. assignment_files and submission_files reach their parent
-- through a DIRECT SUBQUERY, and a subquery inherits the subject table's RLS —
-- so once assignments and submissions carry the rules above, these follow. That
-- is asserted in rls.test.mjs rather than trusted, because it depends on those
-- policies being written as subqueries rather than as helper calls, which is
-- exactly the distinction that caused this bug in the first place.
--
-- DELIBERATELY NOT CASCADED: submissions and attendance_records.
--
-- Measured, not assumed: with the offering soft-deleted, a student still sees
-- their own submission and their own attendance marks. The reason is that both
-- policies open with `student_id = auth.uid()` — a branch with no subquery at
-- all, so there is nothing for RLS to be inherited through. The first draft of
-- this file claimed they cascaded; the test proved otherwise.
--
-- They are left visible ON PURPOSE:
--
--   * DELETION_POLICY.md §2 excludes these tables from deleted_at because they
--     are ACADEMIC RECORD — "a student's submitted work is the thing a dispute
--     is about". Cascading the visibility away would achieve indirectly what
--     that decision forbids directly.
--   * It is not a confidentiality leak. A student sees only their OWN rows;
--     nobody gains sight of anyone else's work.
--   * If an admin hides a course by mistake, a student losing sight of their
--     own submitted work and attendance marks is the worse failure of the two.
--     That evidence is the thing they need most when something has gone wrong.
--
-- The orphan this leaves — a submission whose offering is hidden — is a
-- rendering question, and it is also the strongest argument for refusing to
-- soft-delete a parent that still has live children at all. See the cascade
-- section of DELETION_POLICY.md.
-- ============================================================================

notify pgrst, 'reload schema';
