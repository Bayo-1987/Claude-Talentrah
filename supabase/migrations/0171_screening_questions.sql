-- 0171 — employer-authored screening questions (send-327): the actual
-- "pre-application self-assessment" real recruiter feedback asked for, not
-- just a post-application sort (send-326) or a post-application badge
-- (send-328).
--
-- ── BLOCK VS FLAG, DECIDED ─────────────────────────────────────────────────
--
-- A failed screening question NEVER blocks a seeker from applying. The
-- application always goes through; `applications.screening_passed` is
-- computed and surfaced to the employer, but nothing in this schema or the
-- apply flow refuses a submission because of it. Self-reported yes/no
-- answers with no verification are an easy way to accidentally screen
-- someone out over a technicality (a borderline "3+ years" answer, a
-- misread question), and nothing else on this product blocks a seeker's own
-- action on their own record — the Job Tracker allows manual entries and
-- free stage corrections for the identical reason. The recruiter's actual
-- problem (the pile) is solved employer-side, via send-326's filter
-- mechanism once this ships.
--
-- ── TWO QUESTION TYPES ONLY, UP TO 5 PER POSTING ────────────────────────────
--
-- Matching the recruiter's own concrete examples ("Authorized to work in
-- Nigeria?", "Years of experience in X") rather than a general form-builder.
-- The 5-question cap is enforced by a trigger below, not a CHECK constraint —
-- a CHECK cannot see sibling rows.
--
-- ── ANSWERS ARE IMMUTABLE AFTER SUBMISSION ─────────────────────────────────
--
-- No UPDATE policy exists on application_screening_answers at all, and the
-- submit function below refuses a second call once any answer exists for an
-- application — a candidate must not be able to revise an answer after
-- seeing their status, which would turn a self-assessment into a way to game
-- the result once it's known to matter. There is no "resume where you left
-- off" partial-completion flow: one call, one shot, same as a real
-- self-assessment should work.
--
-- ── screening_passed's THREE-VALUED MEANING ─────────────────────────────────
--
-- null = the job has no screening questions, OR this application's answers
--        are not yet complete (some but not all REQUIRED questions
--        answered) — never read as "passed" and never read as "failed",
--        because neither claim is true yet.
-- true = every required question was answered and every one passed.
-- false = every required question was answered and at least one failed.
--
-- Computed once, at answer-submission time, inside submit_screening_answers
-- below — never recomputed live by the employer-facing render, the same
-- "check and act in one place" instinct spend_credits_atomic (0035) applies
-- to money, pointed here at display-correctness instead.

create table public.job_posting_screening_questions (
  id uuid not null default gen_random_uuid(),
  job_posting_id uuid not null,
  question_text text not null,
  question_type text not null,
  required boolean not null default true,
  expected_yes_no boolean,
  min_value numeric,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint job_posting_screening_questions_pkey primary key (id),
  constraint job_posting_screening_questions_job_posting_id_fkey
    foreign key (job_posting_id) references public.job_postings (id) on delete cascade,
  constraint job_posting_screening_questions_question_type_check
    check (question_type in ('yes_no', 'min_number')),
  -- Exactly the config field its own type needs, never both, never neither —
  -- an ambiguous row (both set, or neither) is a data-integrity bug at
  -- write time, not something the read side should have to guess about.
  constraint job_posting_screening_questions_config_check check (
    (question_type = 'yes_no' and expected_yes_no is not null and min_value is null)
    or
    (question_type = 'min_number' and min_value is not null and expected_yes_no is null)
  )
);

comment on table public.job_posting_screening_questions is
  'Up to 5 employer-authored screening questions per job posting (send-327). Two types only: yes_no (passing = a specific boolean answer) and min_number (passing = answer >= min_value). Readable by anyone who can read the job posting itself (same RLS shape as job_postings — see policy below); writable only by the owning org.';

create table public.application_screening_answers (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  question_id uuid not null,
  answer_yes_no boolean,
  answer_number numeric,
  passed boolean not null,
  created_at timestamp with time zone not null default now(),
  constraint application_screening_answers_pkey primary key (id),
  constraint application_screening_answers_application_id_fkey
    foreign key (application_id) references public.applications (id) on delete cascade,
  constraint application_screening_answers_question_id_fkey
    foreign key (question_id) references public.job_posting_screening_questions (id) on delete cascade,
  -- One answer per (application, question) at the database level too, not
  -- just "the function happens not to call itself twice" — belt and
  -- suspenders for the immutability claim above.
  constraint application_screening_answers_application_id_question_id_key
    unique (application_id, question_id)
);

comment on table public.application_screening_answers is
  'A candidate''s self-reported answer to one screening question, and the pass/fail computed from it AT WRITE TIME (send-327) — never recomputed live. Immutable: no UPDATE policy exists, and submit_screening_answers() below refuses to insert a second batch for an application that already has any answers.';

alter table public.applications add column screening_passed boolean;

comment on column public.applications.screening_passed is
  'null = the job has no screening questions, or this application''s required questions are not all answered yet. true/false only once every required question has a recorded answer (send-327). Never gates whether the application itself was accepted — see this migration''s own header for the block-vs-flag decision.';

-- The 5-question cap. A CHECK constraint cannot see sibling rows, so this has
-- to be a trigger — same reason auto_apply's own per-window caps (0034) are
-- enforced in a function rather than a constraint.
create or replace function public.enforce_max_screening_questions()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*) from public.job_posting_screening_questions
    where job_posting_id = new.job_posting_id
  ) >= 5 then
    raise exception 'A job posting may have at most 5 screening questions.';
  end if;
  return new;
