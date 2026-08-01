-- ============================================================================
-- Campus — 0003_grants.sql
--
-- WHY THIS FILE EXISTS
-- A Supabase project normally ships with default privileges that hand every
-- newly created table in `public` to anon, authenticated and service_role
-- automatically. This project has that turned OFF deliberately, so that no
-- table becomes reachable by accident -- exposure has to be written down.
--
-- The consequence is that a table created by a migration starts with NO grants
-- at all, and `service_role` -- the trusted server-side key used by seeds,
-- cron jobs and webhooks -- gets "permission denied for table institutions"
-- even though it bypasses RLS. Bypassing RLS is not the same as having table
-- privileges: RLS decides WHICH ROWS you may touch, GRANT decides whether you
-- may touch the table at all. service_role wins the first check and fails the
-- second.
--
-- RLS IS UNTOUCHED BY THIS FILE. Nothing here weakens a policy. Grants are the
-- outer door; the policies in 0002 are still the lock on every room.
--
-- ----------------------------------------------------------------------------
-- THE ASYMMETRY, AND WHY IT IS DELIBERATE
--
--   service_role  -> granted on existing tables AND via ALTER DEFAULT
--                    PRIVILEGES on future ones.
--   authenticated -> granted on existing tables ONLY. No default privileges.
--
-- Those are not inconsistent; they follow from what each role can do.
--
-- service_role never reaches a browser, and it already bypasses RLS. Withholding
-- a grant from it buys no security whatsoever -- it only produces a confusing
-- server-side failure at 2am. Auto-granting it on future tables is safe.
--
-- authenticated IS the browser. If it were auto-granted on future tables, then
-- a table added in a later migration would be readable and writable by every
-- logged-in user of every institution from the moment it existed -- before
-- anyone wrote a single policy for it, and (worse) even if someone forgot to
-- enable RLS on it. That is precisely the landmine the project setting was
-- turned off to avoid, so it stays manual.
--
-- ----------------------------------------------------------------------------
-- RE-RUN THIS FILE AFTER ANY MIGRATION THAT ADDS A TABLE.
-- Every statement below is idempotent, and the GRANT ... ON ALL TABLES form is
-- a snapshot of what exists at the moment it runs -- not a standing rule. So
-- the maintenance instruction is simply: add tables, write their policies,
-- then run this file again.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Schema access
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. Existing tables
--    authenticated gets blanket DML and is then gated, row by row, by the
--    policies in 0002. service_role gets the same and is gated by nothing --
--    which is the entire point of a server-side key.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Sequences
--    There are none today -- every primary key is a uuid from
--    gen_random_uuid(). This is here so that the day someone adds a
--    `bigserial` counter, it does not fail with a privilege error that looks
--    nothing like its cause.
-- ---------------------------------------------------------------------------
grant usage, select on all sequences in schema public
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Functions
--    The RLS helpers in 0002 (current_institution_id, teaches_offering, ...)
--    have to be callable by the roles whose policies invoke them.
-- ---------------------------------------------------------------------------
grant execute on all functions in schema public
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4b. Append-only tables — the exception to section 2
--
-- Section 2 grants UPDATE and DELETE on ALL tables, which would quietly undo
-- append-only every time this file is re-run. That is precisely the failure
-- mode this file's own "re-run me after adding a table" instruction causes.
--
-- THE LIST IS NOT WRITTEN HERE. It was, and that was the bug waiting to happen:
-- add an append-only table, forget to add its name, and the next re-run of this
-- file silently makes UPDATE and DELETE possible again. Nothing errors.
--
-- Instead each table declares itself, by carrying the literal token
-- `@append-only` in its COMMENT (see 0006 for why a comment rather than a
-- registry table or a policy-shape heuristic). This loop reads the catalogue, so
-- a new append-only table is covered the moment it is commented, and the
-- catalogue test asserts the marker and the policies agree in both directions.
--
-- RLS already denies these writes — no UPDATE or DELETE policy exists on such a
-- table — so this is the second lock, not the only one. Both, because an audit
-- log is worth two.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and coalesce(obj_description(c.oid, 'pg_class'), '') like '%@append-only%'
  loop
    execute format(
      'revoke update, delete on public.%I from authenticated, service_role',
      t.relname);
    -- No client INSERT either: these tables are written by SECURITY DEFINER
    -- triggers, and a grant here would let a client forge rows.
    execute format('revoke insert on public.%I from authenticated', t.relname);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 5. anon stays shut
--    There is no signed-out surface in this product: every screen is behind a
--    login. Re-stated here (0002 does it too) so that this file alone is a
--    complete and accurate description of who may touch what.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;


-- ---------------------------------------------------------------------------
-- 6. Future tables — service_role only. See the asymmetry note above.
--
--    ALTER DEFAULT PRIVILEGES is scoped to the role that CREATES the object,
--    which is why `for role postgres` is named explicitly: migrations run as
--    postgres, whether pasted into the SQL editor or applied by the CLI. A
--    table created by any other role would not pick these up.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;


-- ---------------------------------------------------------------------------
-- 7. Tell PostgREST to re-read the schema.
--    PostgREST caches which tables each role may see. Adding a GRANT does not
--    always invalidate that cache on its own, and the symptom is maddening:
--    the grant is visibly correct in psql, and the API still returns 42501.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
