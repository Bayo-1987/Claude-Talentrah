-- 0161 — mentorship (and related) performance hardening: unindexed foreign
-- keys on the mentorship migration batch, plus the project-wide
-- auth_rls_initplan sweep (auth.uid() -> (select auth.uid())) in full.
--
-- Numbered 0161 deliberately: `list_migrations` on both
-- dozaffzgqkbarxtlclsj and nytwbbzfpytctjsoczzq showed BOTH already carry two
-- different migrations recorded as `0160` (`0160_supabase_hardening_batch`
-- and `0160_atomic_referral_reward_grant`, from two other concurrent
-- sessions/branches) — the exact renumbering collision CLAUDE.md and 0149's
-- own header describe as an accepted, expected class of issue here. 0161 is
-- clear of every version visible in either project's ledger at the time this
-- was written.
--
-- ── PART 1: UNINDEXED FOREIGN KEYS, MENTORSHIP BATCH ONLY ──────────────────
--
-- Scope here is deliberately narrower than Part 2: this fixes the pattern
-- everywhere it appears WITHIN the mentorship migration batch (0132-0133,
-- 0148-0149), not every unindexed FK project-wide (get_advisors currently
-- shows 52 of those; the other 46 are a separate cleanup, out of this PR's
-- single-purpose scope). Audited the whole batch, not just 0133:
--   - 0132_mentorship_enum_values.sql: two enum values only, no tables.
--   - 0133_mentorship_marketplace.sql: mentor_profiles, mentor_availability_
--     slots, mentorship_sessions, mentorship_reviews — the gap is here.
--   - 0148_mentorship_session_reminders.sql: adds mentorship_sessions.
--     reminder_sent_at plus its own supporting partial index
--     (mentorship_sessions_reminder_pending_idx) — no new FK, no gap.
--   - 0149_mentor_payouts.sql: mentor_payouts.mentor_id and .session_id are
--     ALREADY covered (mentor_payouts_mentor_id_idx, and session_id's own
--     UNIQUE constraint) — this migration got it right the first time,
--     which is why get_advisors does not flag it.
--
-- That leaves exactly six FK columns, matching get_advisors(performance)'s
-- own `unindexed_foreign_keys` findings for these four tables one-for-one:
create index mentor_availability_slots_mentor_id_idx
  on public.mentor_availability_slots (mentor_id);

create index mentor_profiles_reviewed_by_idx
  on public.mentor_profiles (reviewed_by);

create index mentorship_reviews_mentor_id_idx
  on public.mentorship_reviews (mentor_id);

create index mentorship_reviews_reviewer_id_idx
  on public.mentorship_reviews (reviewer_id);

create index mentorship_sessions_mentee_id_idx
  on public.mentorship_sessions (mentee_id);

create index mentorship_sessions_mentor_id_idx
  on public.mentorship_sessions (mentor_id);

comment on index public.mentor_availability_slots_mentor_id_idx is
  'Covers mentor_availability_slots_mentor_id_fkey — a mentor''s own availability list and the booking-visibility policy''s EXISTS subquery both filter on mentor_id (0161, unindexed_foreign_keys advisor finding).';

comment on index public.mentor_profiles_reviewed_by_idx is
  'Covers mentor_profiles_reviewed_by_fkey (0161, unindexed_foreign_keys advisor finding).';

comment on index public.mentorship_reviews_mentor_id_idx is
  'Covers mentorship_reviews_mentor_id_fkey — a mentor''s own review list (0161, unindexed_foreign_keys advisor finding).';

comment on index public.mentorship_reviews_reviewer_id_idx is
  'Covers mentorship_reviews_reviewer_id_fkey (0161, unindexed_foreign_keys advisor finding).';

comment on index public.mentorship_sessions_mentee_id_idx is
  'Covers mentorship_sessions_mentee_id_fkey — a mentee''s own session list, a real user-facing dashboard query (0161, unindexed_foreign_keys advisor finding).';

comment on index public.mentorship_sessions_mentor_id_idx is
  'Covers mentorship_sessions_mentor_id_fkey — a mentor''s own session list, a real user-facing dashboard query (0161, unindexed_foreign_keys advisor finding).';

-- ── PART 2: auth_rls_initplan, PROJECT-WIDE, ALL 17 CURRENT FINDINGS ───────
--
-- Pulled fresh via get_advisors(performance) on both projects immediately
-- before writing this migration (both show the identical 17), then
-- cross-checked each one's *actual current* qual/with_check text directly
-- from pg_policies (not reconstructed from migration files, several of which
-- have been superseded by later "fix" migrations) to make sure every rewrite
-- below is purely mechanical: the exact same boolean expression, with every
-- bare `auth.uid()` — including occurrences nested inside an EXISTS
-- subquery — wrapped as `(select auth.uid())`. auth.uid() is STABLE, so this
-- changes nothing about WHAT any policy evaluates to, only that Postgres
-- resolves it once via initPlan instead of once per row. Verified this holds
-- for every policy below by reading each one individually rather than
-- assuming it — none of the 17 do anything beyond plain equality/EXISTS
-- checks against auth.uid(), so none needed special-casing.
--
-- `(select auth.uid())` — not `(select (auth.uid()))` or any other spelling
-- — matches this repo's own established convention throughout
-- 0000_baseline_schema.sql, 0026, 0033, 0047, 0052/0095/0109, and 0114/0126:
-- every one of those already wraps auth.uid() this way, including inside
-- EXISTS subquery bodies (0026's own `m.user_id = (select auth.uid())`
-- pattern is exactly what's followed here for mentorship_reviews' EXISTS
-- clause below).
--
-- Uses ALTER POLICY rather than DROP + CREATE for all seventeen: only the
-- USING/WITH CHECK expression changes, so this preserves the policy's name,
-- command, and role list exactly, with nothing to accidentally recreate
-- differently.

