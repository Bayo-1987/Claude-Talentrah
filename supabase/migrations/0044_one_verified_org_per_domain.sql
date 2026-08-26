-- 0044 — One VERIFIED organisation per work-email domain.
--
-- THE GAP. `createOrganizationAction` inserted with no check for an existing
-- organisation at the claimed domain, while the onboarding page's "joinable"
-- list only offers orgs where `verified = true`. So person A creates an org
-- that is not verified; person B at the same company signs up, sees an empty
-- joinable list, and creates a second org for the same domain. Colleagues end
-- up in disconnected companies, postings and analytics split between them, and
-- there is no merge path — one of the two owners can never reach their team.
--
-- Not yet fired in production (checked: zero domains with more than one org),
-- but unlike the dedup collision the TRIGGER STATE is already live — see below.
--
-- ---------------------------------------------------------------------------
-- Why this is NOT a bare `unique (domain)`
-- ---------------------------------------------------------------------------
-- The obvious constraint is actively harmful, and production already contains
-- the row that proves it.
--
-- "Fatishcakes" claims `fatishcakes.com` and was created by a **gmail.com**
-- user. `evaluateDomainVerification` requires the claimed domain to match the
-- creator's own confirmed email domain, so that organisation can NEVER become
-- verified. It occupies the domain permanently.
--
-- Under a bare unique constraint, the real employer at fatishcakes.com then
--   * cannot CREATE — the index rejects the insert, and
--   * cannot JOIN — `joinOrganizationAction` refuses any org that is not
--     verified.
-- They are locked out with no path forward at all, which is worse than the
-- duplicate the constraint was meant to prevent. It also turns domain squatting
-- into a one-line attack: sign up with any free mailbox, claim a company's
-- domain, and that company can never register.
--
-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
-- VERIFICATION IS WHAT ESTABLISHES A CLAIM ON A DOMAIN. That is precisely what
-- 0027 and 0028 exist for: an unverified org's postings never reach the public
-- feed, and no client can set `verified` itself. So a verified organisation
-- owns its domain and a second one is a genuine conflict; an unverified
-- organisation owns nothing and must not block anybody.
--
-- Consequences, all deliberate:
--   * two verified orgs at one domain — rejected, the case being fixed;
--   * a verified org created alongside an unverified one — ALLOWED, so the
--     real employer always has a route in past a squatter;
--   * two unverified orgs at one domain — allowed, because neither has a claim
--     and constraining it would only recreate the lock-out;
--   * orgs with a null domain — unconstrained, since `domain` is nullable and
--     plenty of organisations will never claim one.
--
-- `lower(domain)` rather than `domain`: `normalizeDomain` already lowercases,
-- so this changes nothing today. It is here so that a future path which writes
-- the column without going through that helper cannot open the gap again with
-- a case variant.

create unique index if not exists organizations_one_verified_per_domain_idx
  on public.organizations (lower(domain))
  where domain is not null and verified;

comment on index public.organizations_one_verified_per_domain_idx is
  'One VERIFIED org per domain. Unverified orgs are deliberately unconstrained: they have no claim on a domain (verification is the claim), and constraining them would let a consumer-mailbox squatter permanently lock a company out of registering — see 0044.';
