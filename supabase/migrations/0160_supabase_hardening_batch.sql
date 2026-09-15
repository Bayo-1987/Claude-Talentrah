-- 0160 — three small, independent Supabase advisor findings, batched into one
-- migration because each is trivial and none depend on each other. Re-checked
-- `list_migrations` on both projects immediately before writing this: 0159
-- was the ceiling on dozaffzgqkbarxtlclsj, 0158 on production, 0160 was free
-- on both.
--
-- COORDINATION NOTE: a separate, parallel piece of work in this same window
-- is rewriting `auth.uid()` -> `(select auth.uid())` across RLS policies for
-- the `auth_rls_initplan` advisor finding, and its own scope explicitly
-- includes talent-directory tables. That work was told to wait for this
-- migration to land (on both projects) before touching
-- `talent_directory_contact_requests`, specifically to avoid two migrations
-- editing the same policy concurrently. Item 2 below intentionally does
-- ONLY the multiple-permissive-policies consolidation and preserves the
-- existing bare `auth.uid()` call from the original policy — it does NOT
-- also wrap it in `(select auth.uid())`, so that table still has exactly one
-- outstanding `auth_rls_initplan` finding for that other work to pick up.
--
-- ── 1. function_search_path_mutable: public.has_visible_characters ────────
--
-- Supabase's security advisor flags `public.has_visible_characters` (0045)
-- for a mutable search_path — it never pinned one. The function is `language
-- sql immutable`, not SECURITY DEFINER, and touches no tables, only
-- built-ins (btrim, regexp_replace, coalesce, length) — so the realistic
-- hijack risk is low, but an earlier schema on the caller's search_path
-- could still shadow one of those built-ins, and pinning costs nothing.
-- Re-created with `set search_path = public`, the exact pattern
-- `list_applied_migrations()` uses (0096) — same signature, same body,
-- same comment, so `create or replace` swaps in place with no functional
-- change and no need to touch the CHECK constraint that calls it.
create or replace function public.has_visible_characters(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  -- btrim of \s, then remove the Cf characters trim() misses. Non-empty means
  -- something is actually rendered.
  select length(
    regexp_replace(btrim(coalesce(value, '')), '[​‌‍⁠᠎﻿\s]', '', 'g')
  ) > 0;
$$;

comment on function public.has_visible_characters(text) is
  'True when the text renders at least one visible character. Mirrors visibleName() in src/lib/profile/name.ts — keep the codepoint list in sync with it (migration 0045). search_path pinned in 0160 (function_search_path_mutable advisor finding).';

-- ── 2. multiple_permissive_policies: talent_directory_contact_requests ────
--
-- 0155 added two permissive SELECT policies for `authenticated` on this
-- table: "a candidate reads requests addressed to them"
-- (`candidate_id = auth.uid()`) and "org members read their own org's sent
-- requests" (`public.is_org_member(organization_id)`). Postgres evaluates
-- multiple permissive policies for the same role/action as OR'd together,
-- so these were never actually independent gates — the effective, current
-- access rule is already "candidate OR org member". Consolidating into one
-- policy with an OR'd USING clause changes nothing about who can read what;
-- it only removes the redundant second policy evaluation per query. Neither
-- condition is a subset or special case of the other (a candidate is not
-- generally an org member of the requesting org, and vice versa), so this is
-- a straight performance consolidation, not a hidden semantic change.
drop policy if exists "a candidate reads requests addressed to them" on public.talent_directory_contact_requests;
drop policy if exists "org members read their own org's sent requests" on public.talent_directory_contact_requests;

create policy "candidates and org members read their own directory contact requests" on public.talent_directory_contact_requests
  for select to authenticated
  using (
    candidate_id = auth.uid()
    or public.is_org_member(organization_id)
  );

comment on policy "candidates and org members read their own directory contact requests" on public.talent_directory_contact_requests is
  'Consolidates the two permissive SELECT policies 0155 created (multiple_permissive_policies advisor finding, 0160) into one OR''d USING clause — Postgres already evaluated them as OR''d together, so this is a pure performance fix with no access-pattern change. Still calls auth.uid() directly (not wrapped in a select) — see this migration''s header note on the separate auth_rls_initplan cleanup this table still needs.';

-- ── 3. unused_index — investigated, NOTHING dropped ────────────────────────
--
-- get_advisors(performance) on dozaffzgqkbarxtlclsj currently flags 20
-- indexes as unused. Before dropping any of them, two checks:
--
-- (a) Row counts on dozaffzgqkbarxtlclsj for a sample of the flagged tables:
--     application_stage_events=9, payment_transactions=0, referral_shares=0,
--     scholarship_saves=15. This is the shared local-dev database (CLAUDE.md
--     — reused across every session working from this repo, seeded
--     inconsistently), not a production-scale dataset. On tables this small
--     Postgres's planner prefers a sequential scan regardless of which
--     indexes exist, so "never used" here is at least partly an artifact of
--     near-empty tables, not evidence the index is redundant.
--
-- (b) Cross-checked against get_advisors(performance) on the PRODUCTION
--     project (nytwbbzfpytctjsoczzq), which has real usage. Production's own
--     unused_index list has only a 8-item overlap with dozaffzgqkbarxtlclsj's
--     20: admin_sessions_admin_idx, course_recommendations_skill_idx,
--     email_preferences_digest_idx, feedback_status_idx,
--     feedback_triaged_by_idx, idx_country_default_events_analysis,
--     idx_farah_session_events_analysis, user_passes_pending_renewal_idx.
--     The other 12 dev-flagged indexes — both application_stage_events
--     indexes, both ad_campaigns indexes, admin_audit_log_created_idx,
--     blog_posts_published_idx, idx_resume_builder_start_events_analysis,
--     job_posting_reports_posting_idx, mentor_payouts_status_eligible_idx,
--     payment_transactions_user_id_idx, referral_shares_user_id_idx and
--     scholarship_saves_user_idx — are NOT in production's unused list,
--     meaning production itself has scanned them. Dropping any of those 12
--     here would remove an index real production traffic is using; none are
--     touched by this migration.
--
-- That leaves the 8-item intersection as the only indexes genuinely unused
-- on BOTH databases. Even those are deliberately left alone, each for a
-- specific, current reason rather than by default:
--
--   - admin_sessions_admin_idx — the admin dashboard "has started, at M1"
--     (CLAUDE.md): the route guard and identity model just landed, so the
--     number of real admin sessions logged anywhere is still tiny. Not a
--     dead feature, an early one.
--   - user_passes_pending_renewal_idx (0043) — supports the daily cron's
--     lookup of Passes stuck mid-renewal after an indeterminate Paystack
--     response. CLAUDE.md calls this cron "load-bearing for recovery" —
--     it is rare BY DESIGN (only a timed-out charge takes this path, and
--     most charges resolve immediately), not unused because it's obsolete.
--   - email_preferences_digest_idx (0083) — a partial index for the digest
--     cron sweep, not the per-request hot path; still the reference pattern
--     0148 (2026-09-10, mentorship session reminders) explicitly cites by
--     name for its own new digest-style index, i.e. actively-maintained
--     infrastructure, not a stale leftover.
--   - idx_farah_session_events_analysis (0097, 2026-09-05) and
--     idx_country_default_events_analysis (0091, 2026-09-04) — both named
--     "_analysis": built for periodic/ad-hoc reporting queries, not
--     per-request reads, on tables that only started filling in the last
--     ~10 days. An index built for a report nobody has run yet looks
--     identical to a redundant one; the naming and recency both point at
--     the former.
--   - course_recommendations_skill_idx (0061), feedback_status_idx and
--     feedback_triaged_by_idx (0065) — all three back an operator/admin
--     triage queue. Same reasoning as admin_sessions_admin_idx: the tooling
--     to actually drive that queue at volume is new and still being built
--     out (admin M1), so low query volume here reflects the surface's age,
--     not redundancy.
--
-- Net result: zero indexes dropped in this migration. If a future advisor
-- pull still shows all or most of these same 8 as unused on PRODUCTION once
-- the admin dashboard (M2+) and these analytics/cron paths have had real
-- runway, that is the point to revisit dropping them — not now, and not by
-- reasoning from the dev database's near-empty tables alone.
