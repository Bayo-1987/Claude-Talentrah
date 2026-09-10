-- 0128 — "Claim your listing": a real employer takes ownership of their
-- aggregated postings (build-prompt §6.12).
--
-- ── THE SHAPE OF THE PROBLEM ─────────────────────────────────────────────
--
-- `job_postings_internal_has_org` (baseline) is a hard invariant:
-- `source_type = 'internal'` requires `organization_id is not null`, and
-- `source_type = 'external'` requires it to be null. Too much branches on that
-- boundary (RLS, the feed queries, `search_job_postings`) to relax it — see
-- 0119/0127's own headers for what happens when a query and a policy disagree
-- about a boundary like this. So "claiming" cannot be "flip a column on the
-- existing row": it has to be creating a NEW internal row the employer fully
-- owns, and doing something honest with the old external one.
--
-- ── WHAT THE OLD ROW BECOMES, AND WHY ─────────────────────────────────────
--
-- Reused, not reinvented: claiming sets `status = 'removed'` on the external
-- row, through the exact mechanism 0056/0079 already built for taking a
-- posting out of every listing surface — the feed, `search_job_postings`, the
-- sitemap, the landing pages, `promoted_jobs`. All of them already filter on
-- `status <> 'removed'` or `status = 'open'`; none of them need to learn a
-- second exclusion rule for a claimed row, which is exactly the kind of extra
-- surface CLAUDE.md's 0109/0108 postmortems warn a new signal quietly misses.
--
-- `claimed_by_organization_id` (this migration) is a NEW, separate column
-- rather than a repurposing of `removed_by` — `removed_by` (0064) is
-- documented as "the ADMIN who removed or restored this posting" and points at
-- an operator; a claim is an employer's own action, not a moderation decision,
-- and overloading the column would make that comment a lie. `removal_reason`
-- still gets a human-readable note for the org's own eyes (0056 already grants
-- the owning org read access to a removed posting's `removal_reason` — moot
-- here, since an external row has no `organization_id` for `is_org_member` to
-- match, but the column stays in the spirit of "explain what happened" that
-- 0056 established), while `claimed_by_organization_id` is the structured
-- signal something can actually query on.
--
-- Existing `applications` rows pointing at the external id are UNTOUCHED. This
-- is the same reasoning `hired`-is-terminal (0037) protects: a seeker's own
-- tracker record of what they applied to must not be silently rewritten under
-- them. `job-snapshot.ts`'s `manual_job_snapshot` — written at apply time for
-- every real apply, internal or external — is what keeps their Job Tracker
-- rendering correctly once RLS stops admitting the now-removed row: the join
-- comes back null and the page already falls back to the snapshot. Nothing
-- about that fallback needed to change for this feature; it already existed
-- for the "a resume/posting was deleted later" case Stage 5b anticipated.
--
-- ── THE MATCHING SIGNALS ──────────────────────────────────────────────────
--
-- Two signals, deliberately not treated the same:
--
--   DOMAIN match — the external posting's `external_url` hostname equals the
--   claiming organisation's verified `domain`. High confidence: domains mostly
--   don't collide, and this is the same fact 0044's own domain-verification
--   already leans on.
--
--   NAME match — normalised `company_name` equality. Weak, and known to be:
--   company names collide (two different "Paystack"s, a generic "Solutions
--   Ltd"), so this is surfaced as a suggestion, never enough on its own to
--   silently do anything. The UI's job is to say "might be yours," not
--   "is yours."
--
-- Both signals are recomputed INSIDE `claim_external_job_posting`, not just in
-- the candidate list a client reads — defense in depth. A candidate id is
-- client-supplied by the time the claim RPC runs, and trusting it without
-- re-checking would let a caller claim a job posting that never matched their
-- organisation at all, which is the actual trust problem: a false positive
-- silently attached to the wrong employer.
--
-- ── WHY THIS IS SECURITY DEFINER, GRANTED ONLY TO service_role ────────────
--
-- Same shape as `auto_apply_claim_submission` (0034) and
-- `admin_moderate_job_posting` (0079): the write touches trust columns no
-- client role may set directly (`removed_at`, `removal_reason`,
-- `claimed_by_organization_id`, `claimed_at`) AND inserts a new `internal`
-- `job_postings` row on the caller's behalf. It is called from a Server Action
-- that has ALREADY resolved the caller's own organisation through
-- `requireEmployer()` — which reads membership through the user's own client,
-- so a regression in that policy fails the caller closed rather than silently
-- routing around it — so `p_organization_id` is not a client-forgeable
-- authorisation, the same trust boundary `auto_apply_claim_submission`'s own
-- header describes for `p_user_id`. Not callable by `authenticated`: a
-- session client cannot invoke this with someone else's organisation id.
--
-- ── WHY THE MATCH CANDIDATE LIST NEEDS NO PRIVILEGE ESCALATION ────────────
--
-- `job_posting_claim_candidates` is `security invoker`. It only reads rows
-- that are ALREADY publicly readable — an open external posting (0056's first
-- policy branch, unconditional on organisation membership or verification)
-- and a public `organizations` row — so RLS on both tables already admits
-- exactly what this needs, and the function runs as whatever role calls it.

alter table public.job_postings
  add column claimed_by_organization_id uuid references public.organizations(id) on delete set null,
  add column claimed_at timestamptz;

comment on column public.job_postings.claimed_by_organization_id is
  'Set only on an EXTERNAL posting: the internal organisation that claimed this role and created their own posting for it (see claim_external_job_posting). Null for everything else. ON DELETE SET NULL — deleting the claiming organisation must not block on a historical claim marker the way job_postings.organization_id (NO ACTION) deliberately does for a LIVE posting; this is provenance on a row the org does not own. Service-role write only.';
comment on column public.job_postings.claimed_at is
  'When claimed_by_organization_id was set. Service-role write only. Cleared together with claimed_by_organization_id — see preserve_job_posting_removal below for why an admin restore clears both.';

create index job_postings_claimed_by_organization_id_idx
  on public.job_postings (claimed_by_organization_id) where claimed_by_organization_id is not null;

-- ── NEITHER COLUMN IS UPDATE-GRANTABLE BY A CLIENT ROLE ───────────────────
--
-- 0056 revoked table-level UPDATE on job_postings and re-granted a named
-- column list; 0107/0119 established that a column simply left off that list
-- needs no revoke statement of its own, only a guard proving it stayed off.
-- Same treatment here.

do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'job_postings'
      and cp.column_name in ('claimed_by_organization_id', 'claimed_at')
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'claimed_by_organization_id/claimed_at are UPDATE-grantable by a client role. Only claim_external_job_posting (service_role) may set them.';
  end if;
end $$;

-- ── AND NEITHER IS SMUGGLABLE THROUGH THE INTERNAL INSERT POLICY ──────────
--
-- The 0114/0119 finding, checked again for the same reason 0119's own header
-- gives: a trust column left out of the internal-posting INSERT `with check`
-- is reachable through the row's own creation even though UPDATE is locked
-- down. These two are meaningless on an INTERNAL row (they describe what
-- happened to an EXTERNAL one), but "meaningless if legitimate" is not a
-- reason to leave a trust column unconstrained at INSERT — CLAUDE.md's own
-- lesson from 0114/0119 is to watch for exactly this, not to reason about
-- whether a given hole would be exploited.
--
-- Read-and-AND, not re-declared, for 0119's own reason: a copy of the base
-- expression goes stale silently the next time this policy grows a clause.
do $$
declare
  base_check text;
  policy_roles text;
begin
  select
    pg_get_expr(p.polwithcheck, p.polrelid),
    (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname)
       from pg_roles r where r.oid = any (p.polroles))
  into base_check, policy_roles
  from pg_policy p
  where p.polrelid = 'public.job_postings'::regclass
    and p.polname = 'org members can manage their org''s internal postings';

  if base_check is null then
    raise exception
      'the job_postings INSERT policy is missing, so there is nothing to extend.';
  end if;
  if policy_roles is null then
    raise exception
      'the job_postings INSERT policy applies to PUBLIC rather than a named role; refusing to re-create it blindly.';
  end if;

  execute 'drop policy "org members can manage their org''s internal postings" on public.job_postings';
  execute format(
    'create policy "org members can manage their org''s internal postings" '
    'on public.job_postings for insert to %s with check ((%s) '
    'and claimed_by_organization_id is null and claimed_at is null)',
    policy_roles,
    base_check
  );
