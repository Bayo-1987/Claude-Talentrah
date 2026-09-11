-- 0151 — closes the "wide-open ALL ON ALL TABLES grant, no covering RLS
-- policy" gap CLAUDE.md documents as this repo's own standing lesson
-- (0026/0027/0028/0030), and 0140/0145/0150 already closed one table at a
-- time. This migration is the systematic sweep those three asked for:
--
--   with rls_tables as (
--     select c.relname as table_name from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
--   ),
--   grants as (
--     select table_name, privilege_type from information_schema.table_privileges
--     where grantee = 'authenticated' and table_schema = 'public'
--       and privilege_type in ('INSERT','UPDATE','DELETE')
--   ),
--   policy_cmds as (select tablename as table_name, cmd from pg_policies where schemaname = 'public')
--   select g.table_name, g.privilege_type
--   from grants g join rls_tables t on t.table_name = g.table_name
--   left join policy_cmds p on p.table_name = g.table_name
--   group by g.table_name, g.privilege_type
--   having not bool_or(p.cmd = 'ALL' or (g.privilege_type = p.cmd));
--
-- Run against production, this returned ~23 tables. Every one below was
-- individually confirmed — not assumed from the query alone — to have NO
-- authenticated-client write path for the specific command being revoked,
-- via `grep -rn '.from("<table>")' src/` for every insert/update/delete call
-- site and tracing each to its Supabase client (createClient() = user
-- session, createServiceRoleClient() = service role). Two tables that
-- appeared in the sweep, `organizations` and `organization_members`, are
-- deliberately NOT here — see 0152's own header for why they need a code
-- change alongside their grant fix, not just a revoke.
--
-- Column grants, not just table grants: none of these commands has a
-- narrower "safe subset of columns" story the way profiles/mentor_profiles
-- do (0030, 0041) — every one below is either write-nothing from a client
-- at all, or a command the client never issues, so the whole command is
-- revoked outright rather than column-scoped.

-- ── Pure event/log/audit tables — always written by the server, never a
-- client, and nothing here is ever displayed back with write affordances ──
--
-- application_stage_events: written ONLY by log_application_stage_change(),
-- a SECURITY DEFINER trigger on `applications` (0000) — it inserts as the
-- function's owner, not as `authenticated`, so this revoke does not touch
-- it. Confirmed zero references to this table anywhere under src/.
revoke insert, update, delete on public.application_stage_events from authenticated;
-- country_default_events, credit_gate_events, farah_session_events,
-- resume_builder_start_events: each has exactly one write path
-- (src/lib/jobs/country-events.ts, src/lib/credits/gate-events.ts,
-- src/lib/farah/session-events.ts, src/lib/resume-builder/start-events.ts),
-- every one createServiceRoleClient() only.
revoke insert, update, delete on public.country_default_events from authenticated;
revoke insert, update, delete on public.credit_gate_events from authenticated;
revoke insert, update, delete on public.farah_session_events from authenticated;
revoke insert, update, delete on public.resume_builder_start_events from authenticated;
-- user_notifications: INSERT is service-role only
-- (src/lib/mentorship/notifications.ts, src/lib/notifications/proactive-match-alert/send.ts).
-- UPDATE is untouched — a real "mark my own notification read" policy
-- already exists and is out of this migration's scope. DELETE has no
-- covering policy and no client call site.
revoke insert, delete on public.user_notifications from authenticated;
-- talent_directory_boosts (0137): the whole lifecycle — creating a pending
-- boost, resolving it, deleting a stale pending row — is
-- runTalentDirectoryBoostPurchase (boost-runner.ts), service-role only.
-- src/lib/talent-directory/queries.ts reads this table via the session
-- client but only ever SELECTs it.
revoke insert, update, delete on public.talent_directory_boosts from authenticated;
-- user_template_unlocks: the only write (src/lib/resume-builder/actions.ts)
-- is an INSERT via createServiceRoleClient(); every other reference in
-- src/ is a SELECT (resume-builder/page.tsx, new/page.tsx, actions.ts's own
-- eligibility checks).
revoke insert, update, delete on public.user_template_unlocks from authenticated;
-- employer_applicant_status (0125/0126): DELETE has no covering policy and
-- no client call site. INSERT/UPDATE are untouched — a real policy already
-- covers setApplicantStatusAction's own upsert() through the session
-- client (src/lib/employer/actions.ts), which is what the missing DELETE
-- entry in the sweep result already implied (only DELETE showed up as a gap).
revoke delete on public.employer_applicant_status from authenticated;

