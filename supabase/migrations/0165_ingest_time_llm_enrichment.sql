-- 0165 — Stage 8 "Step 1b" infrastructure: ingest-time LLM enrichment for
-- postings that are still thin after the heuristic extraction pipeline
-- (docs/stage8-match-accuracy.md's own Step 1b section; the code lives at
-- src/lib/jobs/enrich-thin.ts and src/lib/llm/jd-extraction/, see
-- docs/ingest-llm-enrichment.md for the full picture).
--
-- ---------------------------------------------------------------------------
-- RENAMED FROM 0164, BEFORE EITHER APPLY. No ledger mismatch results.
-- ---------------------------------------------------------------------------
--
-- This PR (#417) and #412 (0164_auto_apply_thin_match_gate.sql) both claimed
-- 0164 on separate branches the same day and merged into main within about an
-- hour of each other, producing two files with the same numeric prefix — the
-- exact collision this repo's own migration-numbering CI check and "take the
-- number right before opening the PR" convention exist to prevent. It broke
-- CI outright: every fresh per-job database replay hit
-- `duplicate key value violates unique constraint "schema_migrations_pkey"`.
--
-- Checked directly via the Supabase MCP connector's list_migrations before
-- renaming, not assumed: only 0164_auto_apply_thin_match_gate has ever been
-- applied to either dozaffzgqkbarxtlclsj (CI) or production
-- (nytwbbzfpytctjsoczzq) — this migration is applied to neither, under
-- either name. So unlike 0061's precedent (renamed after its apply, leaving
-- a permanent filename/ledger mismatch), this rename has nothing to leave
-- mismatched: whichever project applies it next records it as 0165, and no
-- KNOWN_ALIASES entry in scripts/audit-migrations.ts is needed.
--
-- ── PURELY ADDITIVE, AND OFF ──────────────────────────────────────────────
--
-- One nullable column and one feature-flag row, both inert by default:
--
--   job_postings.llm_enrichment_attempted_at   marks a posting as "already
--     tried" (success OR failure) so it is never re-sent to the LLM on a
--     later ingest run just because it is still thin. Existing rows are all
--     NULL, which reads as "never attempted" — exactly right, since nothing
--     has ever attempted any of them.
--
--   feature_flags.ingest_llm_enrichment   the same off-by-default primitive
--     0080/0131 already use for job_match_digest and proactive_match_alert.
--     `enrichThinPostings()` checks this FIRST, before it ever queries
--     job_postings, so a flag read failure (isFeatureEnabled fails closed)
--     or the flag simply being false — which it is here — means the new
--     column is never even referenced. This migration can be applied to a
--     project years before the flag is ever flipped and nothing changes.
--
-- ── WHY THIS STAYS OFF IN THIS PR ─────────────────────────────────────────
--
-- Two real, structural blockers, not caution for its own sake:
--
--   1. Isolation. CLAUDE.md's own incident history is explicit that Groq's
--      200,000 TPD ceiling is shared ACCOUNT-WIDE, not per API key — a
--      second key on the SAME Groq account as production's GROQ_API_KEY is
--      not isolation, it is a second consumer of the same budget, and would
--      risk a third Farah outage of exactly the kind already logged twice.
--      A genuinely separate account was not provisioned for this PR (see
--      docs/ingest-llm-enrichment.md) — GroqJdExtractionProvider reads its
--      OWN env var (JD_EXTRACTION_GROQ_API_KEY) and refuses to start if that
--      value equals GROQ_API_KEY, so the wrong kind of "isolation" fails
--      loudly instead of silently sharing the budget.
--   2. Sequencing against ESCO. PR #415 (docs/stage8-match-accuracy.md's
--      Step 1c) measured that an ESCO-derived vocabulary addition would
--      shrink the thin-posting population this feature would otherwise run
--      against (34.0% -> 28.8% thin-share on its own sample) before any LLM
--      call is spent. That decision has not been made yet, so today's
--      heuristic-only thin population is a ceiling to plan capacity against,
--      not the number this should actually run against once/if ESCO ships.
--
-- Whoever flips this flag on should re-read both sections of
-- docs/ingest-llm-enrichment.md first — the isolation status and the ESCO
-- sequencing note are both live decisions, not settled ones.

alter table public.job_postings
  add column llm_enrichment_attempted_at timestamptz;

comment on column public.job_postings.llm_enrichment_attempted_at is
  'Set (success or failure) the one time this posting was sent through Stage 8 Step 1b''s ingest-time LLM extraction. NULL means never attempted. Whether it WAS thin enough to qualify is re-checked live from structured_jd.skills at attempt time, never cached in a separate column, because a heuristic-vocabulary change (e.g. ESCO terms landing) can move a posting out of "thin" between ingest runs.';

-- Partial index matching enrichThinPostings' own candidate query exactly
-- (status = 'open' and llm_enrichment_attempted_at is null, ordered by
-- posted_at) — cheap to keep (most rows exit the "never attempted" state
-- permanently, whether by enrichment or by being cascaded through and
-- correctly staying non-thin) and prevents a growing board from turning
-- that query into a sequential scan the moment enrichment is ever enabled.
create index job_postings_llm_enrichment_pending_idx
  on public.job_postings (posted_at)
  where status = 'open' and llm_enrichment_attempted_at is null;

insert into public.feature_flags (key, label, enabled) values
  ('ingest_llm_enrichment', 'Ingest-time LLM skill enrichment for thin postings (Stage 8 step 1b)', false);
