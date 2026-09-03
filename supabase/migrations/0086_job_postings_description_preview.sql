-- Cuts Supabase egress on every listing query that shows a job as a card
-- rather than a full page: the signed-in feed (src/app/(app)/jobs/page.tsx)
-- and the two SEO job landing pages (src/lib/seo/landing-page-data.ts)
-- previously fetched `description` in full — production averages 7.3 KB/row
-- there, of which `description` alone is ~5.4 KB (73%) — to render a card
-- that only ever shows the first 220-280 characters of it
-- (src/components/jobs/job-card.tsx, src/components/jobs/public-job-row.tsx).
--
-- The feed query in particular has NO row limit at all: it fetches every
-- open posting on every load. At ~300 open rows and ~7.3 KB/row, that is
-- ~2.2 MB of egress from a single page view, before this column existed.
-- Measured live via `avg(length(row_to_json(t)::text))` against both the
-- production and CI projects (2026-09-03) — not assumed.
--
-- GENERATED ALWAYS ... STORED, not a plain function-based "computed field":
-- a stored column is a normal column PostgREST can select and alias by name
-- with zero client-side change beyond the query's own column list, whereas a
-- function-based computed field needs PostgREST's separate computed-fields
-- convention for no benefit here (this repo has no other computed fields,
-- and 280 bytes/row x ~300 rows is a trivial ~84 KB of extra storage against
-- a 41 MB database). Postgres recomputes it automatically on every
-- UPDATE/UPSERT that touches `description` — the ingest pipeline's own
-- upsert (src/lib/jobs/ingest.ts) never has to know this column exists.
--
-- Callers alias it back to `description` in their select list
-- (`description:description_preview`), so JobCard's existing
-- `job.description.slice(0, 280)` and PublicJobRow's `.slice(0, 220)` need
-- no changes at all: slicing an already-<=280-character string to a shorter
-- length is a no-op that reproduces the exact same rendered output.
alter table public.job_postings
  add column description_preview text generated always as (left(description, 280)) stored not null;

comment on column public.job_postings.description_preview is
  'First 280 chars of description, maintained by Postgres. Selected (aliased as description) by any query that only renders a card preview, so the full description column never leaves the database for those requests. See migration 0086.';