end $$;

do $$
declare
  final_check text;
  missing text[] := '{}';
  col text;
begin
  select pg_get_expr(polwithcheck, polrelid) into final_check
  from pg_policy
  where polrelid = 'public.job_postings'::regclass
    and polname = 'org members can manage their org''s internal postings';

  foreach col in array array[
    'source_type', 'is_org_member', 'unlisted_at', 'removed_at',
    'removal_reason', 'removed_by',
    'admin_review_decision', 'admin_reviewed_at', 'admin_reviewed_by',
    'claimed_by_organization_id', 'claimed_at'
  ] loop
    if final_check is null or final_check not ilike '%' || col || '%' then
      missing := missing || col;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'the job_postings INSERT policy is missing %; expected every prior migration''s clause plus this one''s two.',
      array_to_string(missing, ', ');
  end if;
end $$;

-- ── AN ADMIN RESTORE MUST NOT LEAVE A STALE CLAIM MARKER ──────────────────
--
-- `admin_moderate_job_posting`'s 'restore' branch (0079) knows nothing about
-- these two columns — it was written long before this feature — and moves a
-- row from `removed` back to `closed`, clearing `removed_at`/`removal_reason`/
-- `removed_by` in the same statement. If an operator ever restores a CLAIMED
-- external posting (an unusual action — Path 3/removal tooling was built for
-- moderation, not for undoing a claim — but the row is reachable from the same
-- admin queue either way), leaving `claimed_by_organization_id` set on a row
-- that is no longer `removed` would be a lie: `unlisted_at`/`external`'s
-- `status <> 'removed'` branch of the read policy would make it publicly
-- readable again while still carrying a "this was claimed" marker nothing
-- else in the schema treats as compatible with being live.
--
-- Extending `preserve_job_posting_removal` (0056) rather than teaching
-- `admin_moderate_job_posting` about a column it was never meant to know
-- about: the invariant this protects — "a claim marker only exists on a row
-- that is actually removed" — belongs at the row level, the same place 0056
-- already enforces "removed_at only clears through a real state change."
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
    -- The SANCTIONED restore path (removed_at cleared alongside status).
    -- Force the claim marker to clear with it, regardless of what the caller
    -- passed — a restore un-claims, whether or not the caller's statement
    -- mentioned these columns at all.
    new.claimed_by_organization_id := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

