-- 0000 — BASELINE SNAPSHOT of the live schema as of 2026-08-25, after 0026.
--
-- READ THIS BEFORE USING IT.
--
-- This is NOT a migration to run against the existing project. It already
-- describes that project exactly. It exists so that the schema has a
-- reviewable starting point in version control: migrations 0001–0025 were
-- applied straight to the Supabase project through the MCP connector and were
-- never committed, so before this file there was no diff to review any schema
-- or policy change against. 0026 was the first migration written down first.
--
-- Its two real uses:
--   1. A diff baseline. When a future migration changes a policy, you can see
--      what it changed FROM by reading this file, instead of querying prod.
--   2. Standing up a fresh project (a staging or test database, which this
--      repo badly needs — every suite currently runs against production).
--
-- HOW IT WAS PRODUCED, and what that means for trust: it is reconstructed
-- from the live catalog (pg_class, pg_attribute, pg_constraint, pg_indexes,
-- pg_proc, pg_trigger, pg_policies) via the MCP connector, NOT by pg_dump —
-- there is no direct Postgres connection string in this repo and the Supabase
-- CLI is not installed, so `supabase db dump` was not available. It is
-- therefore faithful to structure, not byte-exact to what pg_dump would emit.
-- Known deliberate omissions: Supabase-managed schemas (auth, storage,
-- realtime, vault, graphql), table/column grants to anon/authenticated/
-- service_role (Supabase's defaults), row data (see scripts/seed.ts), and
-- comments. The one auth-schema object included is the on_auth_user_created
-- trigger, because it is ours and profile creation depends on it.
--
-- This is a process fix, not a historical reconstruction. It does not recover
-- what 0001–0025 each said at the time; it records where they collectively
-- landed. Backfilling the individual migrations is a separate job and may
-- never be worth doing.

-- ---------------------------------------------------------------------------
-- extensions
-- ---------------------------------------------------------------------------
create extension if not exists pg_graphql with schema graphql;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- enum types
-- ---------------------------------------------------------------------------
create type public.application_source as enum ('internal_apply', 'manual', 'auto_apply');
create type public.application_stage as enum ('saved', 'applied', 'interviewing', 'offer', 'hired', 'rejected', 'archived');
create type public.credit_gate_outcome as enum ('proceeded', 'blocked_insufficient_credits');
create type public.credit_reason as enum ('signup_grant', 'tailoring_run', 'cover_letter_run', 'template_unlock', 'purchase', 'referral_reward_referrer', 'referral_reward_referred', 'admin_adjustment', 'referral_signup_bonus', 'referral_activation_bonus', 'bullet_rewrite', 'scholarship_eligibility_check', 'scholarship_sop_draft');
create type public.employment_type as enum ('full_time', 'part_time', 'contract', 'internship');
create type public.farah_message_role as enum ('user', 'farah');
create type public.job_source_type as enum ('internal', 'external');
create type public.job_status as enum ('open', 'closed');
create type public.market_segment as enum ('home', 'diaspora');
create type public.org_member_role as enum ('owner', 'admin');
create type public.pass_auto_renew_status as enum ('active', 'canceled', 'lapsed');
create type public.pass_payment_method as enum ('card', 'mobile_money');
create type public.payment_product_type as enum ('credit_pack', 'pass');
create type public.payment_status as enum ('pending', 'success', 'failed');
create type public.referral_status as enum ('invited', 'signed_up', 'activated');
create type public.resume_source as enum ('uploaded', 'builder', 'tailored');
create type public.scholarship_degree_level as enum ('bsc', 'msc', 'phd', 'postgraduate_diploma', 'other');
create type public.scholarship_funding_type as enum ('full', 'partial');
create type public.scholarship_moderation_status as enum ('pending', 'verified', 'rejected');
create type public.scholarship_save_status as enum ('saved', 'applying', 'submitted', 'outcome');
create type public.seniority_level as enum ('entry', 'mid', 'senior', 'lead', 'executive');
create type public.work_type as enum ('remote', 'hybrid', 'onsite');

-- ---------------------------------------------------------------------------
-- tables
--
-- Ordered so foreign keys resolve: profiles → organizations → job_postings →
-- resumes → everything else. (The catalog does not record creation order; this
-- ordering was chosen to make the file replayable on an empty database.)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid not null,
  first_name text,
  last_name text,
  email text not null,
  country text,
  market_segment market_segment not null default 'home'::market_segment,
  locale text not null default 'en'::text,
  referral_code text not null,
  referred_by uuid,
  free_trial_tailoring_used boolean not null default false,
  free_trial_cover_letter_used boolean not null default false,
  credits_balance integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint profiles_pkey PRIMARY KEY (id),
  constraint profiles_referral_code_key UNIQUE (referral_code),
  constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES profiles(id)
);

