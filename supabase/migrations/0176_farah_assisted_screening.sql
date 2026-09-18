-- 0176 — "Let Farah screen this for you": an opt-in, paid, per-question AI
-- review of free_text screening answers (send-345 Part B), following up
-- 0175. Sequenced strictly after 0175 (the free_text question type it
-- depends on) and blocked on it being merged/live, per the founder's own
-- explicit instruction that this work is NOT parallel to that one.
--
-- ── WHAT THIS DOES NOT TOUCH ─────────────────────────────────────────────
--
-- Farah's review is a separate, clearly-labeled ADVISORY annotation, never a
-- second grading mechanism. `application_screening_answers.passed` is set
-- exactly once, by submit_screening_answers (0171/0175), and stays whatever
-- it was — true the moment a free_text question is answered, per 0175's own
-- "required means answered, not correct" rule. A skipped or failed Farah
-- review NEVER changes `passed`, and never blocks or delays the candidate's
-- application. This migration adds no trigger, no constraint, and no
-- function that writes `passed` for any reason.
--
-- ── TIER VOCABULARY: STRONG / ADEQUATE / WEAK, NEVER THE MATCH-TIER WORDS ──
--
-- Excellent/Good/Fair is the match-score system's own fixed, exactly-three
-- vocabulary (docs/match-confidence-invariant.md) — reusing it here would
-- imply a numeric confidence Farah's qualitative read of one written answer
-- does not have, and this repo has a hard rule against a 4th match tier or
-- repurposing the existing 3. `farah_tier` is a CHECK-enforced, disjoint
-- vocabulary so the two can never be confused in the schema itself.
--
-- ── screening_mode IS PER-QUESTION, AND ONLY VALID FOR free_text ───────────
--
-- 'self' (default) is today's behaviour — nothing changes for any existing
-- question until an employer opts a specific free_text question in. The
-- CHECK below makes "farah mode on a yes_no/min_number question" impossible
-- at the schema level, not just an app-layer rule the owner-only FOR ALL
-- policy could otherwise be reached around (the same reasoning 0037's
-- terminal-hired trigger gives for why an invariant this load-bearing
-- belongs in a constraint, not a Server Action check).

alter table public.job_posting_screening_questions
  add column screening_mode text not null default 'self';

alter table public.job_posting_screening_questions
  add constraint job_posting_screening_questions_screening_mode_check
    check (screening_mode in ('self', 'farah'));

alter table public.job_posting_screening_questions
  add constraint job_posting_screening_questions_farah_requires_free_text_check
    check (screening_mode = 'self' or question_type = 'free_text');

comment on column public.job_posting_screening_questions.screening_mode is
  'send-345 — ''self'' (default): the employer reads the raw answer themselves, unchanged behaviour. ''farah'': an LLM-generated advisory tier/summary is attached on top of the raw answer, billed per review from the employer''s ad wallet. Only valid on a free_text question (see the farah_requires_free_text_check constraint) — yes_no/min_number are already graded and have nothing for Farah to add.';

-- ── application_screening_answers: Farah's advisory annotation ─────────────
--
-- Three columns, all nullable — most answers on most postings will never
-- have a Farah review at all (screening_mode defaults to 'self'), and even
-- on a farah-mode question a review can be skipped (no balance) or fail
-- (the LLM call itself), in which case tier/summary stay null and only
-- farah_review_status records what happened.

alter table public.application_screening_answers
  add column farah_review_status text,
  add column farah_tier text,
  add column farah_summary text;

alter table public.application_screening_answers
  add constraint application_screening_answers_farah_review_status_check
    check (farah_review_status is null or farah_review_status in ('completed', 'skipped_insufficient_balance', 'skipped_error'));

alter table public.application_screening_answers
  add constraint application_screening_answers_farah_tier_check
    check (farah_tier is null or farah_tier in ('strong', 'adequate', 'weak'));

-- A short advisory line, not a second cover letter — same order of magnitude
-- as answer_text's own 2000-char cap (0175), deliberately smaller since this
-- is a summary of an answer, not the answer itself.
alter table public.application_screening_answers
  add constraint application_screening_answers_farah_summary_length_check
    check (farah_summary is null or char_length(farah_summary) <= 500);

-- tier/summary only ever accompany a COMPLETED review — a skipped or failed
-- review has nothing to show, and this makes "half a review" (a tier with no
-- completed status, or vice versa) impossible to write regardless of caller.
alter table public.application_screening_answers
  add constraint application_screening_answers_farah_tier_requires_completed_check
    check (farah_tier is null or farah_review_status = 'completed');

