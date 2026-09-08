-- 0114: close two INSERT-side trust holes, live on production today.
--
-- RENAMED FROM 0113 TO 0114: this migration and `0113_storage_usage_reader.sql`
-- (PR #291) were built concurrently in two separate sessions and both
-- independently claimed `0113` — the same numbering-collision class this
-- repo has hit before (0060/0061, 0103/0104, 0106/0107, and 0110/0111 twice
-- in one afternoon). #291 merged first and had already been applied to
-- production before this was caught, so it keeps `0113`; this one renames to
-- the next free number. This migration itself had NOT been applied to any
-- live database under the name `0113` before the rename, so — like 0111's
-- own rename — there is no already-applied `schema_migrations` row left
-- permanently mismatched.
--
-- CONSEQUENCE FOR THE HELD BRANCHES: the CAC verification branch (#286) had
-- already drafted its own `0114_employer_cac_verification.sql`, numbered
-- before this collision existed. That file will need to move to `0115` (or
-- later) during its own rebase, on top of the extend-not-re-declare rework
-- it already needed because of this hotfix. Flagging here so it is not a
-- second surprise on top of the first.
--
-- ── WHY THIS IS ITS OWN MIGRATION, AHEAD OF THE FEATURES THAT FOUND IT ────
--
-- Both holes below were found while building `organizations.cac_number`
-- (draft migration `0114`, employer CAC verification) and `job_postings.
-- admin_review_decision` (draft migration `0116`, Path 3 individual review).
-- Both of those migrations are held on their own branches for founder review
-- of unrelated BUSINESS decisions (which verification tiers to add, what an
-- admin queue looks like) — decisions that have nothing to do with whether
-- these two holes stay open in the meantime. They are exploitable right now,
-- independent of either feature ever shipping, so they are fixed here, on
-- `main`, today. Same reasoning that put the digest fix (PR #285) and the
-- Auto-Apply queue fix (PR #289) ahead of the bigger work that found them.
--
-- This is a HOTFIX, re-scoped to what `main` actually has. `0114`'s own
-- `organizations` fix additionally required `cac_confirmed_at is null and
-- cac_confirmed_by is null`; `0116`'s own `job_postings` fix additionally
-- required `admin_review_decision is null and admin_reviewed_at is null and
-- admin_reviewed_by is null`. None of those six columns exist on `main` yet —
-- only on their own held branches — so this migration constrains exactly the
-- columns that exist today and no others. When `0114`/`0116` land, each
-- extends the relevant policy this migration creates (ANDs its own columns
-- onto what already exists) rather than re-declaring the whole `with check`
-- from scratch — the same "add incrementally, don't re-issue" principle this
-- repo's own migrations already apply to column grants (see `0114`'s and
-- `0116`'s own draft headers, and 0107's postscript on how re-stating a list
-- silently dropped 0085's salary columns).
--
-- ── HOLE 1: `organizations` INSERT never constrained any column value ─────
--
-- Confirmed live against production before writing this fix:
--
--   select pg_get_expr(polwithcheck, polrelid)
--     from pg_policy
--    where polrelid = 'public.organizations'::regclass
--      and polname = 'authenticated users can create an organization';
--   -- (created_by = ( SELECT auth.uid() AS uid))
--
-- `0028` locked `verified` against UPDATE by revoking table-level UPDATE and
-- re-granting a named column list — but it only ever touched UPDATE.
-- Supabase's default INSERT privilege is table-wide, not column-scoped, and
-- nothing before this migration constrained INSERT at all. From a fresh
-- authenticated session:
--
--   insert into organizations (name, created_by, verified)
--   values ('Anything', auth.uid(), true)
--
-- succeeds today and returns `verified: true` — the exact self-verification
-- `0028` exists to prevent, reachable the whole time through the row's
-- creation instead of its update.
--
-- ── HOLE 2: `job_postings`' internal-posting INSERT never constrained its
--    own trust columns either ─────────────────────────────────────────────
--
-- Confirmed live against production before writing this fix:
--
--   select pg_get_expr(polwithcheck, polrelid)
--     from pg_policy
--    where polrelid = 'public.job_postings'::regclass
--      and polname = 'org members can manage their org''s internal postings';
--   -- ((source_type = 'internal'::job_source_type) AND is_org_member(organization_id))
--
-- `0056` added `removed_at`/`removal_reason`/`removed_by` and `0107` added
-- `unlisted_at`, both withheld from the `authenticated` UPDATE grant — but,
-- same root cause as Hole 1, neither ever touched INSERT. An org member can
-- insert their OWN new posting today, pre-stamped:
--
--   insert into job_postings (
--     source_type, organization_id, title, description, structured_jd,
--     status, dedup_fingerprint, unlisted_at, removed_at, removal_reason, removed_by
--   ) values (
--     'internal', <own org>, 'Role', 'Desc', '{}', 'open', gen_random_uuid()::text,
--     now(), now(), 'self-smuggled', auth.uid()
--   )
--
-- succeeds today, returning every one of those five values as given — a
-- self-fabricated moderation record with no admin ever involved, and a
-- self-minted unlisted link with no rate limit or confirmed-email check
-- behind it (see `0107`'s own header for what that check is supposed to be).
--
-- ── WHY `verified = false` (NOT ALSO CHECKING `created_by`'s OTHER FIELDS) ─
--
-- `created_by = auth.uid()` already exists and is unchanged — this migration
-- only ADDS the `verified = false` clause. `name`/`domain`/`logo_url`/
-- `description` carry no trust (0028 already leaves them freely
-- UPDATE-able), so constraining them at INSERT would protect nothing; only
-- `verified` does.
--
-- A normal insert never mentions `verified` (the column defaults to `false`),
-- so this passes unchanged for every real signup path in the codebase — only
-- an insert that explicitly smuggles `true` is newly refused.
drop policy "authenticated users can create an organization" on public.organizations;

create policy "authenticated users can create an organization"
  on public.organizations
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and verified = false
  );

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.organizations'::regclass
      and polname = 'authenticated users can create an organization'
      and pg_get_expr(polwithcheck, polrelid) ilike '%verified%'
  ) then
    raise exception
      'the organizations INSERT policy no longer mentions verified — the self-verification-at-insert fix was lost.';
  end if;
end $$;

-- All four columns are nullable with no non-null default, so a normal
-- posting creation (every real posting-creation path in the codebase today)
-- keeps passing this check unchanged — only an insert that explicitly
-- smuggles a non-null value into one of them is newly refused.
drop policy "org members can manage their org's internal postings" on public.job_postings;

create policy "org members can manage their org's internal postings"
  on public.job_postings
  for insert
  to authenticated
  with check (
    source_type = 'internal'::job_source_type
    and is_org_member(organization_id)
    and unlisted_at is null
    and removed_at is null
    and removal_reason is null
    and removed_by is null
  );

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.job_postings'::regclass
      and polname = 'org members can manage their org''s internal postings'
      and pg_get_expr(polwithcheck, polrelid) ilike '%unlisted_at%'
  ) then
    raise exception
      'the job_postings INSERT policy no longer constrains its trust columns — the self-smuggling-at-insert fix was lost.';
  end if;
end $$;