create table public.organizations (
  id uuid not null default gen_random_uuid(),
  name text not null,
  domain text,
  verified boolean not null default false,
  logo_url text,
  description text,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint organizations_pkey PRIMARY KEY (id),
  constraint organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id)
);

create table public.organization_members (
  organization_id uuid not null,
  user_id uuid not null,
  role org_member_role not null default 'owner'::org_member_role,
  created_at timestamp with time zone not null default now(),
  constraint organization_members_pkey PRIMARY KEY (organization_id, user_id),
  constraint organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  constraint organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.job_postings (
  id uuid not null default gen_random_uuid(),
  source_type job_source_type not null,
  organization_id uuid,
  title text not null,
  company_name text not null,
  company_logo_url text,
  location text,
  work_type work_type,
  employment_type employment_type,
  seniority seniority_level,
  years_experience_min integer,
  description text not null,
  structured_jd jsonb not null default '{}'::jsonb,
  external_url text,
  external_source text,
  status job_status not null default 'open'::job_status,
  posted_at timestamp with time zone not null default now(),
  last_checked_at timestamp with time zone not null default now(),
  dedup_fingerprint text not null,
  created_at timestamp with time zone not null default now(),
  constraint job_postings_pkey PRIMARY KEY (id),
  constraint job_postings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id),
  constraint job_postings_internal_has_org CHECK ((((source_type = 'internal'::job_source_type) AND (organization_id IS NOT NULL)) OR ((source_type = 'external'::job_source_type) AND (organization_id IS NULL))))
);

create table public.resume_templates (
  id uuid not null default gen_random_uuid(),
  name text not null,
  industry_category text not null,
  is_premium boolean not null default false,
  preview_asset_url text,
  structure_schema jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  unlock_cost_credits integer not null default 0,
  constraint resume_templates_pkey PRIMARY KEY (id)
);

create table public.resumes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  is_base boolean not null default false,
  template_id uuid,
  title text not null default 'Untitled resume'::text,
  structured_content jsonb not null default '{}'::jsonb,
  source resume_source not null default 'builder'::resume_source,
  tailored_for_job_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint resumes_pkey PRIMARY KEY (id),
  constraint resumes_tailored_for_job_id_fkey FOREIGN KEY (tailored_for_job_id) REFERENCES job_postings(id),
  constraint resumes_template_id_fkey FOREIGN KEY (template_id) REFERENCES resume_templates(id),
  constraint resumes_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.applications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  job_posting_id uuid,
  resume_id uuid,
  cover_letter_id uuid,
  stage application_stage not null default 'saved'::application_stage,
  source application_source not null default 'manual'::application_source,
  applied_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  manual_job_snapshot jsonb,
  constraint applications_pkey PRIMARY KEY (id),
  constraint applications_user_id_job_posting_id_key UNIQUE (user_id, job_posting_id),
  constraint applications_cover_letter_id_fkey FOREIGN KEY (cover_letter_id) REFERENCES resumes(id),
  constraint applications_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES job_postings(id),
  constraint applications_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES resumes(id),
  constraint applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint applications_job_reference_check CHECK (((job_posting_id IS NOT NULL) OR (manual_job_snapshot IS NOT NULL)))
);

