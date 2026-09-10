-- 0129 — "Claim your listing": the dismiss control, the functions, and
-- reconciling a genuine numbering collision.
--
-- ── THE COLLISION, STATED PLAINLY ─────────────────────────────────────────
--
-- While building 0128, `nytwbbzfpytctjsoczzq` (production) and
-- `dozaffzgqkbarxtlclsj` (CI) turned out to already carry a migration named
-- `0128_claimable_job_postings` — applied directly through the MCP
-- connector by a different, earlier session working the same task, never
-- committed to this repo as a `.sql` file (checked: no ref in `git log --all`
-- mentions it or `claimed_by_organization_id`). Per this file's own
-- `supabase/migrations/README.md`, `0128` was free when this session looked;
-- the other session's apply landed first. Per that same README's own
-- precedent (0060/0061's collision, 0071's dead ledger rows): renumbering
-- after an apply is survivable, and an applied migration is history that
-- does not get rewritten — so `0128_claim_your_listing.sql` stays exactly as
-- applied, and this migration reconciles forward rather than editing it.
--
-- What each project actually had, confirmed by querying `information_schema`
-- and `pg_proc`/`pg_policy` directly rather than assumed from the ledger name
-- (this repo's own standing rule: a name in `schema_migrations` says nothing
-- about content):
--
--   production   `job_postings.claimed_by_organization_id`/`claimed_at`
--                (identical FK/type to 0128's own), the INSERT policy
--                already extended with both columns, AND
--                `organizations.claim_review_dismissed_at` (already granted
--                UPDATE to `authenticated`) — but NO index, NONE of the four
--                functions 0128 defines, and the OLD `preserve_job_posting_
--                removal` (no claim-marker-clearing branch).
--
--   CI           `organizations.claim_review_dismissed_at` only. The
--                job_postings side had NOT landed there yet — confirmed by
--                this session's own 0128 apply succeeding with no
--                "column already exists" error, which it would have raised
--                otherwise.
--
-- So `claim_review_dismissed_at` is not invented here — it already existed
-- on both real projects, with a real grant and a real comment on production
-- explaining it: "When this org dismissed the 'claim your postings' review
-- banner without acting on it." That is worth having — the same "don't nag
-- forever" shape as `profiles.farah_hint_dismissed_at` (0066) and
-- `resume_skills_notice_dismissed_at` (0072) — so this migration adopts it
-- rather than reinventing an equivalent column under a different name, and
-- the application code (Jobs Posted's nudge banner, `dismissClaimReviewAction`
-- in `src/lib/employer/actions.ts`) is built against it.
--
-- ── WHY EVERY STATEMENT BELOW IS IDEMPOTENT ────────────────────────────────
--
-- This one migration has to produce the SAME end state on three different
-- starting points: production (has the columns+policy, missing the rest),
-- CI (has the org column, missing everything on job_postings — though 0128
-- already supplied it there in this session's own run), and a from-scratch
-- database built by replaying every migration in this directory in order
-- (which will have run 0128 in full immediately before this one, with
-- NEITHER `claim_review_dismissed_at` nor a chance to already carry it).
-- `if not exists` / `create or replace` / a plain re-`grant` make every
-- statement here a safe no-op wherever its target already exists, and real
-- work wherever it doesn't — there is no environment-specific branch.

alter table public.organizations
  add column if not exists claim_review_dismissed_at timestamptz;

comment on column public.organizations.claim_review_dismissed_at is
  'When this org dismissed the "claim your postings" review banner without acting on it (0128/0129). Employer-writable (see grant below) — purely UI state, decides nothing about any job_postings row.';

-- Additive, not a table-level revoke+re-grant: Postgres column grants are
-- independent statements, so this widens `organizations`' authenticated
-- UPDATE surface by exactly one column without touching 0028/0116/0120's
-- existing list, the same shape 0066's own header describes for
-- `profiles.farah_hint_dismissed_at`. Carries no trust, money or identity —
-- it is UI-only, per the comment above — so a direct grant is the correct
-- call, not a service-role-only column.
grant update (claim_review_dismissed_at) on public.organizations to authenticated;

-- Missing on production, already present on CI/fresh-after-0128 — `if not
-- exists` makes this a no-op wherever it already ran.
create index if not exists job_postings_claimed_by_organization_id_idx
  on public.job_postings (claimed_by_organization_id) where claimed_by_organization_id is not null;

-- ── THE FOUR FUNCTIONS AND THE TRIGGER FIX, IDENTICAL TO 0128 ─────────────
--
-- Missing entirely on production (the other session's apply never reached
-- them); already present, byte-for-byte, on CI and on a from-scratch
-- database via 0128. `create or replace` makes re-declaring an identical
-- body on those two a harmless no-op — see 0128_claim_your_listing.sql for
-- the full design reasoning behind each of these; nothing about the design
-- changes here, only where it lands.

create or replace function public.job_posting_external_host(p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_url is null then null
    else nullif(lower(regexp_replace(p_url, '^https?://(www\.)?([^/]+)(/.*)?$', '\2')), '')
  end;
$$;

comment on function public.job_posting_external_host(text) is
  'Lowercased hostname of an external_url, www-stripped, or null. Used to compare an external posting''s source against an organisation''s verified domain — the high-confidence claim signal.';

create or replace function public.normalize_company_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '', 'g')), '');
$$;