-- ── Admin-managed read-only catalogs — same shape as talent_directory_plans
-- (0150): a public SELECT policy is the only policy that should ever exist,
-- and none of these three has ANY write call site anywhere in src/ ──
revoke insert, update, delete on public.credit_packs from authenticated;
revoke insert, update, delete on public.passes from authenticated;
revoke insert, update, delete on public.resume_templates from authenticated;

-- ── Money, credit and session-state tables — every write already goes
-- through a service-role path or a SECURITY DEFINER function; verified
-- per-table, not assumed from "it sounds like a money table" ──
--
-- credit_ledger: the only write (src/lib/credits/spend.ts) is
-- createServiceRoleClient() only — confirmed already, separately, by
-- tests/rls/cross-user.test.ts's own comment: "No owner INSERT policy on
-- these — service role, as in production."
revoke insert, update, delete on public.credit_ledger from authenticated;
-- payment_transactions: every write (src/lib/billing/{renewals,fulfill,actions}.ts,
-- src/lib/talent-directory/{renewals,subscription-actions}.ts,
-- src/lib/mentorship/actions.ts, src/lib/employer/wallet-actions.ts) is
-- service-role only — src/lib/billing/actions.ts even says so in its own
-- comment already ("Writes via service role: payment_transactions has no
-- authenticated...").
revoke insert, update, delete on public.payment_transactions from authenticated;
-- user_passes: every write (src/lib/billing/{renewals,fulfill}.ts) is
-- service-role only.
revoke insert, update, delete on public.user_passes from authenticated;
-- referrals: written ONLY by handle_new_user() (SECURITY DEFINER, fires on
-- signup) and grant_referral_reward()/check_and_activate_referral()
-- (both SECURITY DEFINER, confirmed live via pg_proc.prosecdef). The one
-- app-code reference (src/app/(app)/refer/page.tsx) is a SELECT of the
-- caller's own referrals.
revoke insert, update, delete on public.referrals from authenticated;
-- job_postings: DELETE only — src/lib/jobs/posting-deletion.ts is the one
-- call site, service-role only. INSERT/UPDATE are untouched; both already
-- have real, exercised policies (employer job posting, aggregation).
revoke delete on public.job_postings from authenticated;
-- scholarships: INSERT/DELETE — UPDATE is untouched (ingestion's own
-- moderation-status transitions already have a real policy, confirmed by
-- this same gap query not flagging UPDATE). Every write in
-- src/lib/scholarships/ingest.ts is service-role only, and there is no
-- INSERT or DELETE call site in application code at all — ingestion upserts
-- through the service role, and this repo's own moderation flow never
-- hard-deletes a scholarship.
revoke insert, delete on public.scholarships from authenticated;
-- mentorship_sessions (0133): INSERT/DELETE — UPDATE is untouched (real
-- policies already gate the notes columns and status transitions a party
-- can make, per tests/rls/mentorship.test.ts's own "column grants" block).
-- Session creation goes through book_mentor_session() (SECURITY DEFINER,
-- 0133); no INSERT or DELETE call site exists anywhere in src/.
revoke insert, delete on public.mentorship_sessions from authenticated;
-- mentor_profiles (0132): DELETE only. INSERT/UPDATE already have real,
-- tested policies (a mentor can apply and edit their own safe fields,
-- tests/rls/mentorship.test.ts) — untouched. There is no DELETE call site
-- anywhere in src/; a mentor listing is suspended (`status`), never
-- hard-deleted by a client.
revoke delete on public.mentor_profiles from authenticated;
-- mentor_availability_slots (0133): UPDATE only. INSERT/DELETE already have
-- real policies (a mentor manages their own slots) — untouched.
-- tests/rls/mentorship.test.ts's own existing test already asserts this
-- table "has no client UPDATE path at all — is_booked cannot be flipped
-- directly"; this closes the grant behind that claim rather than leaving it
-- resting on RLS's default-deny alone.
revoke update on public.mentor_availability_slots from authenticated;
