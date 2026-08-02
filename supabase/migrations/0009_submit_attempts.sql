-- ============================================================================
-- Campus — 0009_submit_attempts.sql
--
-- Submitting work. Three holes in the existing policies, all verified against a
-- running database before this was written rather than inferred:
--
--   (a) A student cannot resubmit AT ALL. submissions_teacher_write is the only
--       UPDATE policy, so bumping latest_attempt affects 0 rows — silently.
--
--   (b) The obvious fix is worse than the bug. Granting students UPDATE on
--       submissions also grants submitted_at and is_late, and RLS cannot compare
--       OLD to NEW — so nothing would stop a student backdating their own work.
--       The same trap 0002 already documents for profiles.role.
--
--   (c) submission_files_student_insert checks ownership and NOTHING ELSE.
--       Measured: a student appended `attempt 99` to an assignment that closed
--       in June, and it was accepted. The deadline is enforced on the
--       first-submission path and not on the resubmission path — which is the
--       one that matters.
--
-- All three are closed the same way: submitting stops being a policy question
-- and becomes a FUNCTION. See §3.
-- ============================================================================


-- ============================================================================
-- 1. submission_attempts — an attempt becomes an entity
--
-- THE DECISION, and why the table rather than deriving min(uploaded_at):
--
--   * An attempt genuinely IS an entity. It has a number, a time, a late-ness,
--     and in 1C a "this is the one being graded" relationship. Deriving the
--     time from its items answers "when was attempt 2 submitted" with three
--     candidates when the attempt holds a file, a link and a typed answer.
--   * `unique (submission_id, attempt)` makes a duplicate attempt number
--     UNREPRESENTABLE rather than merely unlikely — which is what actually
--     settles the two-tabs race, not the ordering of statements inside the
--     function.
--   * Deriving breaks the first time an item is added to an existing attempt
--     or a file is replaced: min(uploaded_at) would move.
--
-- The cost is one table and one more join. That is cheaper than a timestamp
-- that is right until someone edits an item.
-- ============================================================================

create table if not exists public.submission_attempts (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid        not null references public.institutions (id) on delete cascade,
  submission_id  uuid        not null,
  attempt        int         not null check (attempt >= 1),
  -- Server clock, always. A client-supplied timestamp is not evidence.
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  -- The constraint that makes the race unrepresentable.
  unique (submission_id, attempt),
  unique (id, institution_id),

  foreign key (submission_id, institution_id)
    references public.submissions (id, institution_id) on delete cascade
);

create index if not exists submission_attempts_submission_idx
  on public.submission_attempts (submission_id, attempt desc);
create index if not exists submission_attempts_institution_idx
  on public.submission_attempts (institution_id);

comment on table public.submission_attempts is
  '@function-written One row per attempt. submitted_at is the server clock at the moment submit_attempt() ran; late-ness is DERIVED from it against the assignment''s current due_at and is never stored.';


-- ============================================================================
-- 2. is_late is DERIVED, never stored
--
-- SPEC §4 stored it at submit time. That contradicts the product: the
-- prototype's announcement copy promises that extending a deadline makes work
-- show AS ON TIME, and a frozen boolean cannot do that. Computed from the
-- attempt's timestamp against the assignment's CURRENT due_at, it self-corrects
-- with no write at all.
--
-- Dropping rather than leaving it: a stored column that nothing reads is a trap
-- for whoever reads it next and believes it.
-- ============================================================================

do $$
declare n bigint;
begin
  select count(*) into n from public.submissions where is_late;
  if n > 0 then
    raise notice
      'NOTE: % submission(s) had is_late = true. The flag is being dropped and '
      'late-ness recomputed from each attempt''s timestamp; nothing is lost.', n;
  end if;
end $$;

alter table public.submissions drop column if exists is_late;

-- Backfill an attempt row for any submission that predates this table, so the
-- two never disagree. submitted_at is the only honest source available.
insert into public.submission_attempts (institution_id, submission_id, attempt, submitted_at)
select s.institution_id, s.id, 1, s.submitted_at
from public.submissions s
where not exists (
  select 1 from public.submission_attempts a where a.submission_id = s.id
);


-- ============================================================================
-- 3. submit_attempt() — the only way to hand work in
--
-- SECURITY DEFINER, so it runs as the owner and RLS does not apply inside it.
-- That is the point: it can do the write a student is correctly forbidden from
-- doing directly, while performing by hand every check RLS would have made —
-- plus the three RLS cannot express.
--
-- Because RLS is off inside, EVERY visibility check is explicit below. A
-- definer function that forgets one is a hole with a nicer name.
--
-- search_path pinned with pg_temp LAST, matching the twelve existing helpers: a
-- definer function with a mutable search_path is a privilege-escalation vector,
-- and pg_temp early lets a caller shadow a real table with a temporary one.
-- ============================================================================

