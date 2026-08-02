-- ============================================================================
-- Campus — 0002_rls_policies.sql
--
-- Supabase exposes Postgres directly to the browser via the publishable key.
-- RLS is therefore not defence-in-depth -- it is THE defence (BUILD_RULES.md
-- golden rule 1). Every table is default-deny; a row is reachable only if some
-- policy below explicitly admits it.
--
-- WHY THE HELPERS ARE `security definer`:
--   A policy on profiles that itself queries profiles would recurse forever.
--   Marking the helpers SECURITY DEFINER makes them run as the function owner,
--   bypassing RLS *inside the helper only*. This is the standard Supabase
--   pattern and the reason `set search_path` is pinned on every one of them --
--   a SECURITY DEFINER function with a mutable search_path is a privilege-
--   escalation vector.
--
-- NAMING NOTE: SPEC.md suggests a helper called current_role(). `current_role`
-- is a reserved SQL keyword in Postgres (it returns the session role), so it is
-- named current_user_role() here. Same job, non-colliding name.
-- ============================================================================


-- ============================================================================
-- 1. HELPERS  (all STABLE + SECURITY DEFINER + pinned search_path)
-- ============================================================================

create or replace function public.current_institution_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select institution_id from public.profiles where id = auth.uid() $$;

create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_user_role() = 'admin', false) $$;

-- Placements are admin-run in v1; placement_officer is reserved for later.
create or replace function public.is_placement_staff()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_user_role() in ('admin', 'placement_officer'), false) $$;

create or replace function public.teaches_offering(p_offering_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teaching_assignments ta
    where ta.offering_id = p_offering_id and ta.faculty_id = auth.uid()
  )
$$;

create or replace function public.enrolled_in_offering(p_offering_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.enrolments e
    where e.offering_id = p_offering_id and e.student_id = auth.uid()
  )
$$;

-- "Am I allowed to look inside this offering at all?" -- the predicate almost
-- every content table hangs off.
create or replace function public.can_read_offering(p_offering_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.teaches_offering(p_offering_id)
      or public.enrolled_in_offering(p_offering_id)
      or (public.is_admin() and exists (
            select 1 from public.course_offerings o
            where o.id = p_offering_id
              and o.institution_id = public.current_institution_id()
          ))
$$;

-- Do I share any offering with this person? Gates name visibility, so a
-- student sees classmates and their professors -- and nobody else.
create or replace function public.shares_offering_with(p_other uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from (
      select offering_id from public.enrolments where student_id = auth.uid()
      union
      select offering_id from public.teaching_assignments where faculty_id = auth.uid()
    ) mine
    join (
      select offering_id from public.enrolments where student_id = p_other
      union
      select offering_id from public.teaching_assignments where faculty_id = p_other
    ) theirs using (offering_id)
  )
$$;

-- Same institution as me? The tenant predicate, in one place.
create or replace function public.same_institution(p_institution_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select p_institution_id = public.current_institution_id() $$;


-- ============================================================================
-- 2. ENABLE RLS ON EVERY TABLE
--    Done as a loop so a table added later cannot be silently forgotten --
--    "RLS on EVERY table" should not depend on remembering to type a line.
-- ============================================================================

do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;


-- ============================================================================
-- 3. GRANTS
--    RLS filters rows, but only *after* the role is allowed to touch the table
--    at all. authenticated gets blanket DML (RLS does the real gating);
--    anon gets nothing -- there is no public surface in this product.
-- ============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

revoke all on all tables in schema public from anon;


-- ============================================================================
-- 4. POLICIES
-- ============================================================================

-- ---------- institutions ----------------------------------------------------
create policy institutions_read on public.institutions
  for select to authenticated
  using (id = public.current_institution_id());

create policy institutions_admin_update on public.institutions
  for update to authenticated
  using (id = public.current_institution_id() and public.is_admin())
  with check (id = public.current_institution_id() and public.is_admin());


-- ---------- departments -----------------------------------------------------
create policy departments_read on public.departments
  for select to authenticated
  using (public.same_institution(institution_id));

create policy departments_admin_write on public.departments
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());


-- ---------- profiles --------------------------------------------------------
-- Visibility is deliberately narrow: yourself, people you share a class with,
-- and (for admins) your institution. A student cannot enumerate the college.
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (public.same_institution(institution_id) and public.is_admin())
    or (public.same_institution(institution_id) and public.shares_offering_with(id))
  );

-- NOTE: no self-update policy on purpose. An UPDATE policy that let a user
-- write their own row would let them set role = 'admin', because RLS cannot
-- compare OLD vs NEW. When profile self-editing ships, it goes through a
-- server action plus a column-guard trigger -- not a broad UPDATE policy.
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());


