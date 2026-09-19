-- send-374 — reissues the search-path fix for `enforce_max_screening_questions`
-- (0171) and `enforce_max_assessment_files` (0178): both were created with no
-- `set search_path`, which Supabase's own linter flags as "Function Search
-- Path Mutable" (confirmed still live on production before writing this,
-- 2026-09-19 — not assumed).
--
-- Neither function is SECURITY DEFINER, so this is not the privilege-
-- escalation shape 0027/0032's own history warns about (a caller's session
-- role can already read/write the tables these triggers fire on, so a
-- hijacked search_path here would not grant anything the caller couldn't
-- already do directly). It is still worth closing: both functions already
-- write every table reference schema-qualified (`public.job_posting_
-- screening_questions`, `public.job_posting_assessment_files`), so setting
-- `search_path = ''` costs nothing — there is no unqualified reference that
-- could break — and it is what the linter's own remediation asks for.
--
-- `create or replace function` with the identical body, `returns trigger`,
-- and `language plpgsql` — only `set search_path = ''` is new. The existing
-- triggers (`enforce_max_screening_questions_trigger`,
-- `job_posting_assessment_files_cap`) reference the function by name, not by
-- a stored body, so replacing it in place is enough; no trigger needs to be
-- dropped or recreated.

create or replace function public.enforce_max_screening_questions()
returns trigger
language plpgsql
set search_path = ''
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

create or replace function public.enforce_max_assessment_files()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.job_posting_assessment_id::text, 0));

  select count(*) into v_count
  from public.job_posting_assessment_files
  where job_posting_assessment_id = new.job_posting_assessment_id;

  if v_count >= 5 then
    raise exception 'An assessment can have at most 5 files attached.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_max_assessment_files() is
  'send-364 — the 5-file cap''s real enforcement (the API route''s own pre-check is just a nicer error message; this is what actually cannot be raced). Takes a per-assessment advisory lock before counting, closing the "two concurrent uploads both see count=4" window a plain count-then-insert would leave open. search_path pinned to '''' by 0180 (send-374) — every table reference here is already schema-qualified, so this closes the linter finding at no behavioural cost.';
