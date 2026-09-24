-- send-460 — grant-vs-policy hygiene, found during send-459's own
-- verification of 0192/0193 against production's real grants
-- (pg_class.relacl), not something either send set out to look for.
--
-- Two tables grant `anon` a write verb no policy ever permits it to use —
-- the exact gap CLAUDE.md's own convention (0054, 0057, 0061) argues
-- against repeatedly: a missing policy is fixed by adding one; a present
-- grant has to be revoked on purpose. Neither is exploitable today —
-- confirmed directly against pg_policies, not assumed — but both are
-- currently riding on "RLS happens to deny it" rather than "the grant
-- itself says no."
--
-- job_posting_reports: anon holds a raw INSERT. Its only policy —
-- "seekers can report a posting once" (0057) — is `for insert to
-- authenticated`, with_check `reporter_id = auth.uid()`. anon has no
-- matching policy, so this INSERT is dead weight, not a live door.
--
-- job_posting_assessment_files: anon holds full INSERT/UPDATE/DELETE. Its
-- only non-SELECT policy — "org members can manage their own assessment's
-- files" (0178) — is `for all to authenticated`. Same story: anon has no
-- matching policy. Its SELECT policy IS `to public` by design (assessment
-- files are meant to be publicly readable alongside their posting) and is
-- deliberately untouched here — this migration removes verbs anon was
-- never meant to have, not the read access it's meant to have.
revoke insert on public.job_posting_reports from anon;
revoke insert, update, delete on public.job_posting_assessment_files from anon;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_reports'
      and grantee = 'anon' and privilege_type = 'INSERT'
  ) then
    raise exception 'job_posting_reports still grants anon INSERT after revoke';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'job_posting_assessment_files still grants anon INSERT/UPDATE/DELETE after revoke';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise exception 'job_posting_assessment_files lost anon SELECT — that grant must stay';
  end if;
end $$;