end;
$$;

create trigger enforce_max_screening_questions_trigger
  before insert on public.job_posting_screening_questions
  for each row
  execute function public.enforce_max_screening_questions();

alter table public.job_posting_screening_questions enable row level security;
alter table public.application_screening_answers enable row level security;

-- Same shape as job_postings' own "publicly readable" policy (0000) — a
-- question has to render on the public apply flow for a signed-in seeker,
-- and there's no more sensitive here than in the posting itself.
create policy "screening questions are publicly readable" on public.job_posting_screening_questions
  for select using (true);

-- Same shape as job_postings' own insert/update policies (0000): the owning
-- org's members only, and only for postings that are actually theirs.
create policy "org members can manage their own postings' screening questions"
  on public.job_posting_screening_questions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_screening_questions.job_posting_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_screening_questions.job_posting_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  );

-- The applying user can read their own answers back (e.g. to render "you
-- already answered this" if they revisit) — never anyone else's, and never
-- the employer directly (the employer-facing surface reads the DERIVED
-- applications.screening_passed through employer_job_applicants, a
-- SECURITY DEFINER function, not this table).
create policy "a seeker can read their own screening answers" on public.application_screening_answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_screening_answers.application_id
        and a.user_id = (select auth.uid())
    )
  );

-- Deliberately NO insert/update policy on application_screening_answers for
-- any role — every write goes through submit_screening_answers() below,
-- which is SECURITY DEFINER and does its own ownership + immutability
-- checks. A permissive insert policy here would let a client insert answers
-- (and therefore `passed`) directly, bypassing the computed-at-write-time
-- guarantee this whole design exists for.

/**
 * Records a candidate's screening answers for one application, computing
 * `passed` per answer and `applications.screening_passed` overall, in one
 * statement — see this migration's own header for the three-valued meaning
 * and the immutability guarantee.
 *
 * p_answers shape: jsonb array of {"question_id": uuid, "answer_yes_no":
 * boolean|null, "answer_number": numeric|null}. Only one of the two answer
 * fields is meaningful per question, per its own type — same shape as the
 * questions table itself.
 */
create or replace function public.submit_screening_answers(
  p_application_id uuid,
  p_answers jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_posting_id uuid;
  v_question record;
  v_answer jsonb;
  v_passed boolean;
  v_any_answer boolean;
  v_all_required_answered boolean := true;
  v_all_required_passed boolean := true;
  v_has_required boolean := false;
  v_overall boolean;
begin
  -- Ownership: the caller must be the applying user. Never a client-supplied
  -- user id — the same "never a client-supplied organization id" reasoning
  -- 0135 states for talent_directory_search, applied to the shape this
  -- table has (a one-sided "this is my own application" claim).
  select job_posting_id into v_job_posting_id
  from public.applications
  where id = p_application_id and user_id = auth.uid();

  if v_job_posting_id is null then
    raise exception 'No such application for the current user.';
  end if;

  -- Immutability: refuse outright if ANY answer already exists for this
  -- application, rather than silently overwriting or accepting a
  -- "completing a partial submission" second call — one call, one shot.
  if exists (
    select 1 from public.application_screening_answers
    where application_id = p_application_id
  ) then
    raise exception 'Screening answers have already been submitted for this application and cannot be revised.';
  end if;

  for v_question in
    select id, question_type, required, expected_yes_no, min_value
    from public.job_posting_screening_questions
    where job_posting_id = v_job_posting_id
  loop
    if v_question.required then
      v_has_required := true;
    end if;

    -- Find the matching answer for this question, if the caller sent one.
    select a into v_answer
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    where (a ->> 'question_id')::uuid = v_question.id
    limit 1;

    v_any_answer := v_answer is not null;

    if v_any_answer then
      if v_question.question_type = 'yes_no' then
        v_passed := (v_answer ->> 'answer_yes_no')::boolean = v_question.expected_yes_no;
      else
        v_passed := (v_answer ->> 'answer_number')::numeric >= v_question.min_value;
      end if;

      insert into public.application_screening_answers (
        application_id, question_id, answer_yes_no, answer_number, passed
      ) values (
        p_application_id,
        v_question.id,
        case when v_question.question_type = 'yes_no' then (v_answer ->> 'answer_yes_no')::boolean end,
        case when v_question.question_type = 'min_number' then (v_answer ->> 'answer_number')::numeric end,
        v_passed
      );

      if v_question.required and not v_passed then
        v_all_required_passed := false;
      end if;
    elsif v_question.required then
      -- A required question with no answer at all: not passed, and the
      -- overall result cannot be "complete" either — see the three-valued
      -- meaning in this migration's own header.
      v_all_required_answered := false;
      v_all_required_passed := false;
    end if;
  end loop;

  -- Three-valued result: no questions at all, or nothing REQUIRED, means
  -- there is nothing to gate on — leave null rather than manufacture a
  -- claim. Otherwise null until every required question is answered, then
  -- true/false.
  if not v_has_required then
    v_overall := null;
  elsif not v_all_required_answered then
    v_overall := null;
  else
    v_overall := v_all_required_passed;
  end if;

  update public.applications
  set screening_passed = v_overall
  where id = p_application_id;

  return v_overall;
end;
$$;

revoke all on function public.submit_screening_answers(uuid, jsonb) from public, anon;
grant execute on function public.submit_screening_answers(uuid, jsonb) to authenticated;
