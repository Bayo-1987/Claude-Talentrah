-- 0266: the marks foundation: one table of dated, expiring verification marks, the functions that write and read them, and the backfill of today's "Resume reviewed".
--
-- WHAT. VERIFY-1 (owner direction, 8 Oct 2026): a candidate earns SEPARATE, DATED marks (Resume reviewed, later Skills check, Reference confirmed, Mentor interview, Communication check), each names its
-- field where it has one, each expires 12 months after it was earned, employers see only marks that are earned and live, and there is NO overall score. Today "verified" is three columns on profiles; this adds the
-- layer the other marks will use, without changing what any employer page shows today.
--   public.verification_marks          one row per earned mark: mark_type, field, level (strong|passed, skills check only), review_type (ai|human, resume_reviewed only), earned_at, expires_at (always earned_at + 12 months, enforced by a CHECK),
--                                      the source row, and for resume_reviewed the hash of the resume that was reviewed. There is NO column that can hold a score, a percentage or points (the self-check below fails if one is ever added).
--   public.verification_mark_is_live(expires_at, now)   the single definition of "not expired" (pure; the tests call it with an injected clock at 12 months +/- 1 second).
--   public.resume_content_hash(user)   sha256 of the user's base resume content (jsonb text is canonical: key order and whitespace do not change it). Service role only.
--   public.award_verification_mark(...)  the ONLY writer (SECURITY DEFINER, service role only). A failed review never calls it, so a fail inserts nothing.
--   public.resolve_talent_verification   REPLACED: identical to 0142's, plus: when the review passed, it awards the resume_reviewed mark in the same function (same transaction as the status change).
--   public.employer_visible_marks(candidate ids)  the directory read: earned AND live marks for profiles that pass the directory listing gate (opted in, verified, not QA, not deletion-requested), for a caller whose
--                                      organisation holds an active Talent Directory subscription. Never returns the hash, the source, or anything score-like. changed_since_review is computed here.
--   public.applicant_visible_marks(job posting id)  the applicants read: the same marks for people who APPLIED to that job, for members of the job's own organisation, keyed by APPLICATION id (never by user id: the applicant list
--                                      returns none, and a mark read must not hand it out). Consent basis = applying (0125/0126), so it does not need the directory opt-in; it still excludes deletion-requested and QA accounts.
--
-- BACKFILL. One resume_reviewed mark per profile that is verified today: earned_at = profiles.talent_verified_at (the date the badge shows today), review_type = the latest verified attempt's review_type (the way
-- employer_job_applicants and talent_directory_search read it since 0234), resume_hash NULL (= unknown: no "changed since review" flag is shown for these until their next review). The backfill refuses to guess: a verified profile
-- with no talent_verified_at stops the migration. Production at the audit of 8 Oct 2026: exactly 1 verified profile, reviewed by Farah within the last 3 months, so exactly 1 mark and nothing expires on day one.
--
-- NOT CHANGED. profiles.talent_verification_* (still the source for the listing gate and the badge; the 0238 attempt limit is untouched), talent_verifications, every employer-facing function (they move to the marks functions in a
-- later change, so applying this migration alters nothing visible), resolve_flagged_talent_verification (a flagged AI result still writes no mark).
--
-- LIMITS, SAID PLAINLY. The resume hash is taken when the review is decided. A candidate who edits the resume between the reviewer opening it and the decision gets a hash of the newer text, so the "changed" flag would not fire for
-- that one edit; a re-review is the remedy. The flag compares the hash with the CURRENT base resume only.
--
-- ORDER. Additive in effect (a new table, new functions, one function body replaced with an identical-plus-one-call body). Apply BEFORE merging. The undo is supabase/rollbacks/0266_verification_marks.rollback.sql.

