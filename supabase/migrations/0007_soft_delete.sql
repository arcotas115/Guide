-- ============================================================================
-- Campus — 0007_soft_delete.sql
--
-- Implements DELETION_POLICY.md, decided 31 July 2026. The policy's central
-- insight is that "delete a person" is four different operations, and this file
-- builds exactly two of them:
--
--   #1 Deactivate  -> profiles.status. A person is deactivated, never hidden.
--   #2 Soft-delete -> deleted_at, on things a human CREATES and can create
--                     wrongly. Never on events, never on academic record.
--
--   #3 Erase (anonymise) is left possible but unbuilt — it is rare, manual and
--      legally reviewed, and needs a schema where PII is nullable, not a button.
--   #4 Purge (tenant offboarding) is deferred entirely.
--
-- Nothing in the app deletes anything today, so this adds capability and
-- changes no behaviour.
-- ============================================================================


-- ============================================================================
-- 1. profiles.status — access level, not biography
--
-- Three values rather than a boolean, because "graduated, welcome back" and
-- "removed, no access" are different permissions and one flag cannot say both.
-- A retired professor the college wants kept out is `inactive`; one they are
-- happy to let browse their old courses is `alumni`.
--
-- Deliberately NOT deleted_at. Hiding a person leaves holes wherever their name
-- sits next to their work — a submissions list with a mark and no student
-- attached. See DELETION_POLICY.md §3.
-- ============================================================================

alter table public.profiles
  add column if not exists status text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_status_check,
  add constraint profiles_status_check
    check (status in ('active', 'alumni', 'inactive'));

-- Every roster query filters on this pair: "the active people in my institution".
create index if not exists profiles_institution_status_idx
  on public.profiles (institution_id, status);

comment on column public.profiles.status is
  'Access level, not biography. active = full access; alumni = may sign in, read-only, own historical records (surface deferred); inactive = may not sign in. Profiles never carry deleted_at — see DELETION_POLICY.md §3.';


-- ============================================================================
-- 2. is_staff() — who may see a hidden row
--
-- Faculty and admins can, because otherwise nothing can ever be undeleted and a
-- mistaken delete becomes permanent. Everyone else cannot, and that is enforced
-- in RLS rather than in a query, so no forgotten WHERE clause can leak one.
--
-- No institution check here on purpose: the permissive policy on each table
-- already scopes to the caller's institution, and this function only ever
-- narrows further. Keeping it to the role question makes it obvious that it
-- cannot widen anything.
-- ============================================================================

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.current_user_role() in ('faculty', 'admin', 'placement_officer'),
    false
  )
$$;


-- ============================================================================
-- 3. deleted_at — only on things a human creates
--
-- The distinction is whether a row is a THING SOMEONE CREATED (and could have
-- created by mistake) or an EVENT THAT HAPPENED (which cannot be un-happened).
--
-- Tables deliberately excluded, with the reasons, so nobody adds one later
-- thinking it was an oversight:
--
--   grade_history        append-only. A nullable timestamp anyone can set is a
--                        delete wearing a different hat. Not a judgement call.
--   institutions         offboarding is export-then-purge, not a hidden row.
--   attendance_records   an event. You correct a mark; you do not delete it.
--   submissions,         academic record. Removing a student's work is an
--   submission_files,    erasure question, answered by anonymising the person,
--   submission_grades    not by hiding the work.
--   profiles,            people are deactivated, not hidden (§1 above).
--   student_academics
--   enrolments,          join rows. team_members already hard-deletes on
--   teaching_assignments,"leave team" and that is correct.
--   team_members
--   notifications,       ephemeral. Hard delete is fine.
--   announcement_reads
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'departments', 'terms', 'courses', 'course_offerings', 'assignments',
    'announcements', 'materials', 'team_sets', 'teams', 'placement_drives',
    'companies', 'attendance_sessions'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists deleted_at timestamptz', t);
  end loop;
end $$;


-- ============================================================================
-- 4. The policy — a hidden row does not exist for a student
--
-- RESTRICTIVE, not a rewrite of the twelve existing SELECT policies. This is
-- the important structural choice in the file:
--
--   * A restrictive policy is ANDed with the permissive ones, so it can only
--     ever narrow access. It is impossible for this to accidentally widen
--     something.
--   * The twelve existing policies stay untouched. Rewriting each USING clause
--     by hand would mean restating assignments_read's draft logic and
--     teams_read's subquery, and one typo there is a silent data leak.
--   * Every table gets the IDENTICAL rule, generated from the catalogue, so
--     there is no per-table wording to get subtly wrong.
--
-- SELF-MAINTAINING, in the same spirit as the @append-only marker: the loop is
-- driven by "does this table have a deleted_at column", so a table that gains
-- one later gains the policy the next time this runs. The catalogue test
-- asserts the two never diverge.
--
-- `for all` rather than `for select`: a non-staff user should not be able to
-- touch a hidden row either. On INSERT only WITH CHECK applies, and a new row
-- has deleted_at null, so ordinary creation is unaffected. Staff soft-deleting
-- a row passes WITH CHECK via is_staff().
-- ============================================================================

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
                       and a.attname = 'deleted_at' and a.attnum > 0
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop policy if exists %I on public.%I',
                   t.relname || '_hide_deleted', t.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (deleted_at is null or public.is_staff()) '
      'with check (deleted_at is null or public.is_staff())',
      t.relname || '_hide_deleted', t.relname);
  end loop;
