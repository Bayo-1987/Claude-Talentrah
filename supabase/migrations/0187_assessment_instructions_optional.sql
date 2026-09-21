-- send-448 — Instructions is no longer a hard requirement on a job
-- posting's assessment. A recruiter who already points candidates at a
-- link or an uploaded exercise document was being forced to duplicate
-- that content into the rich-text box just to satisfy this column, with
-- no way around it.
--
-- `exercise_link` is nullable and already means "not set" via NULL, not
-- an empty string — this brings `instructions` in line with that same
-- idiom rather than inventing a second "no value" representation
-- (an empty string) for the same table. Application code
-- (parseJobPostingAssessmentForm) sends NULL when the field is left
-- blank, matching exerciseLink's own `rawLink || null` pattern.
--
-- Additive and reversible: dropping NOT NULL never rejects a write that
-- would have succeeded before, so every existing row (all of which
-- already have real instructions text) is unaffected.
alter table public.job_posting_assessments
  alter column instructions drop not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_posting_assessments'
      and column_name = 'instructions'
      and is_nullable = 'NO'
  ) then
    raise exception 'job_posting_assessments.instructions is still NOT NULL after 0187';
  end if;
end $$;