alter table public.application_screening_answers
  add constraint application_screening_answers_farah_summary_requires_completed_check
    check (farah_summary is null or farah_review_status = 'completed');

comment on column public.application_screening_answers.farah_review_status is
  'send-345 — null: no Farah review (screening_mode is ''self'', or this answer has not been reviewed yet). ''completed'': farah_tier/farah_summary are set and the employer''s ad wallet was charged. ''skipped_insufficient_balance'': the review was never run because the wallet could not afford it — no charge. ''skipped_error'': the LLM call threw or returned something unparsable — no charge, and never surfaced to the candidate. No automatic retry for v1 in any skipped case.';
comment on column public.application_screening_answers.farah_tier is
  'send-345 — Strong/Adequate/Weak, Farah''s own qualitative vocabulary. Deliberately NOT Excellent/Good/Fair (the match-score system''s fixed 3 tiers, docs/match-confidence-invariant.md) — reusing those would imply a numeric confidence this has none of.';
comment on column public.application_screening_answers.farah_summary is
  'send-345 — a short (<=500 char) advisory summary of the written answer, Farah-voiced. Never replaces the raw answer_text in any UI — always shown alongside it, clearly labeled as Farah''s own annotation.';

-- ── ad_wallet_reason: one new ledger reason ─────────────────────────────────
--
-- Empirically verified (against a throwaway enum on the dev project, before
-- writing this) that `ALTER TYPE ... ADD VALUE` followed by USING the new
-- value later in the SAME transaction works on this Postgres version
-- (17.6) — fixed since PG12, but checked here rather than assumed, per this
-- migration's own file needing both the ADD VALUE and the function below
-- that references it. No need to split into two files.
alter type public.ad_wallet_reason add value 'farah_screening_charge';

comment on function public.debit_ad_wallet(uuid, integer, public.ad_wallet_reason, uuid, uuid) is
  'Atomic wallet debit (0046). Reasons: topup-adjacent (topup/reversal/admin_adjustment are credits or corrections, not spends), campaign_charge (0046/0047 ad campaigns), and farah_screening_charge (0176 — a single paid AI review of one free_text screening answer). See record_farah_screening_review for the only caller of the farah_screening_charge reason.';

