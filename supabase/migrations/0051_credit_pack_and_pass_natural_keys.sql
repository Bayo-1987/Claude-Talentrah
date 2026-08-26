-- 0051 — natural keys for the two catalog tables the seed could not own.
--
-- WHY THIS IS NEEDED BEFORE THE SEED CHANGE. `scripts/seed.ts` upserts every
-- other catalog it owns against a stable key: resume_templates got `slug` in
-- 0042 precisely so re-seeding could not duplicate a row when catalog copy was
-- edited. `credit_packs` and `passes` have no such key — only `id`, which the
-- seed does not know — so the only thing available to match on is `name`, and
-- matching on an unconstrained name is exactly the duplication 0042 was
-- written to prevent.
--
-- A name is the right business key here: two packs called "Starter" is not a
-- state anyone wants, and unlike a marketing string these are referenced by
-- checkout as products.
--
-- Found because a fresh Supabase project had EMPTY credit_packs and passes and
-- the seed had no way to fill them — the rows exist in production only because
-- an uncommitted migration (0001–0025) inserted them once. Every other catalog
-- survived the move to a new project; these two did not.

alter table public.credit_packs
  drop constraint if exists credit_packs_name_key;
alter table public.credit_packs
  add constraint credit_packs_name_key unique (name);

alter table public.passes
  drop constraint if exists passes_name_key;
alter table public.passes
  add constraint passes_name_key unique (name);
