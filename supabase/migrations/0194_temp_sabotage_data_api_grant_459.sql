-- TEMPORARY — send-459's own proof that tests/rls/data-api-grants.test.ts
-- actually catches a regression, not a migration meant to stay. Simulates
-- exactly the failure mode the test exists to prevent: a later migration
-- accidentally revoking one of 0192's grants. Deleted once CI confirms the
-- new test fails for the right reason; a follow-up commit with no sabotage
-- file proves it then passes.
revoke select on public.country_default_events from authenticated;
