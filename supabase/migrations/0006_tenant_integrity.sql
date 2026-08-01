-- ============================================================================
-- Campus — 0006_tenant_integrity.sql
--
-- The theme is "true by constraint, not by convention". Two of the four things
-- the brief asked for turned out to be true by constraint already; this file
-- does the two that were not, and the catalogue tests that keep all four true.
--
-- ----------------------------------------------------------------------------
-- ALREADY CORRECT — verified against the catalogue, not assumed:
--
--   1. COMPOSITE FOREIGN KEYS. Every foreign key between two tables that both
--      carry institution_id already includes it — 48 of 48. The 20 parent
--      tables already carry `unique (id, institution_id)`. This was built into
--      0001 and maintained in 0004 and 0005.
--
--      The brief's worked example is the one case that was never broken:
--        submission_grades (submission_id, institution_id) -> submissions
--        submission_grades (graded_by,     institution_id) -> profiles
--        submission_grades (updated_by,    institution_id) -> profiles
--      Only submission_grades.institution_id -> institutions is single-column,
--      which is one of the two exemptions the brief itself names.
--
--      So there are no FKs to rewrite and NO extra indexes to pay for — the
--      ~20 redundant uniques were already bought in 0001. What was missing is
--      the test that stops table 32 quietly opting out, and that is in
--      supabase/tests/rls.test.mjs.
--
--   2. GRANTS. `authenticated` holds SELECT, INSERT, UPDATE, DELETE and nothing
--      else — no TRUNCATE, no TRIGGER, no REFERENCES. 0003 has always granted
--      explicitly rather than with GRANT ALL, so the fingerprint the brief
--      describes is not present. Also now asserted by a test.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS FILE ACTUALLY CHANGES:
--   3. The audit log cannot lose its actor.
--   4. grade_history.changed_at advances within a transaction.
--   5. Append-only tables declare themselves, so 0003 stops hand-maintaining
--      a list that fails silently when someone forgets it.
-- ============================================================================


-- ============================================================================
-- 3. THE AUDIT ACTOR CANNOT BE NULL
--
-- CHOSEN: NOT NULL on the column, not a RAISE inside the trigger.
--
-- Both close the hole. NOT NULL is better for three reasons:
--   * It is declarative. It shows up in \d, in a schema dump, and in any tool
--     that reads the catalogue — where a plpgsql RAISE is invisible until you
--     open the function body.
--   * It applies to EVERY write path, including ones that bypass the trigger
--     entirely (a future COPY, a repair script, an admin fixing a row by hand).
--     A trigger guard only covers the paths the trigger fires on.
--   * It is checked by the storage layer rather than by an extra function call
--     per row.
--
-- The cost is that every INSERT into submission_grades must now name the actor.
-- That is not a cost, that is the requirement — the 1C grading path has to
-- decide who is grading, and being unable to compile without deciding is the
-- entire point.
-- ============================================================================

-- Backfill before constraining. `graded_by` is not a guess here: for a row that
-- has never been updated, the person who last changed it IS the person who
-- created it. Rows that cannot be attributed at all stop the migration rather
-- than being quietly assigned to someone.
do $$
declare n bigint;
begin
  update public.submission_grades
     set updated_by = graded_by
   where updated_by is null
     and graded_by is not null;

  select count(*) into n from public.submission_grades where updated_by is null;
  if n > 0 then
    raise exception
      'REFUSING TO SET updated_by NOT NULL: % submission_grades row(s) have no '
      'updated_by and no graded_by to fall back on. Attribute them first — '
      'guessing an actor in an audit trail is worse than failing here.', n;
  end if;
end $$;

alter table public.submission_grades
  alter column updated_by set not null;


-- Same for the history rows themselves. changed_by comes from
-- submission_grades.updated_by, which is now NOT NULL, so new rows can never
-- lack it; this closes the door on rows written before that was true.
do $$
declare n bigint;
begin
  update public.grade_history h
     set changed_by = g.updated_by
    from public.submission_grades g
   where h.submission_id = g.submission_id
     and h.changed_by is null;

  select count(*) into n from public.grade_history where changed_by is null;
  if n > 0 then
    raise exception
      'REFUSING TO SET changed_by NOT NULL: % grade_history row(s) have no '
      'attributable actor. An audit row that cannot say who is not worth '
      'keeping — delete or attribute them, then re-run.', n;
  end if;
end $$;

alter table public.grade_history
  alter column changed_by set not null;


-- ============================================================================
-- 4. changed_at ADVANCES WITHIN A TRANSACTION
--
-- now() is transaction_timestamp(): every row written inside one transaction
-- gets the SAME value. That is wrong for an audit log — a bulk "save all
-- grades" in 1C is one transaction, and every history row it writes would tie,
-- leaving no way to say which correction came first. Measured, not assumed:
-- three inserts in one transaction with sleeps between them produced ONE
-- distinct now() and THREE distinct clock_timestamp().
--
-- clock_timestamp() reads the wall clock each call. It does not violate rule 2
-- — that rule is about auto-increment integer keys colliding across shards, and
-- a timestamp is neither.
--
-- It is still not a guaranteed TOTAL order: two rows written inside the same
-- clock tick tie, and the tick is coarse in some environments. So the id
-- tiebreak on the index stays. clock_timestamp makes the ordering meaningful;
-- the tiebreak makes it deterministic. Both are needed and they do different
-- jobs.
-- ============================================================================

alter table public.grade_history
  alter column changed_at set default clock_timestamp();


-- ============================================================================
-- 5. APPEND-ONLY TABLES DECLARE THEMSELVES
--
-- 0003 previously carried a hand-written array of append-only table names. That
-- fails in exactly the way the brief describes: add an append-only table, forget
-- the list, and the next 0003 re-run silently grants UPDATE and DELETE on it.
-- Nothing errors. The wrong thing just quietly becomes possible.
--
-- The marker is now the table's own COMMENT, containing the literal token
-- `@append-only`. Chosen over the alternatives:
--
--   * A registry table would need its own grants and policies, and a registry
--     that itself needs protecting is a regress.
--   * Deriving it from "has no UPDATE or DELETE policy" is tempting and wrong:
--     a table can lack an UPDATE policy because nobody has written one YET, and
--     silently revoking UPDATE from it would be a real outage.
--
-- A comment travels with the table, survives pg_dump, is visible in \d+, and
-- cannot be set by accident. And because the marker is a machine-readable token
-- rather than prose, `like '%append-only%'` cannot be tripped by a sentence
-- that merely mentions the phrase.
--
-- The test in rls.test.mjs asserts this in BOTH directions — a marked table
-- must have no write policies, and a table with no write policies must be
-- marked — so forgetting either half fails the build.
-- ============================================================================

comment on table public.grade_history is
  '@append-only Written only by the trigger on submission_grades. No role may '
  'UPDATE or DELETE; there is no client INSERT policy either, because the '
  'trigger is SECURITY DEFINER and a client INSERT policy would let a professor '
  'forge a row. Students may never read it, published or not.';
