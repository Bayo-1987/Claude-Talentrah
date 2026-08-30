-- 0070 — record how well a resume actually parsed.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- `parseResumeFile` already computes a confidence — `high` when the parse
-- found an email, some skills and some experience, `low` otherwise — and
-- returns it to the browser, which shows a prompt and then forgets it. It was
-- never stored, so nothing after the upload could tell a degraded parse from a
-- complete one.
--
-- That is not a reporting nicety. On production one of the three real uploaded
-- resumes holds `skills: []` (issue #139): its heading did not match the
-- parser's pattern, the LLM fallback failed, and the partial result was saved
-- silently. The row is indistinguishable from a user who genuinely listed no
-- skills, and the only way anyone established which it was, weeks later, was
-- by inspecting the SHAPE of the stored experience entries and noticing an
-- 85-character "company name" — the heuristic parser having taken a bullet
-- line as the employer.
--
-- A queryable column means the next one is found by asking, not by forensics.
--
-- ── WHY NULLABLE, AND WHY NO DEFAULT ──────────────────────────────────────
--
-- The 35 rows that already exist were parsed before anything recorded this,
-- and their confidence is genuinely unknown. A DEFAULT would state a value
-- nobody measured and would make "never recorded" permanently
-- indistinguishable from "measured and fine" — the same collapse 0053
-- refused for `expires_at`, for the same reason.
--
-- ── WHY THERE IS NO GRANT STATEMENT HERE ─────────────────────────────────
--
-- Because none is needed, and the obvious "defensive" one would have been a
-- privilege WIDENING. Checked against the live catalog rather than assumed:
--
--   table-level privileges for `authenticated` on public.resumes:
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE   -- no UPDATE
--   column-level UPDATE grants for `authenticated`:
--     source, structured_content, title, updated_at
--
-- There is no table-level UPDATE, so a newly added column is not writable by
-- `authenticated` unless it is granted explicitly. `parse_confidence` is
-- therefore server-set by construction, which is what 0031's rule asks for:
-- this is the server's conclusion about a parse, not something the uploader
-- supplies.
--
-- The first draft of this migration did `revoke update ... from authenticated`
-- followed by a re-grant listing the columns from memory — and that list
-- included `template_id`, `is_base` and `tailored_for_job_id`, none of which
-- are grantable to users today. It would have handed out three new writable
-- columns while appearing to tighten security, on a table whose rows a user
-- already owns under RLS. `is_base` in particular decides which resume every
-- match score and tailoring run reads.
--
-- That is exactly the shape of 0026-0030's four findings, arrived at from the
-- opposite direction, and it is why the grant state belongs in a query rather
-- than in a comment or a recollection. tests/rls/column-privileges.test.ts is
-- the standing check.


alter table public.resumes
  add column if not exists parse_confidence text
    check (parse_confidence in ('high', 'low'));

comment on column public.resumes.parse_confidence is
  'How well the upload parsed: high = email + skills + experience all found, low = degraded (see 0070 and issue #139). Null means parsed before this was recorded. Server-set; no UPDATE grant to authenticated.';