-- ── record_farah_screening_review: the ONE atomic write for a completed or
--    insufficient-balance review ─────────────────────────────────────────
--
-- The LLM call itself happens OUTSIDE this function, in the Server Action
-- layer (Postgres cannot call Groq) — by the time this runs, p_tier and
-- p_summary are already Farah's real verdict on the answer. This function's
-- only job is the money-and-record half, atomically:
--
--   * refuse outright if the question is not in screening_mode = 'farah'
--     (defense in depth — the Server Action should never call this for a
--     'self' question, but a schema-level refusal here means a caller bug
--     cannot accidentally charge an employer for a review nobody opted into);
--   * debit_ad_wallet (0046) — the SAME atomic "check and act in one
--     statement" gate every other spend in this schema uses, not a
--     read-then-write balance check;
--   * on success, write farah_review_status/farah_tier/farah_summary in the
--     SAME function call (so "charged but never recorded" and "recorded but
--     never charged" are both impossible — there is one statement sequence,
--     not two separate writes a crash could land between);
--   * on insufficient balance, write ONLY farah_review_status =
--     'skipped_insufficient_balance' and take no money — debit_ad_wallet's
--     own "no row updated" branch already refused the charge, so there is
--     nothing to roll back, only a status to record.
--
-- service_role only, same reasoning as debit_ad_wallet itself:
-- p_application_id/p_question_id/p_amount_ngn are arguments, so granting
-- this to `authenticated` would turn them into forgeable authorisation. The
-- Server Action runs as service-role specifically because this debits and
-- annotates the EMPLOYER's wallet, never the candidate's own RLS-scoped
-- session.
create or replace function public.record_farah_screening_review(
  p_application_id uuid,
  p_question_id uuid,
  p_tier text,
  p_summary text,
  p_amount_ngn integer
)
returns table (ok boolean, status text, balance_after_ngn integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_screening_mode text;
  v_existing_status text;
  v_debit_ok boolean;
  v_debit_balance integer;
begin
  -- FOR UPDATE OF a: locks the answer row for the rest of this transaction,
  -- so two overlapping calls for the same (application, question) can't both
  -- read v_existing_status as null and both proceed to charge — the second
  -- blocks on the lock and re-reads the first call's own write once it
  -- commits. Found genuinely necessary while testing this function, not
  -- assumed up front: an earlier version had no existing-status guard at
  -- all, and calling it twice for the same answer (the exact shape a
  -- retried Server Action call would take, since v1 has no dedup at that
  -- layer) left farah_tier/farah_summary populated from the first call
  -- while farah_review_status was overwritten to
  -- 'skipped_insufficient_balance' by the second — a state the table's own
  -- application_screening_answers_farah_tier_requires_completed_check
  -- constraint correctly refused to let happen at all, but which
  -- production would rather never attempt than throw on.
  select j.organization_id, q.screening_mode, a.farah_review_status
    into v_organization_id, v_screening_mode, v_existing_status
  from public.application_screening_answers a
  join public.job_posting_screening_questions q on q.id = a.question_id
  join public.applications app on app.id = a.application_id
  join public.job_postings j on j.id = app.job_posting_id
  where a.application_id = p_application_id
    and a.question_id = p_question_id
  for update of a;

  if v_organization_id is null then
    raise exception 'record_farah_screening_review: no answer found for application % / question %',
      p_application_id, p_question_id;
  end if;

  if v_screening_mode is distinct from 'farah' then
    raise exception 'record_farah_screening_review: question % is not in farah screening_mode', p_question_id;
  end if;

  if v_existing_status is not null then
    -- Already reviewed (completed, or a prior skip) — never re-charge or
    -- overwrite what's there. No automatic retry exists for v1: a caller
    -- that somehow invokes this twice for the same answer gets back
    -- whatever already happened, not a second wallet charge.
    return query
      select
        v_existing_status = 'completed',
        v_existing_status,
        (select w.balance_ngn from public.ad_wallets w where w.organization_id = v_organization_id);
    return;
  end if;

  select d.ok, d.balance_after_ngn
    into v_debit_ok, v_debit_balance
  from public.debit_ad_wallet(v_organization_id, p_amount_ngn, 'farah_screening_charge', p_question_id, null) d;

  if not v_debit_ok then
    update public.application_screening_answers
    set farah_review_status = 'skipped_insufficient_balance'
    where application_id = p_application_id and question_id = p_question_id;

    return query select false, 'skipped_insufficient_balance', v_debit_balance;
    return;
  end if;

  update public.application_screening_answers
  set farah_review_status = 'completed',
      farah_tier = p_tier,
      farah_summary = p_summary
  where application_id = p_application_id and question_id = p_question_id;

  return query select true, 'completed', v_debit_balance;
end;
$$;

revoke all on function public.record_farah_screening_review(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_farah_screening_review(uuid, uuid, text, text, integer) to service_role;

comment on function public.record_farah_screening_review(uuid, uuid, text, text, integer) is
  'send-345 — the atomic money-and-record half of a Farah screening review. The LLM call happens before this, in the Server Action layer; this function only debits the org''s ad wallet and writes the review outcome, in one statement sequence. service_role only.';

-- ── employer_application_screening_answers: widened for Farah's annotation ──
--
-- Same on-demand read path 0175 introduced, widened rather than duplicated
-- — same ownership gate, same on-demand shape precedent
-- employer_job_applicants itself has followed through 4 prior widenings.
-- Adds screening_mode (so the UI knows whether to even look for a Farah
-- annotation on a given row) and the three farah_* columns.
--
-- DROP before CREATE, not a plain CREATE OR REPLACE: Postgres refuses to
-- change a function's RETURN TABLE column list in place ("cannot change
-- return type of existing function"), unlike a same-shape body edit — this
-- is genuinely widening the shape (7 columns to 11), not just rewriting the
-- query inside it.
drop function if exists public.employer_application_screening_answers(uuid);

create or replace function public.employer_application_screening_answers(
  p_application_id uuid
)
returns table (
  question_text text,
  question_type text,
  required boolean,
  screening_mode text,
  answer_yes_no boolean,
  answer_number numeric,
  answer_text text,
  passed boolean,
  farah_review_status text,
  farah_tier text,
  farah_summary text
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
    q.screening_mode,
    a.answer_yes_no,
    a.answer_number,
    a.answer_text,
    a.passed,
    a.farah_review_status,
    a.farah_tier,
    a.farah_summary
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
  'send-344/send-345 — one row per screening question on the given application''s job posting (LEFT JOINed against the candidate''s actual answers, so an unanswered question still shows), scoped to the caller''s own organisation via is_org_member. Widened by 0176 to also carry screening_mode and Farah''s advisory farah_tier/farah_summary/farah_review_status — a farah-mode question with no completed review yet simply has all three null, the same as any other not-yet-reviewed row.';