-- ── the pure pieces ────────────────────────────────────────────────────────
create or replace function public.verification_mark_is_live(p_expires_at timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_expires_at > p_now
$$;

-- ── the table ──────────────────────────────────────────────────────────────
create table public.verification_marks (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  mark_type    text        not null,
  field        text,
  level        text,
  review_type  text,
  earned_at    timestamptz not null,
  expires_at   timestamptz not null,
  source_id    uuid,
  resume_hash  text,
  detail       jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint verification_marks_type_known check (mark_type in ('resume_reviewed', 'skills_check', 'reference_confirmed', 'mentor_interview', 'communication_check')),
  constraint verification_marks_level_known check (level is null or level in ('strong', 'passed')),
  constraint verification_marks_review_type_known check (review_type is null or review_type in ('ai', 'human')),
  constraint verification_marks_expiry_is_12_months check (expires_at = ((earned_at at time zone 'UTC') + interval '12 months') at time zone 'UTC'),
  constraint verification_marks_shape check (
       (mark_type = 'resume_reviewed' and field is null and level is null)
    or (mark_type = 'skills_check' and field is not null and level is not null)
    or (mark_type in ('reference_confirmed', 'mentor_interview', 'communication_check') and field is not null and level is null)
  ),
  constraint verification_marks_review_type_only_on_resume_reviewed check (review_type is null or mark_type = 'resume_reviewed'),
  constraint verification_marks_hash_only_on_resume_reviewed check (resume_hash is null or mark_type = 'resume_reviewed')
);

create index verification_marks_user_idx on public.verification_marks (user_id, mark_type, field, earned_at desc);

comment on table public.verification_marks is
  'Dated, expiring verification marks (0266). One row per earned mark; expires_at is always earned_at + 12 months; no column can hold a score. Written only by award_verification_mark (service role); employers read only through employer_visible_marks / applicant_visible_marks; the owner may read their own rows (columns listed in the grant).';

alter table public.verification_marks enable row level security;
create policy verification_marks_owner_select on public.verification_marks for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.verification_marks from public, anon, authenticated, service_role;
-- The owner sees their own marks, and only these columns: not the resume hash, not the source row, not the free-form detail.
grant select (id, user_id, mark_type, field, level, review_type, earned_at, expires_at) on public.verification_marks to authenticated;
grant select, insert on table public.verification_marks to service_role;

-- ── the writer and the hash ────────────────────────────────────────────────
create or replace function public.resume_content_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(r.structured_content::text, 'UTF8')), 'hex')
  from public.resumes r
  where r.user_id = p_user_id and r.is_base
  order by r.updated_at desc
  limit 1
$$;

