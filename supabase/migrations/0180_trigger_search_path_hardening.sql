-- 0180 — send-374: `set search_path = ''` on two trigger functions that
-- were missing it, closing the `function_search_path_mutable` advisor
-- WARN on both.
--
-- enforce_max_assessment_files (0178/send-364) was the function send-366
-- originally asked to fix; that migration number (0179) got reused by
-- send-365's own, unrelated migration instead, and the search-path fix was
-- never actually applied anywhere — confirmed directly against production:
-- no migration between 0178 and 0179 touches this function, and the
-- advisor still listed it before this migration was written.
--
-- enforce_max_screening_questions (0171_screening_questions.sql, an
-- earlier, separate feature) has the identical gap, found while
-- re-checking for send-366's own class of issue rather than assuming it
-- was the only instance.
--
-- Both bodies are reproduced here EXACTLY as read from production via
-- `pg_get_functiondef` before writing this migration (not guessed from
-- the function names) — the only change in either is the added
-- `set search_path = ''` line. Neither function's own logic changes.
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