-- ---------- student_academics -----------------------------------------------
create policy student_academics_read on public.student_academics
  for select to authenticated
  using (
    student_id = auth.uid()
    or (public.same_institution(institution_id) and public.is_placement_staff())
  );

create policy student_academics_staff_write on public.student_academics
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_placement_staff())
  with check (public.same_institution(institution_id) and public.is_placement_staff());


-- ---------- terms / courses / course_offerings ------------------------------
-- Catalog data: readable institution-wide, written by admins only.
create policy terms_read on public.terms
  for select to authenticated using (public.same_institution(institution_id));
create policy terms_admin_write on public.terms
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());

create policy courses_read on public.courses
  for select to authenticated using (public.same_institution(institution_id));
create policy courses_admin_write on public.courses
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());

create policy course_offerings_read on public.course_offerings
  for select to authenticated using (public.same_institution(institution_id));
create policy course_offerings_admin_write on public.course_offerings
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());


-- ---------- teaching_assignments / enrolments -------------------------------
create policy teaching_assignments_read on public.teaching_assignments
  for select to authenticated using (public.same_institution(institution_id));
create policy teaching_assignments_admin_write on public.teaching_assignments
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());

-- A student sees their own enrolments; a professor sees the roll of what they
-- teach; an admin sees the institution.
create policy enrolments_read on public.enrolments
  for select to authenticated
  using (
    student_id = auth.uid()
    or public.teaches_offering(offering_id)
    or (public.same_institution(institution_id) and public.is_admin())
  );
create policy enrolments_admin_write on public.enrolments
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());


-- ---------- timetable_slots -------------------------------------------------
create policy timetable_slots_read on public.timetable_slots
  for select to authenticated using (public.can_read_offering(offering_id));
create policy timetable_slots_admin_write on public.timetable_slots
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_admin())
  with check (public.same_institution(institution_id) and public.is_admin());


-- ---------- course_info / mark_split_items ----------------------------------
create policy course_info_read on public.course_info
  for select to authenticated using (public.can_read_offering(offering_id));
create policy course_info_teacher_write on public.course_info
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

create policy mark_split_items_read on public.mark_split_items
  for select to authenticated using (public.can_read_offering(offering_id));
create policy mark_split_items_teacher_write on public.mark_split_items
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));


-- ---------- materials / announcements ---------------------------------------
create policy materials_read on public.materials
  for select to authenticated using (public.can_read_offering(offering_id));
create policy materials_teacher_write on public.materials
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

create policy announcements_read on public.announcements
  for select to authenticated using (public.can_read_offering(offering_id));
create policy announcements_teacher_write on public.announcements
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

-- Read receipts belong to the reader, full stop.
create policy announcement_reads_own on public.announcement_reads
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid() and public.same_institution(institution_id));


-- ---------- teams -----------------------------------------------------------
-- Students only see a set once the professor has made it visible.
create policy team_sets_read on public.team_sets
  for select to authenticated
  using (
    public.can_read_offering(offering_id)
    and (is_visible or public.teaches_offering(offering_id) or public.is_admin())
  );
create policy team_sets_teacher_write on public.team_sets
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

create policy teams_read on public.teams
  for select to authenticated
  using (exists (
    select 1 from public.team_sets ts
    where ts.id = teams.team_set_id and public.can_read_offering(ts.offering_id)
  ));

-- A student may create a team in a set that is open and theirs to join.
-- Creating does NOT join (SPEC.md) -- that is a separate insert into team_members.
create policy teams_student_create on public.teams
  for insert to authenticated
  with check (
    public.same_institution(institution_id)
    and exists (
      select 1 from public.team_sets ts
      where ts.id = team_set_id
        and not ts.locked
        and ts.is_visible
        and public.enrolled_in_offering(ts.offering_id)
    )
  );

create policy teams_teacher_write on public.teams
  for all to authenticated
  using (exists (
    select 1 from public.team_sets ts
    where ts.id = teams.team_set_id
      and (public.teaches_offering(ts.offering_id)
           or (public.same_institution(teams.institution_id) and public.is_admin()))
  ))
  with check (exists (
    select 1 from public.team_sets ts
    where ts.id = teams.team_set_id
      and (public.teaches_offering(ts.offering_id)
           or (public.same_institution(teams.institution_id) and public.is_admin()))
  ));

create policy team_members_read on public.team_members
  for select to authenticated
  using (exists (
    select 1 from public.team_sets ts
    where ts.id = team_members.team_set_id and public.can_read_offering(ts.offering_id)
  ));

