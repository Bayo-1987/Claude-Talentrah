-- 0119: Path 3 — an admin can approve ONE job posting individually.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- Today a job posting from an organisation that is neither domain-verified
-- (0027) nor CAC-verified (0113/0114) has no route to public visibility at
-- all short of an unlisted link nobody but the holder can find (0107). This
-- gives an admin a third, narrower option: approve THIS ONE POSTING for
-- public listing without touching the organisation's own `verified` flag —
-- every other and every future posting from that org still needs the same
-- individual approval, on purpose (founder's own framing of "Path 3").
--
-- The employer's own action is requesting review, not deciding it:
-- `admin_review_requested_at` is the one column of the five this migration
-- adds that the employer may set — everything that actually grants public
-- reach is an admin decision.
--
-- ── WHY `admin_reviewed_by` POINTS AT `profiles`, NOT `admin_users` ───────
--
-- Same reasoning as 0114's `cac_confirmed_by`, which is the same reasoning as
-- 0064's `moderated_by`/`reviewed_by`/`removed_by`: an admin account later
-- revoked should still resolve as a named person in the audit trail rather
-- than dangling or cascading the row away.

alter table public.job_postings
  add column admin_review_requested_at timestamptz,
  add column admin_review_decision text
    check (admin_review_decision in ('approved', 'rejected')),
  add column admin_reviewed_at timestamptz,
  add column admin_reviewed_by uuid references public.profiles(id) on delete set null,
  add column admin_review_note text;

comment on column public.job_postings.admin_review_requested_at is
  'When the employer asked for Path 3 individual review (0118/0119) — their own action, set from the posting''s own management UI. Employer-writable (see grant below); requesting review does not itself grant anything.';

comment on column public.job_postings.admin_review_decision is
  '''approved'' or ''rejected'' — an admin''s Path 3 decision on THIS posting only (0113''s employer_verification does not apply here; this is job_review, 0118). Approving does not touch organizations.verified: every other and future posting from the same org needs its own separate approval. Service-role write only.';

comment on column public.job_postings.admin_reviewed_at is
  'When admin_review_decision was set. Service-role write only.';

comment on column public.job_postings.admin_reviewed_by is
  'The admin (profiles.id) who decided. References profiles, not admin_users, matching moderated_by/reviewed_by/removed_by (0064) and cac_confirmed_by (0114): a revoked admin account still resolves as a named person in the trail. Service-role write only.';

comment on column public.job_postings.admin_review_note is
  'Optional on approval, required on rejection (enforced in the Server Action, not here) — the employer''s way to know what to fix before resubmitting. Service-role write only.';

-- Column privileges, added incrementally to the existing `authenticated`
-- UPDATE grant on job_postings (confirmed live: company_logo_url,
-- company_name, created_at, dedup_fingerprint, description, employment_type,
-- expires_at, external_source, external_url, id, last_checked_at, location,
-- organization_id, posted_at, salary_currency, salary_max, salary_min,
-- salary_unit, seniority, source_type, status, structured_jd, title,
-- work_type, years_experience_min — notably NOT unlisted_at/removed_at/
-- removal_reason/removed_by, withheld by 0056/0107). Added incrementally
-- rather than re-issued, for the same reason 0114's own header gives: a
-- re-stated list is what silently dropped 0085's salary columns during
-- 0107's first draft.
grant update (admin_review_requested_at) on public.job_postings to authenticated;

-- The other four stay withheld by default — no grant statement, plus the
-- guard below, matching every trust column before it.
do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'job_postings'
      and cp.column_name in
        ('admin_review_decision', 'admin_reviewed_at', 'admin_reviewed_by', 'admin_review_note')
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'a Path 3 decision column is UPDATE-grantable by a client role. Only the service role may write admin_review_decision/admin_reviewed_at/admin_reviewed_by/admin_review_note.';
  end if;
end $$;

-- ── THE SELECT POLICY: ONE NEW BRANCH ─────────────────────────────────────
--
-- Current text confirmed live before writing this (0107's own definition,
-- unmodified since): four OR-branches, each repeating its own
-- `status <> 'removed'` exclusion rather than inheriting one from an outer
-- AND — deliberate, per 0107's header, so a branch that omitted it would
-- silently readmit a removed posting through that one route. This adds a
-- fifth branch in exactly that shape.
drop policy "job postings are publicly readable" on public.job_postings;

create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    (source_type = 'external'::job_source_type and status <> 'removed'::job_status)
    or (
      exists (
        select 1 from public.organizations o
        where o.id = job_postings.organization_id and o.verified
      )
      and status <> 'removed'::job_status
    )
    or (unlisted_at is not null and status <> 'removed'::job_status)
    -- NEW (0119). Deliberately independent of `organizations.verified` and
    -- of `unlisted_at` — a Path 3 approval is its own, narrower grant, scoped
    -- to this one row, not a substitute for either of the other two routes.
    or (admin_review_decision = 'approved'::text and status <> 'removed'::job_status)
    or is_org_member(organization_id)
  );

-- Asserts the new branch actually landed in the STORED policy, not just in
-- this file's copy of it — the same shape as 0114's own self-check.
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.job_postings'::regclass
      and polname = 'job postings are publicly readable'
      and pg_get_expr(polqual, polrelid) ilike '%admin_review_decision%'
  ) then
    raise exception
      'the job_postings SELECT policy does not mention admin_review_decision — the Path 3 branch was lost.';
  end if;
end $$;

-- ── A THIRD INSTANCE OF 0114'S INSERT FINDING, IN THE SAME TABLE ──────────
--
-- Checked directly, the same way 0114 checked `organizations`, because the
-- same root cause was always going to reproduce here too: Supabase's default
-- INSERT privilege is table-wide, not column-scoped, and this table's own
-- REVOKE/GRANT history (0056, 0107, and the one immediately above) has only
-- ever governed UPDATE. Reproduced live before writing this fix, from a real
-- authenticated org member inserting their OWN new internal posting:
--
--   insert into job_postings (..., source_type, organization_id, unlisted_at,
--     removed_at, removal_reason, removed_by) values (..., 'internal', <own
--     org>, now(), now(), 'self-smuggled', <self>)
--
-- succeeded and returned every one of those five values as given. That is
-- not a Path-3-shaped hole this migration introduces — it is a PRE-EXISTING
-- one in 0056 (removed_at/removal_reason/removed_by) and 0107 (unlisted_at),
-- both merged long before this migration, reachable the whole time through
-- the row's creation rather than its update, which nothing before this ever
-- tested. It would have applied identically to this migration's own three
-- new decision columns (`admin_review_decision`, `admin_reviewed_at`,
-- `admin_reviewed_by`) the moment they existed — an org could insert a brand
-- new posting already marked `admin_review_decision = 'approved'`, which
-- would make the entire review queue this migration builds optional.
--
-- Fixed here, in the same migration, for the same reason 0114 fixed
-- `organizations`' equivalent hole here rather than filing it: shipping three
-- more trust columns into a table already known to leak them at INSERT would
-- be worse than not shipping them, because it would look reviewed. The INSERT
-- policy for internal postings gains a `with check` naming every column on
-- this table that grants trust — the three this migration adds, plus the two
-- 0056/0107 already should have carried. `admin_review_requested_at` and
-- `admin_review_note` are deliberately NOT constrained: the first grants
-- nothing by itself (it only queues a request, same shape as 0114's
-- cac_number), and the second is inert without a decision next to it.
--
-- All five constrained columns are nullable with no default other than null,
-- so a normal insert that never mentions them — every real posting creation
-- in this codebase — keeps passing this check unchanged; only an insert that
-- explicitly smuggles a non-null value is newly refused.
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
    and admin_review_decision is null
    and admin_reviewed_at is null
    and admin_reviewed_by is null
  );

-- Asserts the fix landed in the stored policy.
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.job_postings'::regclass
      and polname = 'org members can manage their org''s internal postings'
      and pg_get_expr(polwithcheck, polrelid) ilike '%unlisted_at%'
      and pg_get_expr(polwithcheck, polrelid) ilike '%admin_review_decision%'
  ) then
    raise exception
      'the job_postings INSERT policy no longer constrains its trust columns — the self-smuggling-at-insert fix was lost.';
  end if;
end $$;