create table public.application_stage_events (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null,
  stage application_stage not null,
  changed_at timestamp with time zone not null default now(),
  constraint application_stage_events_pkey PRIMARY KEY (id),
  constraint application_stage_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  constraint application_stage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.match_scores (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  job_posting_id uuid not null,
  score integer not null,
  tier text not null,
  explanation jsonb not null default '{}'::jsonb,
  computed_at timestamp with time zone not null default now(),
  constraint match_scores_pkey PRIMARY KEY (id),
  constraint match_scores_user_id_job_posting_id_key UNIQUE (user_id, job_posting_id),
  constraint match_scores_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE,
  constraint match_scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint match_scores_score_check CHECK (((score >= 0) AND (score <= 100)))
);

create table public.job_tailoring_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  source_job_posting_id uuid,
  source_jd_text text not null,
  gap_analysis jsonb not null default '{}'::jsonb,
  tailored_resume_id uuid,
  tailored_cover_letter_id uuid,
  is_free_trial boolean not null default false,
  credits_spent integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint job_tailoring_requests_pkey PRIMARY KEY (id),
  constraint job_tailoring_requests_source_job_posting_id_fkey FOREIGN KEY (source_job_posting_id) REFERENCES job_postings(id),
  constraint job_tailoring_requests_tailored_cover_letter_id_fkey FOREIGN KEY (tailored_cover_letter_id) REFERENCES resumes(id),
  constraint job_tailoring_requests_tailored_resume_id_fkey FOREIGN KEY (tailored_resume_id) REFERENCES resumes(id),
  constraint job_tailoring_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.farah_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  role farah_message_role not null,
  content text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint farah_messages_pkey PRIMARY KEY (id),
  constraint farah_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.credit_packs (
  id uuid not null default gen_random_uuid(),
  name text not null,
  credits integer not null,
  price_ngn integer not null,
  is_active boolean not null default true,
  constraint credit_packs_pkey PRIMARY KEY (id)
);

create table public.passes (
  id uuid not null default gen_random_uuid(),
  name text not null,
  duration_days integer not null,
  price_ngn integer not null,
  is_active boolean not null default true,
  constraint passes_pkey PRIMARY KEY (id)
);

create table public.credit_ledger (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  delta integer not null,
  reason credit_reason not null,
  related_entity_id uuid,
  balance_after integer not null,
  created_at timestamp with time zone not null default now(),
  constraint credit_ledger_pkey PRIMARY KEY (id),
  constraint credit_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.credit_gate_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  reason credit_reason not null,
  credits_required integer not null,
  credits_available integer not null,
  outcome credit_gate_outcome not null,
  related_entity_id uuid,
  created_at timestamp with time zone not null default now(),
  constraint credit_gate_events_pkey PRIMARY KEY (id),
  constraint credit_gate_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- payment_transactions and user_passes reference each other, so one FK is
-- added after both tables exist.
create table public.payment_transactions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  rail text not null default 'paystack'::text,
  amount integer not null,
  currency text not null default 'NGN'::text,
  product_type payment_product_type not null,
  product_id uuid not null,
  paystack_reference text,
  status payment_status not null default 'pending'::payment_status,
  created_at timestamp with time zone not null default now(),
  channel text,
  authorization_code text,
  renewal_for_pass_id uuid,
  constraint payment_transactions_pkey PRIMARY KEY (id),
  constraint payment_transactions_paystack_reference_key UNIQUE (paystack_reference),
  constraint payment_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id),
  constraint payment_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.user_passes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  pass_id uuid not null,
  started_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  payment_method pass_payment_method not null,
  auto_renew boolean not null default false,
  status text not null default 'active'::text,
  created_at timestamp with time zone not null default now(),
  auto_renew_status pass_auto_renew_status,
  next_renewal_date date,
  authorization_code text,
  renewal_reminder_sent_at timestamp with time zone,
  payment_transaction_id uuid,
  constraint user_passes_pkey PRIMARY KEY (id),
  constraint user_passes_pass_id_fkey FOREIGN KEY (pass_id) REFERENCES passes(id),
  constraint user_passes_payment_transaction_id_fkey FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL,
  constraint user_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

alter table public.payment_transactions
  add constraint payment_transactions_renewal_for_pass_id_fkey
  FOREIGN KEY (renewal_for_pass_id) REFERENCES user_passes(id) ON DELETE SET NULL;

create table public.user_template_unlocks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  template_id uuid not null,
  unlocked_at timestamp with time zone not null default now(),
  constraint user_template_unlocks_pkey PRIMARY KEY (id),
  constraint user_template_unlocks_user_id_template_id_key UNIQUE (user_id, template_id),
  constraint user_template_unlocks_template_id_fkey FOREIGN KEY (template_id) REFERENCES resume_templates(id) ON DELETE CASCADE,
  constraint user_template_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

create table public.referrals (
  id uuid not null default gen_random_uuid(),
  referrer_id uuid not null,
  referred_user_id uuid,
  status referral_status not null default 'invited'::referral_status,
  reward_credits_referrer integer not null default 0,
  reward_credits_referred integer not null default 0,
  created_at timestamp with time zone not null default now(),
  activated_at timestamp with time zone,
  signed_up_at timestamp with time zone,
  constraint referrals_pkey PRIMARY KEY (id),
  constraint referrals_referred_user_id_key UNIQUE (referred_user_id),
  constraint referrals_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint referrals_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES profiles(id) ON DELETE CASCADE
);

create table public.referral_shares (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  channel text not null,
  created_at timestamp with time zone not null default now(),
  constraint referral_shares_pkey PRIMARY KEY (id),
  constraint referral_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  constraint referral_shares_channel_check CHECK ((channel = ANY (ARRAY['copy_link'::text, 'whatsapp'::text, 'email'::text, 'social'::text])))
);

create table public.scholarships (
  id uuid not null default gen_random_uuid(),
  provider text not null,
  program_name text not null,
  host_institution text,
  degree_levels scholarship_degree_level[] not null default '{}'::scholarship_degree_level[],
  field_tags text[] not null default '{}'::text[],
  funding_type scholarship_funding_type not null,
  funding_covers text[] not null default '{}'::text[],
  eligibility_nationalities text[] not null default '{}'::text[],
  eligibility_prior_degree text,
  eligibility_age text,
  eligibility_other text,
  application_deadline date,
  cycle_year integer,
  official_url text not null,
  source_name text,
  last_checked_at timestamp with time zone not null default now(),
  moderation_status scholarship_moderation_status not null default 'pending'::scholarship_moderation_status,
  moderation_note text,
  moderated_at timestamp with time zone,
  dedup_fingerprint text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deadline_verified_at timestamp with time zone,
  deadline_note text,
  constraint scholarships_pkey PRIMARY KEY (id),
  constraint scholarships_dedup_fingerprint_key UNIQUE (dedup_fingerprint)
);

create table public.scholarship_saves (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  scholarship_id uuid not null,
  status scholarship_save_status not null default 'saved'::scholarship_save_status,
  notes text,
  outcome_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint scholarship_saves_pkey PRIMARY KEY (id),
  constraint scholarship_saves_user_id_scholarship_id_key UNIQUE (user_id, scholarship_id),
  constraint scholarship_saves_scholarship_id_fkey FOREIGN KEY (scholarship_id) REFERENCES scholarships(id) ON DELETE CASCADE,
  constraint scholarship_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- indexes (constraint-backed indexes are implied by the constraints above)
-- ---------------------------------------------------------------------------
CREATE INDEX application_stage_events_application_id_idx ON public.application_stage_events USING btree (application_id);
CREATE INDEX application_stage_events_user_id_stage_idx ON public.application_stage_events USING btree (user_id, stage);
CREATE INDEX applications_job_posting_id_idx ON public.applications USING btree (job_posting_id);
CREATE INDEX applications_user_id_idx ON public.applications USING btree (user_id);
CREATE INDEX credit_gate_events_outcome_idx ON public.credit_gate_events USING btree (outcome, created_at DESC);
CREATE INDEX credit_gate_events_user_idx ON public.credit_gate_events USING btree (user_id, created_at DESC);
CREATE INDEX credit_ledger_user_id_idx ON public.credit_ledger USING btree (user_id);
CREATE INDEX farah_messages_user_id_idx ON public.farah_messages USING btree (user_id);
CREATE UNIQUE INDEX job_postings_dedup_fingerprint_idx ON public.job_postings USING btree (dedup_fingerprint);
CREATE INDEX job_postings_organization_id_idx ON public.job_postings USING btree (organization_id);
CREATE INDEX job_postings_source_type_idx ON public.job_postings USING btree (source_type);
CREATE INDEX job_postings_status_idx ON public.job_postings USING btree (status);
CREATE INDEX job_tailoring_requests_user_id_idx ON public.job_tailoring_requests USING btree (user_id);
CREATE INDEX match_scores_job_posting_id_idx ON public.match_scores USING btree (job_posting_id);
CREATE INDEX organization_members_user_id_idx ON public.organization_members USING btree (user_id);
CREATE INDEX payment_transactions_user_id_idx ON public.payment_transactions USING btree (user_id);
CREATE INDEX referral_shares_user_id_idx ON public.referral_shares USING btree (user_id);
-- Enforces plan-doc M1's "one base resume per user" (migration 0010).
CREATE UNIQUE INDEX resumes_one_base_per_user_idx ON public.resumes USING btree (user_id) WHERE (is_base = true);
CREATE INDEX resumes_user_id_idx ON public.resumes USING btree (user_id);
CREATE INDEX scholarship_saves_user_idx ON public.scholarship_saves USING btree (user_id);
CREATE INDEX scholarships_deadline_idx ON public.scholarships USING btree (application_deadline);
CREATE INDEX scholarships_moderation_idx ON public.scholarships USING btree (moderation_status);
CREATE INDEX user_passes_user_id_idx ON public.user_passes USING btree (user_id);

-- ---------------------------------------------------------------------------
-- functions
--
-- All SECURITY DEFINER functions pin search_path and have EXECUTE revoked from
-- the world, per migrations 0016/0017. is_org_member is the one granted to
-- `authenticated`, because RLS policies execute as the calling role (0026).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_referral_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  code text;
begin
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = code);
  end loop;
  return code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.count_rewarded_referrals_last_30d(p_referrer_id uuid, p_exclude_referral_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct related_entity_id)::int
  from public.credit_ledger
  where user_id = p_referrer_id
    and reason in ('referral_signup_bonus', 'referral_activation_bonus')
    and created_at >= now() - interval '30 days'
    and (p_exclude_referral_id is null or related_entity_id is distinct from p_exclude_referral_id);
$function$
;

CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_referral_id uuid, p_referrer_id uuid, p_amount integer, p_reason credit_reason)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_balance int;
  new_balance int;