create or replace function public.submit_attempt(
  p_assignment_id uuid,
  p_items         jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  a              record;
  v_institution  uuid;
  v_submission   uuid;
  v_team         uuid;
  v_attempt      int;
  v_now          timestamptz := now();
  v_item         jsonb;
  v_count        int := 0;
  v_bytes        bigint := 0;
  v_kind         text;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- ---- the assignment, and whether it is visible at all -------------------
  select a2.* into a
  from public.assignments a2
  join public.course_offerings o on o.id = a2.offering_id
  join public.courses c on c.id = o.course_id
  join public.terms   t on t.id = o.term_id
  where a2.id = p_assignment_id
    and a2.deleted_at is null
    and o.deleted_at is null
    and c.deleted_at is null
    and t.deleted_at is null;

  if not found then
    raise exception 'That assignment is not available.' using errcode = 'P0002';
  end if;

  v_institution := a.institution_id;

  -- ---- is the caller entitled to submit to it? ---------------------------
  if not exists (
    select 1 from public.enrolments e
    where e.offering_id = a.offering_id and e.student_id = v_uid
  ) then
    raise exception 'You are not enrolled in this course.' using errcode = '42501';
  end if;

  -- ---- is it accepting work RIGHT NOW? This is the check hole (c) missed --
  if a.status <> 'open' then
    raise exception
      'This assignment is not open for submissions.' using errcode = '22023';
  end if;

  if a.opens_at is not null and a.opens_at > v_now then
    raise exception
      'This assignment has not opened yet.' using errcode = '22023';
  end if;

  if v_now > a.due_at then
    if not a.allow_late then
      raise exception
        'The deadline has passed and late work is not accepted.' using errcode = '22023';
    end if;
    if a.late_until is not null and v_now > a.late_until then
      raise exception
        'The late window for this assignment has closed.' using errcode = '22023';
    end if;
  end if;

  -- ---- who is submitting: a student, or their team? ----------------------
  if a.is_team then
    select tm.team_id into v_team
    from public.team_members tm
    where tm.team_set_id = a.team_set_id and tm.student_id = v_uid;

    if v_team is null then
      raise exception
        'You are not in a team for this assignment yet.' using errcode = '22023';
    end if;
  end if;

  -- ---- validate the items BEFORE writing anything -------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add something to submit.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 20 then
    raise exception
      'An attempt can hold at most 20 items; this one has %.',
      jsonb_array_length(p_items) using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_kind := v_item ->> 'kind';
    v_count := v_count + 1;
    v_bytes := v_bytes + coalesce((v_item ->> 'size_bytes')::bigint, 0);

    if v_kind not in ('file', 'link', 'text') then
      raise exception 'Unknown item type "%".', v_kind using errcode = '22023';
    end if;
    -- The assignment decides what it will take. Checked here as well as in the
    -- UI, because the UI is a courtesy and this is the rule.
    if v_kind = 'file' and not a.accept_file then
      raise exception 'This assignment does not accept files.' using errcode = '22023';
    end if;
    if v_kind = 'link' and not a.accept_link then
      raise exception 'This assignment does not accept links.' using errcode = '22023';
    end if;
    if v_kind = 'text' and not a.accept_text then
      raise exception 'This assignment does not accept typed answers.' using errcode = '22023';
    end if;
    if v_kind = 'file' and coalesce(v_item ->> 'storage_path', '') = '' then
      raise exception 'A file item needs a storage path.' using errcode = '22023';
    end if;
    if v_kind = 'link' and coalesce(v_item ->> 'url', '') = '' then
      raise exception 'A link item needs a URL.' using errcode = '22023';
    end if;
    if v_kind = 'text' and coalesce(v_item ->> 'text_body', '') = '' then
      raise exception 'A typed answer cannot be empty.' using errcode = '22023';
    end if;
  end loop;

  -- A per-attempt ceiling. The BUCKET is the authority on actual bytes — it is
  -- the only thing that sees them — so this guards the aggregate a client
  -- claims, which is what stops a thousand small files as much as one huge one.
  if v_bytes > 150 * 1024 * 1024 then
    raise exception
      'That attempt totals %.1f MB; the limit is 150 MB.',
      v_bytes / 1048576.0 using errcode = '22023';
  end if;

  -- ---- find or create the submission, then LOCK it ------------------------
  -- FOR UPDATE serialises two tabs submitting at once: the second waits, then
  -- reads the attempt number the first one wrote. The unique constraint on
  -- (submission_id, attempt) is the backstop if that ever fails.
  if a.is_team then
    select id into v_submission from public.submissions
     where assignment_id = p_assignment_id and team_id = v_team for update;
  else
    select id into v_submission from public.submissions
     where assignment_id = p_assignment_id and student_id = v_uid for update;
  end if;

  if v_submission is null then
    insert into public.submissions (institution_id, assignment_id, student_id, team_id, submitted_at)
    values (v_institution, p_assignment_id,
            case when a.is_team then null else v_uid end,
            case when a.is_team then v_team else null end,
            v_now)
    returning id into v_submission;
  elsif not a.allow_multiple_attempts then
    raise exception
      'You have already submitted, and this assignment allows one attempt only.'
      using errcode = '22023';
  end if;

  -- ---- the attempt number comes from the DATABASE, never the client -------
  select coalesce(max(attempt), 0) + 1 into v_attempt
  from public.submission_attempts where submission_id = v_submission;

  insert into public.submission_attempts (institution_id, submission_id, attempt, submitted_at)
  values (v_institution, v_submission, v_attempt, v_now);

  -- ---- the items ----------------------------------------------------------
  insert into public.submission_files
    (institution_id, submission_id, attempt, kind, storage_path, url, text_body, file_name, uploaded_at)
  select
    v_institution, v_submission, v_attempt,
    i ->> 'kind',
    nullif(i ->> 'storage_path', ''),
    nullif(i ->> 'url', ''),
    nullif(i ->> 'text_body', ''),
    nullif(i ->> 'file_name', ''),
    v_now
  from jsonb_array_elements(p_items) i;

  -- A cached max, and submit_attempt is its only writer. Asserted equal to
  -- max(attempt) by the test suite so it cannot drift unnoticed.
  update public.submissions
     set latest_attempt = v_attempt, submitted_at = v_now
   where id = v_submission;

  return jsonb_build_object(
    'submission_id', v_submission,
    'attempt',       v_attempt,
    'submitted_at',  v_now,
    'is_late',       v_now > a.due_at,
    'item_count',    v_count
  );
end;
$$;

revoke all on function public.submit_attempt(uuid, jsonb) from public;
grant execute on function public.submit_attempt(uuid, jsonb) to authenticated;

comment on function public.submit_attempt(uuid, jsonb) is
  'The ONLY way to create or extend a submission. Verifies enrolment, that the assignment is currently accepting work, and the attempt policy; computes the attempt number and submitted_at server-side. Clients have no direct INSERT on submission_files.';


-- ============================================================================
-- 4. Narrow the policies the function replaces
--
-- DECISION: submission_files_student_insert is DROPPED, not tightened.
--
-- Tightening it would mean restating every check in §3 as a policy expression —
-- status, opens_at, the late window, the attempt policy, the attempt number —
-- in a language that cannot see the previous row and cannot compute a
-- sequence. It would be a worse copy of the function that already exists, and
-- two implementations of one rule drift.
--
-- Dropping it means there is exactly ONE way in. A student with the raw API
-- cannot append an item at all; they can only call submit_attempt, which
-- decides. That is what makes hole (c) closed rather than narrowed.
--
-- The INSERT grant goes too, so the refusal is a privilege error rather than a
-- policy that happens to match nothing.
-- ============================================================================

drop policy if exists submission_files_student_insert on public.submission_files;
drop policy if exists submission_attempts_student_insert on public.submission_attempts;

revoke insert, update, delete on public.submission_files from authenticated;

-- submissions: students never write directly either. The insert policy from
-- 0002 is superseded by the function for the same reason.
drop policy if exists submissions_student_insert on public.submissions;
revoke insert, update, delete on public.submissions from authenticated;


-- ============================================================================
-- 5. Reading attempts
--
-- Same shape as submission_files: the owner, their team, and the staff who
-- teach it. Nobody writes from a client — the function does.
-- ============================================================================

alter table public.submission_attempts enable row level security;

drop policy if exists submission_attempts_read on public.submission_attempts;
create policy submission_attempts_read on public.submission_attempts
  for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = submission_attempts.submission_id
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

grant select on public.submission_attempts to authenticated;
grant select, insert, update, delete on public.submission_attempts to service_role;
revoke all on public.submission_attempts from anon;

-- The marker 0003 reads. `@function-written` means: no client may write this
-- table, but a SECURITY DEFINER function and service_role may. Distinct from
-- `@append-only`, which means nobody may ever update or delete — including
-- service_role. Recording it in the catalogue is what stops a 0003 re-run from
-- handing the INSERT grant back.
comment on table public.submissions is
  '@function-written Written only by submit_attempt() and by the professor''s grading path. A client has no INSERT/UPDATE: the deadline, attempt-policy and attempt-number checks live in that function because RLS cannot express them.';
comment on table public.submission_files is
  '@function-written Written only by submit_attempt(). A client INSERT here was hole (c): it checked ownership and never looked at the assignment, so a student could append work to an assignment that closed weeks ago.';

notify pgrst, 'reload schema';