-- ── TWO SMALL, REUSED HELPERS ──────────────────────────────────────────────
--
-- Both `immutable`: pure text transforms, no table access, safe to use in an
-- index expression later if that's ever worth it. Used by BOTH the candidate
-- list and the claim RPC's re-verification, deliberately — one definition of
-- "what counts as a match," not two that can drift apart.

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

-- ── THE CANDIDATE LIST ─────────────────────────────────────────────────────
--
-- Read-only, `security invoker`: see this migration's header for why no
-- privilege escalation is needed. Confidence is reported per row so the UI
-- can say "might be yours" for a name-only match rather than presenting it
-- with the same certainty as a domain match.
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

-- ── THE CLAIM ITSELF ────────────────────────────────────────────────────────
--
-- One function, one transaction: locks the external row, re-verifies the
-- match server-side, inserts the new internal posting, marks the external row
-- removed+claimed. Concurrency: `for update` on the external row serialises
-- two callers racing to claim the same posting — the second sees
-- `claimed_by_organization_id is not null` (or `status = 'removed'`) once the
-- first commits and is told 'already_claimed', never a double-claim.
--
-- p_title/p_description/p_location are the employer's edited values from the
-- review screen (always sent, even when unchanged from the external row) —
-- everything else (work_type, employment_type, seniority,
-- years_experience_min, salary) is copied straight from the external posting,
-- since the review screen does not re-collect fields that rarely need
-- editing to correct provenance; the employer can still edit them afterwards
-- from Jobs Posted like any other internal posting.
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

  -- Locked for the rest of the transaction: whichever caller gets here first
  -- decides the row's fate, and the second sees the result rather than racing
  -- it.
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

  -- Recomputed here, not trusted from the caller — see this migration's
  -- header on why the candidate list alone is not the gate.
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
    -- Its own fingerprint scheme, deliberately not internalDedupFingerprint's
    -- sha256(org+title+location): keyed on the external posting's own id, so
    -- it can never collide with an organically-posted internal fingerprint
    -- (different format entirely) and is naturally unique per external row —
    -- the `for update` lock above is what makes it unique per CALL, this is
    -- what makes it unique in the TABLE.
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
