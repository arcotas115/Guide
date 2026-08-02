-- ============================================================================
-- Campus — 0010_storage.sql
--
-- Supabase storage rules ARE RLS policies on storage.objects, so they belong
-- here: in git, reviewable, diffable, restorable. Configuration that exists
-- only in a dashboard cannot be reviewed and cannot be rebuilt.
--
-- This is also the first migration that governs something NOT reproducible from
-- git. Schema and code rebuild from migrations plus seed; uploaded files do not.
--
-- ----------------------------------------------------------------------------
-- THE PATH CONVENTION IS THE ACCESS-CONTROL RULE
--
--     {institution_id}/{assignment_id}/{owner_id}/{attempt}/{filename}
--
-- Institution FIRST, deliberately. Tenant isolation becomes visible in the path
-- itself, which is what makes a later move to per-tenant buckets — or to
-- storage a college already pays for — a migration rather than a rewrite
-- (FUTUREPROOFING item 5).
--
-- storage.foldername(name) is 1-INDEXED and excludes the filename, so:
--     [1] institution_id   [2] assignment_id   [3] owner_id   [4] attempt
--
-- An off-by-one here compares the wrong segment and fails SILENTLY — it would
-- read as "students can write anywhere" or "nobody can write at all", both of
-- which look like something else. The indexing is asserted in the test suite
-- rather than read twice.
-- ============================================================================


-- ============================================================================
-- 1. The bucket
--
-- PRIVATE. Every read goes through a signed URL minted by the server, so there
-- is no public path to a student's work even if the object name leaks.
--
-- file_size_limit is the ONLY place actual bytes are enforced, because the
-- bucket is the only thing that sees them — a client-declared size is a claim.
-- 50 MB per file: handwritten work photographed on a phone runs 5–10 MB a page
-- and is the common case in India, so a smaller cap would fail the ordinary
-- upload rather than the abusive one.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 52428800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;


-- ============================================================================
-- 2. Is this assignment accepting work right now?
--
-- The same question submit_attempt() asks, in boolean form, so the storage
-- policy and the recording function cannot disagree about whether a deadline
-- has passed. submit_attempt keeps its own granular checks because it owes the
-- student a specific sentence; this owes a policy a true or false.
--
-- The test suite asserts the two agree across every state.
-- ============================================================================

create or replace function public.assignment_accepting(p_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    join public.course_offerings o on o.id = a.offering_id
    join public.courses c on c.id = o.course_id
    join public.terms   t on t.id = o.term_id
    where a.id = p_assignment_id
      and a.deleted_at is null
      and o.deleted_at is null
      and c.deleted_at is null
      and t.deleted_at is null
      and a.status = 'open'
      and (a.opens_at is null or a.opens_at <= now())
      and (
        now() <= a.due_at
        or (a.allow_late and (a.late_until is null or now() <= a.late_until))
      )
  )
$$;

-- "Is this folder mine to write into?" — the owner segment must be the caller,
-- or a team the caller belongs to. Team submissions put the TEAM id in the
-- owner segment so every member reaches the same folder.
create or replace function public.storage_owner_is_caller(p_owner text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    case
      when p_owner is null then false
      -- A malformed segment must be false, not an error: a cast failure inside
      -- a policy aborts the whole statement with a message nobody can act on.
      when p_owner !~ '^[0-9a-fA-F-]{36}$' then false
      when p_owner::uuid = auth.uid() then true
      else exists (
        select 1 from public.team_members tm
        where tm.team_id = p_owner::uuid and tm.student_id = auth.uid()
      )
    end
$$;


-- ============================================================================
-- 3. Policies on storage.objects
--
-- Scoped to the submissions bucket throughout — these must not govern any other
-- bucket added later.
-- ============================================================================

drop policy if exists submissions_student_upload on storage.objects;
drop policy if exists submissions_student_read on storage.objects;
drop policy if exists submissions_staff_read on storage.objects;

-- ---- write: only into your own folder, only while the work is accepted -----
--
-- Three conditions, and all three matter:
--   [1] the institution segment is the caller's own tenant
--   [3] the owner segment is the caller (or their team)
--   [2] the assignment is currently accepting work
--
-- The third is what stops an upload into a closed assignment's folder. Without
-- it a student could stage files after the deadline and only the recording call
-- would refuse — leaving the bytes there.
create policy submissions_student_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.current_institution_id()::text
    and public.storage_owner_is_caller((storage.foldername(name))[3])
    and public.assignment_accepting(
          nullif((storage.foldername(name))[2], '')::uuid)
  );

-- ---- read: your own work ---------------------------------------------------
create policy submissions_student_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.current_institution_id()::text
    and public.storage_owner_is_caller((storage.foldername(name))[3])
  );

-- ---- read: the staff who teach it ------------------------------------------
--
-- Faculty read everything under an assignment they teach; admins read within
-- their institution. Note this is a READ policy only — a professor does not
-- upload into a student's folder, and SpeedGrader in 1C only ever reads.
create policy submissions_staff_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = public.current_institution_id()::text
    and exists (
      select 1 from public.assignments a
      where a.id = nullif((storage.foldername(name))[2], '')::uuid
        and (
          public.teaches_offering(a.offering_id)
          or (public.same_institution(a.institution_id) and public.is_admin())
        )
    )
  );

-- No UPDATE and no DELETE policy for anyone. Nothing is ever removed on
-- resubmit — old attempts stay, they are simply not the graded one — so a
-- client has no reason to hold either, and an audit trail of submitted work is
-- worth more than tidiness.

notify pgrst, 'reload schema';