begin
  if public.count_rewarded_referrals_last_30d(p_referrer_id, p_referral_id) >= 10 then
    return;
  end if;

  select credits_balance into current_balance from public.profiles where id = p_referrer_id;
  new_balance := coalesce(current_balance, 0) + p_amount;

  insert into public.credit_ledger (user_id, delta, reason, related_entity_id, balance_after)
  values (p_referrer_id, p_amount, p_reason, p_referral_id, new_balance);

  update public.referrals
  set reward_credits_referrer = reward_credits_referrer + p_amount
  where id = p_referral_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_and_activate_referral(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referral_id uuid;
  v_referrer_id uuid;
  v_activated boolean;
begin
  select id, referrer_id into v_referral_id, v_referrer_id
  from public.referrals
  where referred_user_id = p_user_id and status = 'signed_up'
  limit 1;

  if v_referral_id is null then
    return;
  end if;

  v_activated := exists (
    select 1 from public.resumes where user_id = p_user_id and is_base = true
  ) or exists (
    select 1 from public.applications where user_id = p_user_id and applied_at is not null
  );

  if not v_activated then
    return;
  end if;

  update public.referrals set status = 'activated', activated_at = now() where id = v_referral_id;
  perform public.grant_referral_reward(v_referral_id, v_referrer_id, 20, 'referral_activation_bonus');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_credit_ledger_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.profiles
  set credits_balance = new.balance_after,
      updated_at = now()
  where id = new.user_id;
  return new;
end;
$function$
;

-- Name precedence here is migration 0024's, and it is load-bearing: Google
-- sends no given_name, so the full_name/name split is what rescues it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referrer_id uuid;
  v_referrer_email text;
  v_new_email_norm text;
  v_referrer_email_norm text;
  v_referral_id uuid;
  v_meta jsonb;
  v_full text;
  v_first text;
  v_last text;
begin
  v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  if v_meta ->> 'referred_by_code' is not null then
    select id, email into v_referrer_id, v_referrer_email
    from public.profiles
    where referral_code = v_meta ->> 'referred_by_code';

    if v_referrer_id is not null and v_referrer_email is not null then
      v_new_email_norm := regexp_replace(lower(split_part(new.email, '@', 1)), '\+.*$', '')
        || '@' || split_part(lower(new.email), '@', 2);
      v_referrer_email_norm := regexp_replace(lower(split_part(v_referrer_email, '@', 1)), '\+.*$', '')
        || '@' || split_part(lower(v_referrer_email), '@', 2);

      if v_new_email_norm = v_referrer_email_norm then
        v_referrer_id := null;
      end if;
    end if;
  end if;

  v_full := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'name'), '')
  );

  v_first := coalesce(
    nullif(btrim(v_meta ->> 'first_name'), ''),
    nullif(btrim(v_meta ->> 'given_name'), ''),
    nullif(split_part(coalesce(v_full, ''), ' ', 1), '')
  );

  v_last := coalesce(
    nullif(btrim(v_meta ->> 'last_name'), ''),
    nullif(btrim(v_meta ->> 'family_name'), ''),
    case
      when v_full is not null and position(' ' in v_full) > 0
        then nullif(btrim(substr(v_full, position(' ' in v_full) + 1)), '')
      else null
    end
  );

  insert into public.profiles (id, first_name, last_name, email, country, referral_code, referred_by)
  values (
    new.id, v_first, v_last, new.email,
    v_meta ->> 'country', public.generate_referral_code(), v_referrer_id
  );

  if v_referrer_id is not null then
    insert into public.referrals (referrer_id, referred_user_id, status, signed_up_at)
    values (v_referrer_id, new.id, 'signed_up', now())
    returning id into v_referral_id;

    perform public.grant_referral_reward(v_referral_id, v_referrer_id, 5, 'referral_signup_bonus');
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_application_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.stage is distinct from old.stage then
    insert into public.application_stage_events (application_id, user_id, stage, changed_at)
    values (new.id, new.user_id, new.stage, now());
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_check_activation_from_applications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.applied_at is not null then
    perform public.check_and_activate_referral(new.user_id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_check_activation_from_resumes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.is_base then
    perform public.check_and_activate_referral(new.user_id);
  end if;
  return new;
end;
$function$
;

-- Breaks the self-reference that made organization_members' own SELECT policy
-- recurse. See 0026 for the full reasoning.
CREATE OR REPLACE FUNCTION public.is_org_member(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$function$
;

-- ---------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------
revoke all on function public.apply_credit_ledger_entry() from public;
grant execute on function public.apply_credit_ledger_entry() to postgres, service_role;

revoke all on function public.check_and_activate_referral(uuid) from public;
grant execute on function public.check_and_activate_referral(uuid) to postgres, service_role;

revoke all on function public.count_rewarded_referrals_last_30d(uuid, uuid) from public;
grant execute on function public.count_rewarded_referrals_last_30d(uuid, uuid) to postgres, service_role;

revoke all on function public.grant_referral_reward(uuid, uuid, integer, credit_reason) from public;
grant execute on function public.grant_referral_reward(uuid, uuid, integer, credit_reason) to postgres, service_role;

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to postgres, service_role;

revoke all on function public.log_application_stage_change() from public;
grant execute on function public.log_application_stage_change() to postgres, service_role;

revoke all on function public.trigger_check_activation_from_applications() from public;
grant execute on function public.trigger_check_activation_from_applications() to postgres, service_role;

revoke all on function public.trigger_check_activation_from_resumes() from public;
grant execute on function public.trigger_check_activation_from_resumes() to postgres, service_role;

-- NOTE, recorded rather than silently reproduced: on the live project this
-- function is also executable by `anon`. 0026 revoked from PUBLIC and granted
-- to authenticated/service_role, but Supabase's ALTER DEFAULT PRIVILEGES had
-- already granted anon at creation, and a REVOKE on PUBLIC does not remove a
-- role-specific grant. It leaks nothing — for anon, auth.uid() is null, so the
-- function can only ever return false — but the intent was authenticated-only.
-- Tightened in 0027.
revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to anon, authenticated, postgres, service_role;

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER applications_check_activation AFTER INSERT OR UPDATE OF applied_at ON public.applications FOR EACH ROW EXECUTE FUNCTION trigger_check_activation_from_applications();
CREATE TRIGGER applications_log_stage_change AFTER INSERT OR UPDATE OF stage ON public.applications FOR EACH ROW EXECUTE FUNCTION log_application_stage_change();
CREATE TRIGGER on_credit_ledger_insert AFTER INSERT ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION apply_credit_ledger_entry();
CREATE TRIGGER resumes_check_activation AFTER INSERT OR UPDATE OF is_base ON public.resumes FOR EACH ROW EXECUTE FUNCTION trigger_check_activation_from_resumes();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.application_stage_events enable row level security;
alter table public.applications enable row level security;
alter table public.credit_gate_events enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_packs enable row level security;
alter table public.farah_messages enable row level security;
alter table public.job_postings enable row level security;
alter table public.job_tailoring_requests enable row level security;
alter table public.match_scores enable row level security;
alter table public.organization_members enable row level security;
alter table public.organizations enable row level security;
alter table public.passes enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.profiles enable row level security;
alter table public.referral_shares enable row level security;
alter table public.referrals enable row level security;
alter table public.resume_templates enable row level security;
alter table public.resumes enable row level security;
alter table public.scholarship_saves enable row level security;
alter table public.scholarships enable row level security;
alter table public.user_passes enable row level security;
alter table public.user_template_unlocks enable row level security;

-- ---------------------------------------------------------------------------
-- policies
--
-- Coverage of these is asserted by tests/rls/cross-user.test.ts and
-- tests/rls/org-and-referral-scoping.test.ts. A table added here without a
-- corresponding test is uncovered — that omission is exactly what hid the
-- organization_members escalation for all of Phase 1.
-- ---------------------------------------------------------------------------

-- owner-only, full CRUD
create policy "resumes are owner-only" on public.resumes for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "applications are owner-only" on public.applications for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "match scores are owner-only" on public.match_scores for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "tailoring requests are owner-only" on public.job_tailoring_requests for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "farah messages are owner-only" on public.farah_messages for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "referral shares are owner-only" on public.referral_shares for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

create policy "scholarship saves are owner-only" on public.scholarship_saves for all
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- read-only to the owner; written by the service role only (ledger, payments,
-- events). No INSERT policy is deliberate — a user must not be able to grant
-- themselves credits or fabricate a payment.
create policy "application stage events are owner-readable" on public.application_stage_events for select
  using (((select auth.uid()) = user_id));

create policy "users can read their own gate events" on public.credit_gate_events for select
  using (((select auth.uid()) = user_id));

create policy "users can read their own credit ledger" on public.credit_ledger for select
  using (((select auth.uid()) = user_id));

create policy "users can read their own payment transactions" on public.payment_transactions for select
  using (((select auth.uid()) = user_id));

create policy "users can read their own passes" on public.user_passes for select
  using (((select auth.uid()) = user_id));

create policy "template unlocks are owner-only readable" on public.user_template_unlocks for select
  using (((select auth.uid()) = user_id));

-- profiles
create policy "profiles are self-readable" on public.profiles for select
  using (((select auth.uid()) = id));

create policy "profiles are self-updatable" on public.profiles for update
  using (((select auth.uid()) = id))
  with check (((select auth.uid()) = id));

-- referrals: visible to both parties, written only by the activation trigger
create policy "referrals are readable by either party" on public.referrals for select
  using ((((select auth.uid()) = referrer_id) or ((select auth.uid()) = referred_user_id)));

-- public catalogs
create policy "credit packs are publicly readable" on public.credit_packs for select
  using (true);

create policy "passes are publicly readable" on public.passes for select
  using (true);

create policy "resume templates are publicly readable" on public.resume_templates for select
  using (true);

create policy "organizations are publicly readable" on public.organizations for select
  using (true);

create policy "job postings are publicly readable" on public.job_postings for select
  using (true);

-- moderation gate: an unreviewed scholarship is invisible to everyone
create policy "only verified scholarships are publicly readable" on public.scholarships for select
  using ((moderation_status = 'verified'::scholarship_moderation_status));

-- organisations and membership (all as amended by 0026)
create policy "authenticated users can create an organization" on public.organizations for insert
  to authenticated
  with check ((created_by = (select auth.uid())));

create policy "org members can update their organization" on public.organizations for update
  using (is_org_member(id))
  with check (is_org_member(id));

create policy "a user can join an organisation they created" on public.organization_members for insert
  to authenticated
  with check (((user_id = (select auth.uid())) and (exists (
    select 1 from organizations o
    where ((o.id = organization_members.organization_id) and (o.created_by = (select auth.uid())))
  ))));

create policy "members can see their own membership rows" on public.organization_members for select
  using (((user_id = (select auth.uid())) or is_org_member(organization_id)));

create policy "org members can manage their org's internal postings" on public.job_postings for insert
  to authenticated
  with check (((source_type = 'internal'::job_source_type) and is_org_member(organization_id)));

create policy "org members can update their org's internal postings" on public.job_postings for update
  using (((source_type = 'internal'::job_source_type) and is_org_member(organization_id)))
  with check (((source_type = 'internal'::job_source_type) and is_org_member(organization_id)));
