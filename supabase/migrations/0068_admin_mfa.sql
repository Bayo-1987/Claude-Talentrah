-- 0068 — record that an operator has a second factor.
--
-- ── WHY A COLUMN AND NOT A READ OF auth.mfa_factors ──────────────────────
--
-- The truth about factors lives in `auth.mfa_factors`, and that would be the
-- obvious place to ask. It is not reachable: the service role has USAGE on the
-- auth schema and NO table privileges, and PostgREST does not expose the
-- schema at all (PGRST106). That is the same wall that forced 0067 to be
-- SECURITY DEFINER, measured then and unchanged now.
--
-- A second SECURITY DEFINER function could read it. That would be the right
-- call if this were an audit surface — 0067 is, because it must be impossible
-- to widen. This is a GATE, consulted on every admin page render, and a gate
-- wants a cheap local answer rather than a definer-rights function on the
-- request path.
--
-- So: a timestamp on `admin_users`, written when enrolment actually completes.
--
-- ── THE DRIFT THIS CREATES, AND WHY IT IS BOUNDED ────────────────────────
--
-- A denormalised flag can disagree with the thing it describes. Two directions,
-- and they are not symmetric:
--
--   column set, factor gone      an operator is asked for a code they cannot
--                                produce. Locks them out. BAD.
--   column null, factor present  an operator is sent to enrol again. Harmless
--                                noise; Supabase refuses a duplicate verified
--                                factor and the page says so.
--
-- The first is the one that matters, and there is exactly one way to remove a
-- factor: `npm run grant-admin -- --reset-mfa`, which clears the column in the
-- same operation. Nothing else in this codebase calls unenroll. An operator
-- CANNOT remove their own factor from a password-only session either — that is
-- not an assumption, it was measured against the live API:
--
--     fresh password-only login   AAL: aal1
--     mfa.unenroll(factorId)      422 AAL2 required to unenroll verified factor
--
-- which is the whole reason this mitigation is worth building: an attacker
-- holding a reset password reaches aal1 and cannot take the factor off.

alter table public.admin_users
  add column mfa_enrolled_at timestamptz;

comment on column public.admin_users.mfa_enrolled_at is
  'When this operator completed TOTP enrolment. Null means the admin guard forces them to /admin/mfa before anything else. Cleared only by grant-admin --reset-mfa, which unenrolls the factor in the same breath so the two cannot drift apart.';

-- No grants change. `admin_users` already has every privilege revoked from
-- anon and authenticated (0060) and no policies at all, so a new column on it
-- is unreachable by any client by construction rather than by a fresh revoke.
-- Verified rather than assumed — see tests/rls/admin-identity.test.ts, which
-- asserts the table refuses both roles outright.
