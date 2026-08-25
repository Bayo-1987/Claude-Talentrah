-- 0039 — Re-label existing bare `schema-org` rows with their source label.
--
-- WHY THIS EXISTS. The freshness sweep in src/lib/jobs/ingest.ts scopes a
-- schema.org source's closure by `external_source`. That value used to be the
-- bare discriminator `'schema-org'`, identical for every schema.org config —
-- correct with one source, and silently destructive with two, because each
-- source's sweep then matched the other's rows and closed them. It is now
-- `schema-org:<label>` (see src/lib/jobs/types.ts's `schemaOrgSourceKey`).
--
-- That leaves the rows written before the change stranded. They carry the bare
-- value, so the new sweep — which looks for `schema-org:workable-nigeria` —
-- will never match them. Most will be repaired incidentally, because the
-- upsert keys on `dedup_fingerprint` and rewrites `external_source` whenever a
-- posting is still on the listing. The ones that will NOT be repaired are
-- exactly the ones that matter: a posting that has already been delisted is
-- never re-upserted, so it would stay `status = 'open'` forever. A permanently
-- open listing for a job that no longer exists is worse than a missing one —
-- someone spends an application on it.
--
-- Scoped narrowly and deliberately:
--   * only rows whose value is exactly 'schema-org' (already-qualified rows
--     are left alone, so this is safe to re-run),
--   * mapped to the one schema.org source configured at the time these rows
--     were created — `workable-nigeria` in sources.config.ts. Every affected
--     row's external_url is on jobs.workable.com, which is checked below
--     rather than assumed; if that ever stops being true this raises instead
--     of mislabelling rows into the wrong source's namespace.

do $$
declare
  v_total integer;
  v_workable integer;
begin
  select count(*) into v_total
    from public.job_postings
   where external_source = 'schema-org';

  select count(*) into v_workable
    from public.job_postings
   where external_source = 'schema-org'
     and external_url like 'https://jobs.workable.com/%';

  if v_total <> v_workable then
    raise exception
      'Refusing to re-label: % of % bare schema-org rows are not jobs.workable.com URLs, so the workable-nigeria label would be wrong for them.',
      v_total - v_workable, v_total;
  end if;

  update public.job_postings
     set external_source = 'schema-org:workable-nigeria'
   where external_source = 'schema-org';

  raise notice 'Re-labelled % row(s) to schema-org:workable-nigeria', v_total;
end
$$;
