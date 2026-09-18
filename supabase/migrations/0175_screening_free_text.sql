-- 0175 — a third screening-question type: open-ended written response
-- (send-344), following up 0171.
--
-- ── WHY THIS IS A NEW TYPE, NOT A CONFIG TWEAK ──────────────────────────────
--
-- 0171's own header is explicit that yes_no and min_number exist because
-- they're auto-gradable — "matching the recruiter's own concrete examples...
-- rather than a general form-builder." A written answer has nothing to
-- grade: there is no pass/fail to compute from free text without a
-- keyword-matcher or an LLM verdict, and this migration deliberately adds
-- neither. free_text keeps 0171's own philosophy (screening never blocks an
-- application) but simplifies it further: there is no "passing answer" to
-- configure at all, only whether the question is required.
--
-- ── THE ONE RULE THAT MATTERS: REQUIRED MEANS ANSWERED, NOT CORRECT ─────────
--
-- Once a required free_text question is answered with a non-empty (after
-- trimming) string, it counts as passed = true for screening_passed's
-- overall computation — same "required means answered" contract yes_no and
-- min_number already have for completeness, just with no correctness check
-- layered on top. A required free_text question can therefore make
-- screening_passed go from null to true/false (by being answered, alongside
-- whatever other questions exist), but can never itself be the reason
-- screening_passed reads false — only a graded (yes_no/min_number) question
-- can produce a false. An all-whitespace answer counts as UNANSWERED, the
-- same way an omitted min_number answer does today — see
-- submit_screening_answers' own updated loop below.

alter table public.job_posting_screening_questions
  drop constraint job_posting_screening_questions_question_type_check;

alter table public.job_posting_screening_questions
  add constraint job_posting_screening_questions_question_type_check
    check (question_type in ('yes_no', 'min_number', 'free_text'));

alter table public.job_posting_screening_questions
  drop constraint job_posting_screening_questions_config_check;

alter table public.job_posting_screening_questions
  add constraint job_posting_screening_questions_config_check check (
    (question_type = 'yes_no' and expected_yes_no is not null and min_value is null)
    or
    (question_type = 'min_number' and min_value is not null and expected_yes_no is null)
    or
    (question_type = 'free_text' and expected_yes_no is null and min_value is null)
  );

comment on table public.job_posting_screening_questions is
  'Up to 5 employer-authored screening questions per job posting (send-327, send-344). Three types: yes_no and min_number are auto-graded (passing = a specific boolean / answer >= min_value); free_text has no grading at all — required means answered, not correct. Readable by anyone who can read the job posting itself (same RLS shape as job_postings); writable only by the owning org. The 5-question cap (enforce_max_screening_questions_trigger) counts all three types toward the same total.';

-- No change to enforce_max_screening_questions_trigger — free_text questions
-- count toward the same 5-question cap as the other two, deliberately not
-- special-cased.

alter table public.application_screening_answers
  add column answer_text text;

alter table public.application_screening_answers
  add constraint application_screening_answers_answer_text_length_check
    check (answer_text is null or char_length(answer_text) <= 2000);

comment on column public.application_screening_answers.answer_text is
  'send-344 — the candidate''s written response to a free_text question, trimmed, capped at 2000 characters (a short self-assessment, not a cover letter). Null for yes_no/min_number answers. No table-level exclusivity check against answer_yes_no/answer_number, same as 0171''s own reasoning: submit_screening_answers is the sole write path (no direct insert policy exists on this table at all) and already enforces per-type exclusivity there.';

-- ── submit_screening_answers: add the free_text branch ──────────────────────
--
-- Additive to the existing per-question loop, not a rewrite. Immutability
-- guard, ownership check, and the three-valued v_overall computation are
-- all unchanged from 0171.
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
  v_text_answer text;
  v_all_required_answered boolean := true;
  v_all_required_passed boolean := true;
  v_has_required boolean := false;
  v_overall boolean;
