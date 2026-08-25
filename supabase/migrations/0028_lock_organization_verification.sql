-- 0028 — Stop an organisation from verifying itself.
--
-- 0027 made `organizations.verified` the gate that decides whether an internal
-- job posting reaches the public feed. It never restricted who can WRITE that
-- column, and the `organizations` UPDATE policy is
--
--     using (is_org_member(id)) with check (is_org_member(id))
--
-- with no column restriction. So any member of an organisation could simply
-- set `verified = true` on it. Measured against the live project before
-- building the employer surface, with a throwaway user:
--
--   1. create an organisation                    -> 201, verified = false
--   2. join it as owner (legitimate)             -> 201
--   3. update organizations set verified = true  -> NO ERROR, verified = true
--   4. post an internal job, read as a stranger  -> VISIBLE
--
-- One line, and 0027's gate is decorative. It held until now only because no
-- product code had ever exercised it — the same reason 0026 and 0027 existed
-- at all. The employer surface in this change is the first code that would
-- have walked straight through it.
--
-- RLS cannot express "these columns but not that one", so this is a column
-- privilege problem, not a policy problem. Note the order: a table-level
-- UPDATE grant overrides any column-level revoke, and Supabase grants
-- `ALL ON ALL TABLES` to anon/authenticated by default — so the table-level
-- grant has to come off FIRST, then be re-granted per column. Revoking only
-- the column would have looked right and changed nothing.
--
-- What stays writable is the company profile an employer legitimately edits.
-- `verified` and `created_by` come off that list: the first is the trust
-- signal itself, the second decides who may join the org
-- (see 0026's membership INSERT policy), so a member who could rewrite it
-- could hand the join right to anyone.
--
-- Verification itself now happens server-side, through the service role, in
-- src/lib/employer/verification.ts.

revoke update on public.organizations from anon, authenticated;

grant update (name, domain, logo_url, description, updated_at)
  on public.organizations
  to authenticated;