create or replace function public.award_verification_mark(
  p_user_id uuid,
  p_mark_type text,
  p_field text,
  p_level text,
  p_review_type text,
  p_source_id uuid,
  p_resume_hash text,
  p_earned_at timestamptz default pg_catalog.now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.verification_marks (user_id, mark_type, field, level, review_type, earned_at, expires_at, source_id, resume_hash)
  values (p_user_id, p_mark_type, p_field, p_level, p_review_type, p_earned_at, ((p_earned_at at time zone 'UTC') + interval '12 months') at time zone 'UTC', p_source_id, p_resume_hash)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── a passed resume review now awards its mark (identical to 0142's function otherwise) ──
create or replace function public.resolve_talent_verification(
  p_verification_id uuid,
  p_user_id uuid,
  p_verified boolean,
  p_score integer,
  p_feedback text,
  p_reviewer_id uuid default null,
  p_reviewer_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text := case when p_verified then 'verified' else 'rejected' end;
  v_reviewer_payout_ngn integer := round(60 * 125 * 0.85);
  v_updated uuid;
  v_review_type text;
begin
  update public.talent_verifications
     set status = v_new_status,
         ai_score = p_score,
         ai_feedback = p_feedback,
         decided_at = now(),
         reviewer_notes = coalesce(p_reviewer_notes, reviewer_notes),
         reviewer_payout_ngn = case when p_reviewer_id is not null then v_reviewer_payout_ngn else reviewer_payout_ngn end
   where id = p_verification_id
     and user_id = p_user_id
     and (
       (p_reviewer_id is null and status = 'pending')
       or (p_reviewer_id is not null and status = 'claimed' and reviewer_id = p_reviewer_id)
     )
  returning id, review_type into v_updated, v_review_type;

  if v_updated is null then
    return false;
  end if;

  update public.profiles
     set talent_verification_status = v_new_status,
         talent_verification_score = p_score,
         talent_verified_at = case when p_verified then now() else null end
   where id = p_user_id;

  if p_verified then
    perform public.award_verification_mark(p_user_id, 'resume_reviewed', null, null, v_review_type, v_updated, public.resume_content_hash(p_user_id), now());
  end if;

  return true;
end;
$$;

-- ── the two employer reads ─────────────────────────────────────────────────
create or replace function public.employer_visible_marks(p_candidate_ids uuid[])
returns table (
  candidate_id uuid,
  mark_type text,
  field text,
  level text,
  review_type text,
  earned_at timestamptz,
  expires_at timestamptz,
  changed_since_review boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_candidate_ids is null or pg_catalog.cardinality(p_candidate_ids) > 100 then
    raise exception 'employer_visible_marks: pass between 0 and 100 candidate ids' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid() and s.status = 'active' and s.expires_at > pg_catalog.now()
  ) then
    return;
  end if;

  return query
    select x.candidate_id, x.mark_type, x.field, x.level, x.review_type, x.earned_at, x.expires_at, x.changed_since_review
    from (
      select distinct on (m.user_id, m.mark_type, coalesce(m.field, ''))
             m.user_id as candidate_id, m.mark_type, m.field, m.level, m.review_type, m.earned_at, m.expires_at,
             (m.mark_type = 'resume_reviewed' and m.resume_hash is not null and coalesce(m.resume_hash <> public.resume_content_hash(m.user_id), false)) as changed_since_review
      from public.verification_marks m
      where m.user_id = any (p_candidate_ids)
        and m.user_id in (select l.id from public.talent_directory_listed_ids() as l(id))
        and public.verification_mark_is_live(m.expires_at, pg_catalog.now())
      order by m.user_id, m.mark_type, coalesce(m.field, ''), m.earned_at desc
    ) x
    order by x.candidate_id, x.earned_at desc;
end;
$$;

create or replace function public.applicant_visible_marks(p_job_posting_id uuid)
returns table (
  application_id uuid,
  mark_type text,
  field text,
  level text,
  review_type text,
  earned_at timestamptz,
  expires_at timestamptz,
  changed_since_review boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.job_postings j where j.id = p_job_posting_id and public.is_org_member(j.organization_id)) then
    return;
  end if;

  -- Keyed by APPLICATION, not by person: employer_job_applicants (0125/0170/0234) deliberately returns no user id, and this must not hand every applicant's user id to the employer's browser.
  return query
    select x.application_id, x.mark_type, x.field, x.level, x.review_type, x.earned_at, x.expires_at, x.changed_since_review
    from (
      select distinct on (a.id, m.mark_type, coalesce(m.field, ''))
             a.id as application_id, m.mark_type, m.field, m.level, m.review_type, m.earned_at, m.expires_at,
             (m.mark_type = 'resume_reviewed' and m.resume_hash is not null and coalesce(m.resume_hash <> public.resume_content_hash(m.user_id), false)) as changed_since_review
      from public.applications a
      join public.verification_marks m on m.user_id = a.user_id
      join public.profiles p on p.id = a.user_id
      where a.job_posting_id = p_job_posting_id
        and a.applied_at is not null
        and p.deletion_requested_at is null
        and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)
        and (m.mark_type <> 'resume_reviewed' or p.talent_verification_status = 'verified')
        and public.verification_mark_is_live(m.expires_at, pg_catalog.now())
      order by a.id, m.mark_type, coalesce(m.field, ''), m.earned_at desc
    ) x
    order by x.application_id, x.earned_at desc;
end;
$$;

-- ── privileges ─────────────────────────────────────────────────────────────
revoke all on function public.verification_mark_is_live(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.resume_content_hash(uuid) from public, anon, authenticated;
revoke all on function public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.employer_visible_marks(uuid[]) from public, anon;
revoke all on function public.applicant_visible_marks(uuid) from public, anon;
grant execute on function public.verification_mark_is_live(timestamptz, timestamptz) to service_role;
grant execute on function public.resume_content_hash(uuid) to service_role;
grant execute on function public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz) to service_role;
grant execute on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) to service_role;
grant execute on function public.employer_visible_marks(uuid[]) to authenticated, service_role;
grant execute on function public.applicant_visible_marks(uuid) to authenticated, service_role;

-- ── the backfill ───────────────────────────────────────────────────────────
do $backfill$
declare
  v_verified bigint;
  v_no_date bigint;
  v_inserted bigint;
begin
  select count(*), count(*) filter (where p.talent_verified_at is null) into v_verified, v_no_date
    from public.profiles p where p.talent_verification_status = 'verified';
  if v_no_date > 0 then
    raise exception '0266: % verified profile(s) have no talent_verified_at; the backfill will not guess a date', v_no_date;
  end if;

  insert into public.verification_marks (user_id, mark_type, review_type, earned_at, expires_at, source_id)
  select p.id, 'resume_reviewed', tv.review_type, p.talent_verified_at,
         ((p.talent_verified_at at time zone 'UTC') + interval '12 months') at time zone 'UTC', tv.id
    from public.profiles p
    left join lateral (
      select t.id, t.review_type
        from public.talent_verifications t
       where t.user_id = p.id and t.status = 'verified'
       order by t.decided_at desc nulls last, t.requested_at desc
       limit 1
    ) tv on true
   where p.talent_verification_status = 'verified';
  get diagnostics v_inserted = row_count;

  if v_inserted <> v_verified then
    raise exception '0266: backfilled % mark(s) for % verified profile(s)', v_inserted, v_verified;
  end if;
end
$backfill$;

-- ── self-check: the migration fails (and nothing is kept) unless all of this holds ─────────────────────
do $check$
declare
  v_table oid := 'public.verification_marks'::regclass;
  v_fn    text;
  v_bad   bigint;
begin
  -- no column can hold a score
  select count(*) into v_bad from information_schema.columns
   where table_schema = 'public' and table_name = 'verification_marks' and column_name ~* '(score|percent|pct|rating|points|grade)';
  if v_bad <> 0 then raise exception '0266 self-check: verification_marks has a score-like column'; end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = v_table) then raise exception '0266 self-check: RLS is off on verification_marks'; end if;
  if (select count(*) from pg_catalog.pg_policy where polrelid = v_table) <> 1 then raise exception '0266 self-check: verification_marks must have exactly one policy (the owner select)'; end if;
  -- anon holds nothing; authenticated holds no write and no read of the columns that are not listed
  if pg_catalog.has_table_privilege('anon', v_table, 'select, insert, update, delete, truncate, references, trigger') then raise exception '0266 self-check: anon holds a privilege on verification_marks'; end if;
  if pg_catalog.has_table_privilege('authenticated', v_table, 'insert, update, delete, truncate, references, trigger') then raise exception '0266 self-check: authenticated holds a write or DDL privilege on verification_marks'; end if;
  if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'verification_marks' and c.column_name in ('resume_hash', 'source_id', 'detail', 'created_at')
             and pg_catalog.has_column_privilege('authenticated', v_table, c.column_name, 'select')) then
    raise exception '0266 self-check: authenticated can read a column that is not in the owner grant';
  end if;
  if exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'verification_marks' and c.column_name in ('resume_hash', 'source_id', 'detail', 'created_at')
             and pg_catalog.has_column_privilege('anon', v_table, c.column_name, 'select')) then
    raise exception '0266 self-check: anon can read a column of verification_marks';
  end if;
  if exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
              where c.oid = v_table and a.grantee = 0) then raise exception '0266 self-check: PUBLIC holds a privilege on verification_marks'; end if;
  -- the functions
  foreach v_fn in array array['public.verification_mark_is_live(timestamptz, timestamptz)', 'public.resume_content_hash(uuid)', 'public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz)', 'public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text)'] loop
    if pg_catalog.has_function_privilege('anon', v_fn, 'execute') or pg_catalog.has_function_privilege('authenticated', v_fn, 'execute') or not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0266 self-check: % must be executable by service_role only', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.employer_visible_marks(uuid[])', 'public.applicant_visible_marks(uuid)'] loop
    if pg_catalog.has_function_privilege('anon', v_fn, 'execute') or not pg_catalog.has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0266 self-check: % must be executable by authenticated and not by anon', v_fn;
    end if;
    if exists (select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a where p.oid = v_fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0266 self-check: PUBLIC can execute %', v_fn;
    end if;
  end loop;
  -- backfill parity: every verified profile has exactly one resume_reviewed mark with the date and review type the badge shows today, and no other profile has one
  if exists (select 1 from public.profiles p where p.talent_verification_status = 'verified'
              and (select count(*) from public.verification_marks m where m.user_id = p.id and m.mark_type = 'resume_reviewed') <> 1) then
    raise exception '0266 self-check: a verified profile does not have exactly one resume_reviewed mark';
  end if;
  if exists (select 1 from public.verification_marks m join public.profiles p on p.id = m.user_id where m.mark_type = 'resume_reviewed' and p.talent_verification_status <> 'verified') then
    raise exception '0266 self-check: a profile that is not verified has a resume_reviewed mark';
  end if;
  if exists (select 1 from public.verification_marks m join public.profiles p on p.id = m.user_id
              where m.mark_type = 'resume_reviewed' and m.earned_at is distinct from p.talent_verified_at) then
    raise exception '0266 self-check: a backfilled mark date differs from profiles.talent_verified_at';
  end if;
  if exists (select 1 from public.verification_marks m
              where m.mark_type = 'resume_reviewed'
                and m.review_type is distinct from (select t.review_type from public.talent_verifications t where t.user_id = m.user_id and t.status = 'verified' order by t.decided_at desc nulls last, t.requested_at desc limit 1)) then
    raise exception '0266 self-check: a backfilled review type differs from the latest verified attempt';
  end if;
end
$check$;
