-- 0085 — schema.org's baseSalary, closing one of three Search Console
-- findings (validThrough and employmentType are the other two; neither
-- needs a schema change — see docs/ci-and-tooling-gaps.md's residual-warning
-- note for employmentType, and src/lib/jobs/sources/schema-org.ts for
-- validThrough, which only needed the ingest side wired up).
--
-- `job_postings` has no salary column at all today. This adds four, nullable,
-- describing a range rather than a single figure because that is what
-- schema.org's baseSalary actually carries (a MonetaryAmount wrapping a
-- QuantitativeValue with minValue/maxValue), and because the employer form
-- (src/components/employer/job-posting-form.tsx) offers the same shape.
--
-- ── WHY AN ENUM FOR THE UNIT, LIKE EVERY OTHER FIXED-VOCABULARY COLUMN HERE ──
--
-- work_type, employment_type, seniority_level and job_status are all enums,
-- not free text — a closed vocabulary this app maps to specific display
-- strings and specific schema.org values (see
-- src/lib/seo/job-posting-jsonld.ts's EMPLOYMENT_TYPE lookup for the existing
-- precedent). schema.org's baseSalary.value.unitText is drawn from the same
-- small, stable set (HOUR/DAY/WEEK/MONTH/YEAR), so salary_unit follows suit
-- rather than being the one salary column that is free text for no reason.
--
-- salary_currency stays TEXT. Unlike unit, currency is an external standard
-- (ISO 4217) that this app does not own and has no reason to enumerate — a
-- 3-letter code, case- and shape-validated at the boundaries that populate
-- it (the schema.org parser and the employer form's Server Action), NOT by a
-- database CHECK constraint. That is a deliberate departure from this
-- table's usual pattern, and the reason is the incident this session already
-- fixed once: a single malformed row in a bulk upsert can fail the WHOLE
-- batch, and a CHECK constraint is exactly as capable of doing that as the
-- missing-column NOT NULL violation was. Validating in the parser (which
-- already omits rather than guesses at anything it cannot parse) keeps a
-- malformed currency from ever reaching this table, without adding a second
-- way for one bad row to take down every other row in the same ingest.
--
-- Same reasoning against a CHECK on salary_max >= salary_min: the parser
-- treats an inverted range as malformed and omits the whole salary block for
-- that one listing (see mapBaseSalary) rather than risk a batch failure.

create type public.salary_unit as enum ('hour', 'day', 'week', 'month', 'year');

alter table public.job_postings
  add column salary_min numeric,
  add column salary_max numeric,
  add column salary_currency text,
  add column salary_unit public.salary_unit;

comment on column public.job_postings.salary_min is
  'Lower bound of the pay range. NULL means no salary was stated — never a guess, per the schema.org parser''s omit-rather-than-invent rule.';
comment on column public.job_postings.salary_max is
  'Upper bound of the pay range. Equal to salary_min for a source that states a single figure rather than a range.';
comment on column public.job_postings.salary_currency is
  'ISO 4217 code (e.g. NGN, USD), uppercase. Validated at the boundaries that write it, not by a constraint here — see the header.';
comment on column public.job_postings.salary_unit is
  'The pay period the figures describe (per hour/day/week/month/year). Optional even when the amounts are present — a source can state a figure without stating its cadence.';

-- ── WHO CAN WRITE IT ─────────────────────────────────────────────────────
--
-- 0056 revoked the table-level UPDATE grant on job_postings and re-granted an
-- explicit column list, precisely so a brand-new column defaults to NOT
-- writable until someone decides. These four are the employer's own
-- descriptive data about their own posting — the same trust level as title,
-- location or years_experience_min, all already on that list — so they are
-- granted here rather than withheld.
--
-- Additive only: a fresh `grant update (...)` for columns that never had any
-- privilege is safe without touching 0056's existing list, and redoing that
-- whole revoke+grant here would risk exactly the silent-loss mistake 0056's
-- own guard exists to catch.
grant update (salary_min, salary_max, salary_currency, salary_unit)
  on public.job_postings to authenticated, anon;