-- Join yourself, into an unlocked set, in a course you are enrolled in.
-- ("one team per set" is additionally guaranteed by the unique constraint in 0001.)
create policy team_members_self_join on public.team_members
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.same_institution(institution_id)
    and exists (
      select 1 from public.team_sets ts
      where ts.id = team_set_id
        and not ts.locked
        and ts.is_visible
        and public.enrolled_in_offering(ts.offering_id)
    )
  );

create policy team_members_self_leave on public.team_members
  for delete to authenticated
  using (
    student_id = auth.uid()
    and exists (
      select 1 from public.team_sets ts
      where ts.id = team_members.team_set_id and not ts.locked
    )
  );

create policy team_members_teacher_write on public.team_members
  for all to authenticated
  using (exists (
    select 1 from public.team_sets ts
    where ts.id = team_members.team_set_id
      and (public.teaches_offering(ts.offering_id)
           or (public.same_institution(team_members.institution_id) and public.is_admin()))
  ))
  with check (exists (
    select 1 from public.team_sets ts
    where ts.id = team_members.team_set_id
      and (public.teaches_offering(ts.offering_id)
           or (public.same_institution(team_members.institution_id) and public.is_admin()))
  ));


-- ---------- assignments -----------------------------------------------------
-- Draft assignments are invisible to students (SPEC.md 3.7). This is enforced
-- in the database, not just hidden in the UI.
create policy assignments_read on public.assignments
  for select to authenticated
  using (
    public.teaches_offering(offering_id)
    or (public.same_institution(institution_id) and public.is_admin())
    or (public.enrolled_in_offering(offering_id) and status <> 'draft')
  );

create policy assignments_teacher_write on public.assignments
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

create policy assignment_files_read on public.assignment_files
  for select to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = assignment_files.assignment_id
      and (public.teaches_offering(a.offering_id)
           or (public.enrolled_in_offering(a.offering_id) and a.status <> 'draft')
           or (public.same_institution(a.institution_id) and public.is_admin()))
  ));

create policy assignment_files_teacher_write on public.assignment_files
  for all to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = assignment_files.assignment_id
      and (public.teaches_offering(a.offering_id)
           or (public.same_institution(a.institution_id) and public.is_admin()))
  ))
  with check (exists (
    select 1 from public.assignments a
    where a.id = assignment_files.assignment_id
      and (public.teaches_offering(a.offering_id)
           or (public.same_institution(a.institution_id) and public.is_admin()))
  ));


-- ---------- submissions -----------------------------------------------------
-- RESOLVED IN 0004 — this is safe, and the note below explains why, because a
-- migration file is where someone looks when they want to know.
--
-- The original TODO here was correct when written: RLS filters ROWS, not
-- COLUMNS, so a student reading their own submission row would also have read
-- `grade` and `feedback` on it while assignments.grades_released was still
-- false. It said "do not ship grading without a masking view".
--
-- 0004 solved it a better way than the masking view it proposed: the grade
-- moved OFF this table entirely, onto `submission_grades`. There are no
-- grade/feedback columns on `submissions` any more, so there is nothing to
-- mask. Visibility became a pure ROW-level question -- exactly what RLS answers
-- well -- and submission_grades carries the tightest policy in the schema: a
-- student may read a grade row only when the parent assignment has
-- grades_released = true. Asserted directly in supabase/tests/rls.test.mjs.
--
-- Grading is safe to ship. Do not re-add grade columns to this table.
create policy submissions_read on public.submissions
  for select to authenticated
  using (
    student_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = submissions.team_id and tm.student_id = auth.uid()
    )
    or exists (
      select 1 from public.assignments a
      where a.id = submissions.assignment_id
        and (public.teaches_offering(a.offering_id)
             or (public.same_institution(a.institution_id) and public.is_admin()))
    )
  );

-- Students submit as themselves, only into an open assignment they can see.
create policy submissions_student_insert on public.submissions
  for insert to authenticated
  with check (
    public.same_institution(institution_id)
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_id
        and a.status = 'open'
        and public.enrolled_in_offering(a.offering_id)
    )
    and (
      student_id = auth.uid()
      or exists (
        select 1 from public.team_members tm
        where tm.team_id = submissions.team_id and tm.student_id = auth.uid()
      )
    )
  );

-- Only the professor grades. A student cannot write to their own submission
-- row after the fact -- resubmission appends to submission_files instead.
create policy submissions_teacher_write on public.submissions
  for update to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (public.teaches_offering(a.offering_id)
           or (public.same_institution(a.institution_id) and public.is_admin()))
  ))
  with check (exists (
    select 1 from public.assignments a
    where a.id = submissions.assignment_id
      and (public.teaches_offering(a.offering_id)
           or (public.same_institution(a.institution_id) and public.is_admin()))
  ));