-- feedback (0067's own table) — INSERT, with_check only.
alter policy "users can file their own feedback"
  on public.feedback
  with check (user_id = (select auth.uid()));

-- job_posting_reports — INSERT, with_check only.
alter policy "seekers can report a posting once"
  on public.job_posting_reports
  with check (reporter_id = (select auth.uid()));

-- user_notifications — SELECT (using only) and UPDATE (using + with check).
alter policy "user notifications are owner-readable"
  on public.user_notifications
  using (user_id = (select auth.uid()));

alter policy "user notifications are owner-updatable"
  on public.user_notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- mentor_profiles (0133) — SELECT, INSERT, UPDATE.
-- Policy name is stored truncated at Postgres's 63-byte identifier limit —
-- using the exact name pg_policies returns, not the full name from 0133's
-- own `create policy` statement.
alter policy "mentor profiles are approved-and-public, or visible to the ment"
  on public.mentor_profiles
  using (status = 'approved'::text or user_id = (select auth.uid()));

alter policy "a user can apply to become a mentor for themselves, pending onl"
  on public.mentor_profiles
  with check (user_id = (select auth.uid()) and status = 'pending'::text);

alter policy "a mentor can edit their own profile row"
  on public.mentor_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- mentor_availability_slots (0133) — SELECT, INSERT, DELETE.
-- Same truncated-name situation as above for the SELECT policy.
alter policy "availability is visible for approved mentors, or to the mentor "
  on public.mentor_availability_slots
  using (
    mentor_id = (select auth.uid())
    or exists (
      select 1 from public.mentor_profiles mp
      where mp.user_id = mentor_availability_slots.mentor_id and mp.status = 'approved'::text
    )
  );

alter policy "a mentor posts their own open slots"
  on public.mentor_availability_slots
  with check (mentor_id = (select auth.uid()));

alter policy "a mentor removes their own still-open slots"
  on public.mentor_availability_slots
  using (mentor_id = (select auth.uid()) and is_booked = false);

-- mentorship_sessions (0133) — SELECT, UPDATE.
alter policy "a session is readable by either party"
  on public.mentorship_sessions
  using (mentor_id = (select auth.uid()) or mentee_id = (select auth.uid()));

alter policy "either party can update their own session row"
  on public.mentorship_sessions
  using (mentor_id = (select auth.uid()) or mentee_id = (select auth.uid()))
  with check (mentor_id = (select auth.uid()) or mentee_id = (select auth.uid()));

-- mentorship_reviews (0133) — INSERT, with_check only. Two bare auth.uid()
-- calls in the original: reviewer_id at the top level, and s.mentee_id
-- inside the EXISTS subquery — both wrapped, per the 0026 precedent cited
-- above.
alter policy "a mentee may review their own COMPLETED session, once"
  on public.mentorship_reviews
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.mentorship_sessions s
      where s.id = mentorship_reviews.session_id
        and s.mentee_id = (select auth.uid())
        and s.status = 'completed'::text
        and s.mentor_id = mentorship_reviews.mentor_id
    )
  );

-- talent_portfolio_items (0135) — ALL, using + with check.
alter policy "a user manages their own portfolio items"
  on public.talent_portfolio_items
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- talent_verifications (0135) — SELECT, using only.
alter policy "a user reads their own verification history"
  on public.talent_verifications
  using (user_id = (select auth.uid()));

-- talent_directory_boosts (0147) — SELECT, using only.
alter policy "a user reads their own boost history"
  on public.talent_directory_boosts
  using (user_id = (select auth.uid()));

-- talent_directory_contact_requests — the one 0160 left outstanding on
-- purpose (see 0160_supabase_hardening_batch.sql's own header: "still calls
-- auth.uid() directly... see this migration's header note on the separate
-- auth_rls_initplan cleanup this table still needs"). Consolidated by 0160
-- into one OR'd policy already; this migration only wraps the auth.uid()
-- call, changing nothing about who can read what. `is_org_member(...)` is a
-- function call, not auth.uid() — left untouched.
alter policy "candidates and org members read their own directory contact req"
  on public.talent_directory_contact_requests
  using (candidate_id = (select auth.uid()) or public.is_org_member(organization_id));

comment on policy "candidates and org members read their own directory contact req" on public.talent_directory_contact_requests is
  'Consolidates the two permissive SELECT policies 0155 created (0160, multiple_permissive_policies) with auth.uid() wrapped in a select (0161, auth_rls_initplan) — same access rule as 0155/0160, evaluated once per query instead of once per row.';