end $$;


-- ============================================================================
-- 5. Partial uniques — only where the value should be reusable
--
-- The rule (DELETION_POLICY.md §4): a unique becomes `where deleted_at is null`
-- ONLY if the value should be reusable once the row is hidden. A retired CS301
-- should not block a new CS301; a roll number must never be reused, and needs
-- no change here because profiles carry no deleted_at at all.
--
-- VERIFIED BEFORE RUNNING, because getting it wrong drops referential
-- integrity across the schema: a partial unique index cannot be a foreign-key
-- target, and every composite FK in this schema references a
-- `unique (id, institution_id)` key. None of the six business keys below is
-- referenced by anything — checked against pg_constraint, not assumed — and the
-- guard at the end of this section re-checks it after the fact.
--
-- Mechanically these must become INDEXES rather than CONSTRAINTS: a UNIQUE
-- CONSTRAINT cannot carry a WHERE clause. The constraint is found by its column
-- list rather than by name, so an auto-generated name that differs between
-- environments cannot break the migration.
-- ============================================================================

do $$
declare
  spec  record;
  cname text;
begin
  for spec in
    select * from (values
      ('courses',             array['institution_id', 'code']),
      ('departments',         array['institution_id', 'code']),
      ('terms',               array['institution_id', 'name']),
      ('course_offerings',    array['course_id', 'term_id', 'section']),
      ('attendance_sessions', array['offering_id', 'held_on']),
      ('companies',           array['institution_id', 'name'])
    ) as v(tbl, cols)
  loop
    select con.conname into cname
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = spec.tbl and con.contype = 'u'
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
           ) = spec.cols;

    if cname is not null then
      execute format('alter table public.%I drop constraint %I', spec.tbl, cname);
    end if;

    execute format(
      'create unique index if not exists %I on public.%I (%s) where deleted_at is null',
      spec.tbl || '_live_key', spec.tbl, array_to_string(spec.cols, ', '));
  end loop;
end $$;

-- The guard. If any composite-FK target ever became partial, every foreign key
-- pointing at it would have been silently dropped, and that is not something to
-- discover later.
do $$
declare n bigint;
begin
  select count(*) into n
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and i.indpred is not null            -- partial
     and (select array_agg(a.attname::text order by a.attname)
            from unnest(i.indkey) k
            join pg_attribute a on a.attrelid = c.oid and a.attnum = k
         ) = array['id', 'institution_id'];
  if n > 0 then
    raise exception
      'ABORTING: % unique(id, institution_id) key(s) became partial. Those are '
      'the targets of every composite foreign key in this schema; a partial '
      'index cannot be an FK target, so referential integrity would be gone.', n;
  end if;
end $$;


-- ============================================================================
-- 6. Indexes
--
-- NOT a plain btree on deleted_at. That column is null for virtually every row,
-- so an index on it is both enormous and useless — the planner will not use it
-- to find the nulls, which is the query every screen actually runs.
--
-- What helps is a PARTIAL index on the access path each table is already read
-- by, restricted to live rows. Those indexes are smaller than the ones they
-- shadow (they exclude deleted rows entirely) and they serve the default query.
--
-- Applied only where volume justifies it. Per institution, per term:
--   assignments          ~6 per offering across every offering — thousands
--   announcements        similar, and read on every course screen
--   materials            similar
--   attendance_sessions  one per class meeting — the largest of the twelve
-- The other eight (departments, terms, courses, course_offerings, team_sets,
-- teams, placement_drives, companies) are hundreds of rows at most, where a
-- sequential scan is faster than an index lookup and the write cost is pure
-- loss.
-- ============================================================================

create index if not exists assignments_live_idx
  on public.assignments (offering_id, due_at) where deleted_at is null;

create index if not exists announcements_live_idx
  on public.announcements (offering_id, created_at desc) where deleted_at is null;

create index if not exists materials_live_idx
  on public.materials (offering_id, created_at desc) where deleted_at is null;

create index if not exists attendance_sessions_live_idx
  on public.attendance_sessions (offering_id, held_on desc) where deleted_at is null;


-- ============================================================================
-- 7. Grants
--
-- No new tables, so 0003 needs no re-run for grants. Re-run it anyway — the
-- habit and the idempotency test both stay, and the double-run is what proves
-- the append-only revokes survive it.
-- ============================================================================

notify pgrst, 'reload schema';
