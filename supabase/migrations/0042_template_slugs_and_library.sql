-- 0042 — Give resume_templates a stable join key, and add four templates.
--
-- WHY A SLUG. The component registry that makes templates actually look
-- different has to key off something stable. `name` is the only human-readable
-- column and it has no unique constraint, so it is both duplicable and
-- editable — renaming "Ledger" to "Ledger (Finance)" for the catalog would
-- silently unmap its component and fall every resume using it back to the
-- default layout, with no error anywhere. `id` is stable but is a per-
-- environment uuid, so a registry keyed on it could not be committed to source
-- at all. A slug is the only key that is stable, unique, and the same in every
-- environment.
--
-- NOT a value-bearing column, deliberately, and worth saying out loud given
-- 0028/0030/0031/0041: `resume_templates` is catalog data. It has RLS enabled
-- and NO update policy, so `authenticated` cannot write any column on it
-- regardless of the table-wide grant Supabase hands out — the row policy
-- refuses first. `slug` carries no trust, money or identity: the paywall is
-- `is_premium`/`unlock_cost_credits` read server-side, and 0041 already locked
-- the user-writable side of this (`resumes.template_id`). This migration adds
-- nothing a client can write.
--
-- The backfill values are fixed rather than derived from `name` at runtime.
-- A slugify() over `name` would quietly change if a name were ever edited,
-- which is the exact failure the slug exists to prevent.

alter table public.resume_templates
  add column if not exists slug text;

update public.resume_templates set slug = 'clean-professional' where name = 'Clean Professional' and slug is null;
update public.resume_templates set slug = 'structured-admin'   where name = 'Structured Admin'   and slug is null;
update public.resume_templates set slug = 'product-tech'       where name = 'Product & Tech'     and slug is null;
update public.resume_templates set slug = 'portfolio-grid'     where name = 'Portfolio Grid'     and slug is null;
update public.resume_templates set slug = 'field-notes'        where name = 'Field Notes'        and slug is null;
update public.resume_templates set slug = 'ledger'             where name = 'Ledger'             and slug is null;
update public.resume_templates set slug = 'pipeline'           where name = 'Pipeline'           and slug is null;

-- Fail loudly rather than half-apply. If a row was renamed before this ran,
-- the constraint below would fail with a null violation and no indication of
-- which row or why; this says so.
do $$
declare v_missing text;
begin
  select string_agg(name, ', ') into v_missing
    from public.resume_templates where slug is null;
  if v_missing is not null then
    raise exception
      'Cannot add the slug constraint: no slug mapping for template(s): %. Add the mapping above rather than deriving one from name.',
      v_missing;
  end if;
end
$$;

alter table public.resume_templates
  alter column slug set not null;

-- Named explicitly so a later migration can reference it.
alter table public.resume_templates
  drop constraint if exists resume_templates_slug_key;
alter table public.resume_templates
  add constraint resume_templates_slug_key unique (slug);

-- ---------------------------------------------------------------------------
-- Four new templates
-- ---------------------------------------------------------------------------
-- Categories chosen against Resume-Now's and Enhancv's real category
-- taxonomies rather than invented, and deduped against the existing seven
-- (Business, Administration, Technology, Design, Customer Success,
-- Banking & Finance, Sales & Marketing).
--
-- Project Management is Enhancv's single most-popular category. Government &
-- Public Sector is the deliberate one: a large segment neither competitor
-- targets, and a natural fit for a Nigeria-first product where the public
-- sector is a major employer.
--
-- Three of the four are premium. The catalog was 5-of-7 free, which leaves the
-- credit-unlock mechanic with almost nothing to sell; new templates are exactly
-- what it exists to sell. Healthcare stays free so the newly-covered
-- professions are not paywalled wholesale — one free entry point into the new
-- set, the same shape the original catalog had.
--
-- Idempotent on slug so re-running is a no-op rather than a duplicate.

insert into public.resume_templates (name, slug, industry_category, is_premium, unlock_cost_credits)
values
  ('Clinical',   'clinical',   'Healthcare',                 false, 0),
  ('Statute',    'statute',    'Legal',                      true, 10),
  ('Critical Path', 'critical-path', 'Project Management',   true, 10),
  ('Public Record', 'public-record', 'Government & Public Sector', true, 10)
on conflict (slug) do nothing;
