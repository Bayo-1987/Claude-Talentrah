-- 0080 — a generic feature-flag table, and the permission that governs it.
--
-- Built as a primitive rather than a boolean for one feature. The immediate
-- need is the job-match digest, which measured ~40% of users receiving an
-- empty digest at current job-supply volume — so it ships switched off and is
-- turned on when supply justifies it, rather than being held out of main. More
-- flags are expected; a table costs the same as a column and the second one
-- costs nothing.
--
-- ── SPLIT ACROSS TWO MIGRATIONS, AND WHY ─────────────────────────────────
--
-- Postgres refuses to USE a new enum value in the transaction that ADDS it
-- (55P04). So this file adds `feature_flags` to admin_permission and creates
-- the table; 0081 grants the permission and creates the function whose body
-- names it. Same split, same reason, as 0077/0078 did for `blog`.
--
-- ── DEFAULT OFF, IN THE COLUMN AND IN THE SEED ───────────────────────────
--
-- `enabled boolean not null default false` is not a formality. A flag exists
-- because somebody is unsure whether a thing should be live; the state that
-- needs a decision is ON, so OFF is what a flag should be when nobody has
-- decided yet. A row created by a future migration that forgets to say is off.

alter type public.admin_permission add value 'feature_flags';

create table public.feature_flags (
  -- The key the code checks. Text, not an enum: a flag's whole point is to be
  -- added and removed without ceremony, and an enum would make deleting one a
  -- migration that rewrites a type.
  key text primary key,
  -- What an operator sees. The key is for code; this is for the human deciding.
  label text not null,
  enabled boolean not null default false,
  /*
   * ON DELETE SET NULL, like every other admin attribution column here. The
   * record of what was switched on must outlive the account that switched it —
   * an operator leaving should not rewrite history, and a flag with a null
   * `updated_by` is honest about who is no longer around.
   */
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;
-- RLS on with NO policies, plus every privilege revoked — both, for the reason
-- tests/rls/admin-identity.test.ts spells out: a revoked privilege raises an
-- error, a policy matching no rows returns an empty array, and only one of
-- those is safe to mistake for the other. Reads happen through the service
-- role (the digest cron) and writes through 0081's function.

insert into public.feature_flags (key, label, enabled) values
  ('job_match_digest', 'Job-match digest emails', false);

comment on table public.feature_flags is
  'Admin-controlled switches for features that are built but not yet turned on. Read via the service role; written only through admin_set_feature_flag (0081), which checks the feature_flags permission in the same statement as the write.';
