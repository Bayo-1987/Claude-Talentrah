-- 0112: record that a user DECLINED onboarding, which nothing recorded before.
--
-- ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
--
-- Three entry points reach the app, and all three routed wrongly:
--
--   signUpAction          -> /onboarding                        correct
--   OAuth + Google OneTap -> /onboarding on EVERY sign-in        re-nags forever
--   signInAction          -> /jobs, unconditionally              never onboards
--
-- The last one is the reported bug: an account whose confirmation link did not
-- cleanly land (Gmail prefetching the link, a second device, a closed tab)
-- falls back to the ordinary sign-in form and skips onboarding permanently,
-- with no route back to the only screen that uploads a resume. Confirmed on
-- production against info@talentrah.com, which reached /employer with zero
-- rows in `resumes` and never saw /onboarding.
--
-- The first two are the inverse defect, found while investigating: /onboarding
-- only bounces a visitor who HAS a base resume, so anyone who clicked "Skip
-- for now" sees the upload screen again on every single OAuth sign-in.
--
-- ── WHY A COLUMN, WHEN onboarding/page.tsx ARGUES AGAINST ONE ─────────────
--
-- That file says, correctly: "The check is a base resume, not a profile flag,
-- because a base resume is the thing onboarding exists to produce — a flag
-- would be a second source of truth that can disagree with it."
--
-- This column does not contradict that, because it answers a DIFFERENT
-- question. The resume answers "did onboarding produce anything?". This
-- answers "was the offer made and declined?" — a fact no row anywhere carried,
-- and the reason resume-existence alone cannot drive the redirect: "skipped on
-- purpose" and "never got here" are both "no base resume", and they need
-- opposite treatment.
--
-- So it is written ONLY by the skip button, never by resume creation. The two
-- facts are independent and cannot disagree; the page redirects on either.
--
-- Shape and grant copied from `farah_hint_dismissed_at` (0066) and
-- `resume_skills_notice_dismissed_at` (0072): a nullable timestamp the user
-- may set for themselves. Self-setting only silences your own prompt, so it
-- carries no money, trust or identity. If it ever gates something of value,
-- it must move out of the client-writable list first.

alter table public.profiles
  add column onboarding_skipped_at timestamptz;

comment on column public.profiles.onboarding_skipped_at is
  'When the user chose "Skip for now" on /onboarding. Records that the offer was made and declined — NOT whether they have a resume, which resumes.is_base answers. /onboarding bounces on either. Deliberately NOT backfilled: see 0112 for the scale-dependent reasoning.';

-- ── ADDITIVE GRANT ONLY. Do not re-state the list. ────────────────────────
--
-- 0030 revoked table-level UPDATE on `profiles` and re-granted a named column
-- list, so a column added later is withheld by default and needs exactly this
-- one statement to become writable.
--
-- It must stay one statement. Re-asserting the whole list "for documentation"
-- is what silently dropped 0085's four salary columns from `job_postings`
-- during another migration's first draft — the revoke lands, the stale list
-- re-grants less than was there, and an employer loses a field with no error
-- anywhere. Add the column you are responsible for; touch nothing else.
grant update (onboarding_skipped_at) on public.profiles to authenticated;

-- ── NO BACKFILL, AND WHY THAT FLIPS AT SCALE ──────────────────────────────
--
-- Every existing row keeps NULL, so every account without a base resume sees
-- /onboarding once on its next sign-in, then never again once it answers.
--
-- The alternative — backfill every existing row as "skipped" so nobody is
-- re-prompted — was considered and rejected ON THE NUMBERS AT THE TIME, not
-- on principle. Production held 8 profiles: 4 with a base resume, 4 without,
-- and only ONE of those 4 showed any activity — info@talentrah.com, the exact
-- account this bug stranded. Backfilling would have permanently silenced
-- onboarding for the one account that demonstrates the problem, in order to
-- spare 3 dormant accounts a single screen with a Skip button on it.
--
-- THIS REASONING INVERTS WITH SCALE, and a future reader should not have to
-- re-derive that. At tens of thousands of profiles the population being
-- re-prompted is real users who legitimately skipped long ago, the stranded
-- accounts are a rounding error, and the right move is the opposite one:
--
--     update public.profiles set onboarding_skipped_at = created_at
--      where onboarding_skipped_at is null;
--
-- run BEFORE shipping the sign-in gate, so nobody is re-prompted at all. The
-- threshold is not a number this migration can name — it is "when the count of
-- long-dormant resume-less accounts stops being small enough to eyeball".