create policy submission_files_read on public.submission_files
  for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = submission_files.submission_id
      and (
        s.student_id = auth.uid()
        or exists (
          select 1 from public.team_members tm
          where tm.team_id = s.team_id and tm.student_id = auth.uid()
        )
        or exists (
          select 1 from public.assignments a
          where a.id = s.assignment_id
            and (public.teaches_offering(a.offering_id)
                 or (public.same_institution(a.institution_id) and public.is_admin()))
        )
      )
  ));

create policy submission_files_student_insert on public.submission_files
  for insert to authenticated
  with check (
    public.same_institution(institution_id)
    and exists (
      select 1 from public.submissions s
      where s.id = submission_id
        and (
          s.student_id = auth.uid()
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = s.team_id and tm.student_id = auth.uid()
          )
        )
    )
  );


-- ---------- attendance ------------------------------------------------------
create policy attendance_sessions_read on public.attendance_sessions
  for select to authenticated using (public.can_read_offering(offering_id));

create policy attendance_sessions_teacher_write on public.attendance_sessions
  for all to authenticated
  using (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()))
  with check (public.teaches_offering(offering_id)
         or (public.same_institution(institution_id) and public.is_admin()));

create policy attendance_records_read on public.attendance_records
  for select to authenticated
  using (
    student_id = auth.uid()
    or exists (
      select 1 from public.attendance_sessions s
      where s.id = attendance_records.session_id
        and (public.teaches_offering(s.offering_id)
             or (public.same_institution(s.institution_id) and public.is_admin()))
    )
  );

-- A student may only ever mark THEMSELF, only 'present', only via 'code', and
-- only while the session is open. Code validity itself is checked server-side.
create policy attendance_records_self_mark on public.attendance_records
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'present'
    and marked_via = 'code'
    and public.same_institution(institution_id)
    and exists (
      select 1 from public.attendance_sessions s
      where s.id = session_id
        and s.status = 'open'
        and public.enrolled_in_offering(s.offering_id)
    )
  );

create policy attendance_records_teacher_write on public.attendance_records
  for all to authenticated
  using (exists (
    select 1 from public.attendance_sessions s
    where s.id = attendance_records.session_id
      and (public.teaches_offering(s.offering_id)
           or (public.same_institution(s.institution_id) and public.is_admin()))
  ))
  with check (exists (
    select 1 from public.attendance_sessions s
    where s.id = attendance_records.session_id
      and (public.teaches_offering(s.offering_id)
           or (public.same_institution(s.institution_id) and public.is_admin()))
  ));


-- ---------- placements ------------------------------------------------------
create policy companies_read on public.companies
  for select to authenticated using (public.same_institution(institution_id));
create policy companies_staff_write on public.companies
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_placement_staff())
  with check (public.same_institution(institution_id) and public.is_placement_staff());

-- Draft drives stay with the placement cell until opened.
create policy placement_drives_read on public.placement_drives
  for select to authenticated
  using (
    public.same_institution(institution_id)
    and (status <> 'draft' or public.is_placement_staff())
  );
create policy placement_drives_staff_write on public.placement_drives
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_placement_staff())
  with check (public.same_institution(institution_id) and public.is_placement_staff());

create policy drive_departments_read on public.drive_departments
  for select to authenticated using (public.same_institution(institution_id));
create policy drive_departments_staff_write on public.drive_departments
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_placement_staff())
  with check (public.same_institution(institution_id) and public.is_placement_staff());

-- An application is between one student and the placement cell. Other students
-- never see it. (Shortlists reach students as a placement-cell post.)
create policy drive_applications_read on public.drive_applications
  for select to authenticated
  using (
    student_id = auth.uid()
    or (public.same_institution(institution_id) and public.is_placement_staff())
  );

create policy drive_applications_self_apply on public.drive_applications
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.same_institution(institution_id)
    and exists (
      select 1 from public.placement_drives d
      where d.id = drive_id
        and d.status = 'open'
        and d.apply_deadline > now()
    )
  );

create policy drive_applications_staff_write on public.drive_applications
  for all to authenticated
  using (public.same_institution(institution_id) and public.is_placement_staff())
  with check (public.same_institution(institution_id) and public.is_placement_staff());


-- ---------- notifications ---------------------------------------------------
-- Read and mark-as-read only. Notifications are WRITTEN server-side (service
-- role / server actions) -- deliberately no client INSERT policy exists, so a
-- user cannot fabricate a notification for anyone, including themselves.
create policy notifications_read_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