begin
  select job_posting_id into v_job_posting_id
  from public.applications
  where id = p_application_id and user_id = auth.uid();

  if v_job_posting_id is null then
    raise exception 'No such application for the current user.';
  end if;

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

    select a into v_answer
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) a
    where (a ->> 'question_id')::uuid = v_question.id
    limit 1;

    if v_question.question_type = 'free_text' then
      -- Trimmed before the emptiness check: an all-whitespace string must
      -- count as unanswered, the same way a min_number question with no
      -- number sent counts as unanswered — see 0171's own header for the
      -- three-valued meaning this feeds into. Deliberately regexp_replace,
      -- NOT plain trim(): SQL's bare trim() strips only ASCII space
      -- characters, not tabs or newlines, so a "\t\n"-only answer would
      -- survive plain trim() as a non-empty string and be misread as a
      -- real answer — caught by this migration's own test suite sending
      -- exactly that string before this fix.
      v_text_answer := nullif(regexp_replace(coalesce(v_answer ->> 'answer_text', ''), '^\s+|\s+$', '', 'g'), '');
      v_any_answer := v_text_answer is not null;
    else
      v_any_answer := v_answer is not null;
    end if;

    if v_any_answer then
      if v_question.question_type = 'yes_no' then
        v_passed := (v_answer ->> 'answer_yes_no')::boolean = v_question.expected_yes_no;
      elsif v_question.question_type = 'min_number' then
        v_passed := (v_answer ->> 'answer_number')::numeric >= v_question.min_value;
      else
        -- free_text is never graded — answered is the whole bar. See this
        -- migration's own header for why this can only ever contribute a
        -- true, never a false, to the overall result below.
        v_passed := true;
      end if;

      insert into public.application_screening_answers (
        application_id, question_id, answer_yes_no, answer_number, answer_text, passed
      ) values (
        p_application_id,
        v_question.id,
        case when v_question.question_type = 'yes_no' then (v_answer ->> 'answer_yes_no')::boolean end,
        case when v_question.question_type = 'min_number' then (v_answer ->> 'answer_number')::numeric end,
        case when v_question.question_type = 'free_text' then v_text_answer end,
        v_passed
      );

      if v_question.required and not v_passed then
        v_all_required_passed := false;
      end if;
    elsif v_question.required then
      -- A required question with no answer at all: not passed, and the
      -- overall result cannot be "complete" either — see the three-valued
      -- meaning in 0171's own header.
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

-- ── employer_application_screening_answers: a NEW, separate read path ───────
--
-- Deliberately NOT another widen of employer_job_applicants (already widened
-- three times: 0125 -> 0154 -> 0170 -> 0172). Raw answer text is a different
-- shape of read — potentially several fields per applicant, only needed when
-- a recruiter actually opens the detail, not on every row of a page that
-- runs for every applicant on every load. Follows the same on-demand
-- precedent this app already has for resume content
-- (src/app/employer/jobs/[id]/applicants/[applicationId]/resume/page.tsx) —
-- its own route, fetched on demand, never embedded in the list query.
create or replace function public.employer_application_screening_answers(
  p_application_id uuid
)
returns table (
  question_text text,
  question_type text,
  required boolean,
  answer_yes_no boolean,
  answer_number numeric,
  answer_text text,
  passed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.question_text,
    q.question_type,
    q.required,
    a.answer_yes_no,
    a.answer_number,
    a.answer_text,
    a.passed
  from public.applications app
  join public.job_postings j on j.id = app.job_posting_id
  join public.job_posting_screening_questions q on q.job_posting_id = app.job_posting_id
  left join public.application_screening_answers a
    on a.question_id = q.id and a.application_id = app.id
  where app.id = p_application_id
    and public.is_org_member(j.organization_id)
  order by q.sort_order;
$$;

revoke all on function public.employer_application_screening_answers(uuid) from public;
revoke all on function public.employer_application_screening_answers(uuid) from anon;
grant execute on function public.employer_application_screening_answers(uuid) to authenticated, service_role;

comment on function public.employer_application_screening_answers(uuid) is
  'send-344 — one row per screening question on the given application''s job posting (LEFT JOINed against the candidate''s actual answers, so an unanswered question still shows rather than disappearing), scoped to the caller''s own organisation via is_org_member — same ownership gate as employer_job_applicants, no client-supplied org id. On-demand detail read, not embedded in the applicant list query — see this migration''s own header.';