comment on function public.normalize_company_name(text) is
  'Lowercased, punctuation/whitespace-stripped company name, for a weak equality match. Deliberately crude — false negatives (missed matches) are fine here, since claiming is always human-confirmed; false positives are the risk, so this is exact-equality only, never fuzzy/substring.';

create or replace function public.job_posting_claim_candidates(p_organization_id uuid)
returns table (
  id uuid,
  title text,
  location text,
  company_name text,
  external_url text,
  external_source text,
  posted_at timestamptz,
  confidence text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.id,
    j.title,
    j.location,
    j.company_name,
    j.external_url,
    j.external_source,
    j.posted_at,
    case
      when o.domain is not null and public.job_posting_external_host(j.external_url) = o.domain
        then 'domain'
      else 'name'
    end as confidence
  from public.job_postings j
  join public.organizations o on o.id = p_organization_id
  where j.source_type = 'external'
    and j.status = 'open'
    and j.claimed_by_organization_id is null
    and (
      (o.domain is not null and public.job_posting_external_host(j.external_url) = o.domain)
      or public.normalize_company_name(j.company_name) = public.normalize_company_name(o.name)
    )
  order by
    (o.domain is not null and public.job_posting_external_host(j.external_url) = o.domain) desc,
    j.posted_at desc
  limit 25;
$$;

comment on function public.job_posting_claim_candidates(uuid) is
  'External, open, unclaimed postings that might belong to this organisation — domain-hostname match (confidence=domain) or normalised company-name match (confidence=name, weaker). A suggestion list; nothing here claims anything.';

revoke all on function public.job_posting_claim_candidates(uuid) from public, anon;
grant execute on function public.job_posting_claim_candidates(uuid) to authenticated, service_role;

create or replace function public.claim_external_job_posting(
  p_organization_id uuid,
  p_external_job_posting_id uuid,
  p_title text,
  p_description text,
  p_location text
)
returns table (ok boolean, reason text, job_posting_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
  v_ext record;
  v_new_id uuid;
  v_domain_match boolean;
  v_name_match boolean;
  v_title text;
  v_description text;
  v_location text;
begin
  select id, name, verified, domain into v_org
  from public.organizations
  where id = p_organization_id;

  if not found then
    return query select false, 'org_not_found'::text, null::uuid; return;
  end if;
  if not v_org.verified then
    return query select false, 'org_not_verified'::text, null::uuid; return;
  end if;

  select * into v_ext
  from public.job_postings
  where id = p_external_job_posting_id and source_type = 'external'::public.job_source_type
  for update;

  if not found then
    return query select false, 'not_found'::text, null::uuid; return;
  end if;
  if v_ext.status = 'removed'::public.job_status or v_ext.claimed_by_organization_id is not null then
    return query select false, 'already_claimed'::text, null::uuid; return;
  end if;

  v_domain_match := v_org.domain is not null
    and public.job_posting_external_host(v_ext.external_url) = v_org.domain;
  v_name_match := public.normalize_company_name(v_ext.company_name) = public.normalize_company_name(v_org.name);

  if not (v_domain_match or v_name_match) then
    return query select false, 'not_a_match'::text, null::uuid; return;
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  v_description := nullif(btrim(coalesce(p_description, '')), '');
  v_location := nullif(btrim(coalesce(p_location, '')), '');
  if v_title is null then
    return query select false, 'title_required'::text, null::uuid; return;
  end if;
  if v_description is null or length(v_description) < 40 then
    return query select false, 'description_too_short'::text, null::uuid; return;
  end if;

  insert into public.job_postings (
    source_type, organization_id, title, company_name, company_logo_url,
    location, work_type, employment_type, seniority, years_experience_min,
    description, structured_jd, status, posted_at,
    salary_min, salary_max, salary_currency, salary_unit,
    dedup_fingerprint
  ) values (
    'internal'::public.job_source_type, p_organization_id, v_title, v_org.name, null,
    v_location, v_ext.work_type, v_ext.employment_type, v_ext.seniority, v_ext.years_experience_min,
    v_description, '{}'::jsonb, 'open'::public.job_status, now(),
    v_ext.salary_min, v_ext.salary_max, v_ext.salary_currency, v_ext.salary_unit,
    'claimed:' || v_ext.id::text
  )
  returning id into v_new_id;

  update public.job_postings
  set status = 'removed'::public.job_status,
      removed_at = now(),
      removal_reason = 'Claimed by ' || v_org.name || '. A new listing now represents this role.',
      claimed_by_organization_id = p_organization_id,
      claimed_at = now()
  where id = v_ext.id;

  return query select true, 'ok'::text, v_new_id;
end;
$$;

comment on function public.claim_external_job_posting(uuid, uuid, text, text, text) is
  'Creates a new internal job_postings row owned by p_organization_id and marks the external source row removed+claimed, atomically. Never mutates job_postings_internal_has_org''s boundary and never touches an existing applications row. SECURITY DEFINER, service_role only — p_organization_id must already be resolved from the caller''s own session (requireEmployer()), the same trust boundary auto_apply_claim_submission (0034) documents for p_user_id.';

revoke all on function public.claim_external_job_posting(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_external_job_posting(uuid, uuid, text, text, text) to service_role;

-- The restore-clears-claim-marker fix (see 0128's own header, "AN ADMIN
-- RESTORE MUST NOT LEAVE A STALE CLAIM MARKER"). Production still had the
-- pre-0128 trigger body (no elsif branch) because its own apply of
-- `0128_claimable_job_postings` never reached this function; CI and a
-- from-scratch database already have it from 0128, so this is a no-op there.
create or replace function public.preserve_job_posting_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'removed'::public.job_status
     and new.status is distinct from 'removed'::public.job_status
     and new.removed_at is not null
  then
    raise notice 'job_posting % stayed removed: an update tried to set status=% without clearing removed_at', old.id, new.status;
    new.status := old.status;
    new.removed_at := old.removed_at;
    new.removal_reason := old.removal_reason;
  elsif old.status = 'removed'::public.job_status
        and new.status is distinct from 'removed'::public.job_status
        and new.removed_at is null
  then
    new.claimed_by_organization_id := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

-- ── A SELF-CHECK, GIVEN HOW THIS MIGRATION CAME TO EXIST ──────────────────
--
-- The whole reason this file exists is that a ledger name was once trusted
-- to mean more than it did. Assert the reconciled state directly rather than
-- assuming it, on both tables this migration touches.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations'
      and column_name = 'claim_review_dismissed_at'
  ) then
    raise exception 'organizations.claim_review_dismissed_at did not land.';
  end if;
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'claim_external_job_posting'
  ) then
    raise exception 'claim_external_job_posting did not land.';
  end if;
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'job_posting_claim_candidates'
  ) then
    raise exception 'job_posting_claim_candidates did not land.';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'job_postings'
      and indexname = 'job_postings_claimed_by_organization_id_idx'
  ) then
    raise exception 'job_postings_claimed_by_organization_id_idx did not land.';
  end if;
end $$;
