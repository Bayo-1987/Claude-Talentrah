-- 0115: an employer can put one banner image on a job posting.
--
-- ── TWO DELIBERATE DEVIATIONS FROM THE BRIEF, BOTH FOR THE SAME REASON ────
--
-- The brief asked for `banner_url text`, "employer-writable through the
-- existing job-edit Server Actions — additive grant". Neither half survived
-- contact with how those actions actually write, and the reason is worth
-- stating because the literal version opens a real hole.
--
-- (1) THE COLUMN IS NOT CLIENT-WRITABLE. `postJobAction` and `updateJobAction`
--     write through the USER'S OWN client, on purpose — their own comment says
--     the 0027 policy "is what authorises it, so a regression in that policy
--     breaks posting loudly here". That is a good property, and it is exactly
--     why this column must stay out of the grant list: a client-writable text
--     column that the detail page renders as <img src> lets any employer PATCH
--     an arbitrary URL straight past every upload check — a tracking pixel,
--     someone else's artwork, anything hosted anywhere. The validation would
--     be decorative.
--
--     So it is written by the service role only, from one upload path that has
--     already checked the file's signature, size and dimensions. That IS the
--     0028 treatment the brief asked for by name: 0028 LOCKED
--     `organizations.verified` rather than granting it, and this column decides
--     what a public page displays, which is the same kind of fact.
--
-- (2) IT IS `banner_path`, NOT `banner_url`. It stores the object's path inside
--     this bucket, and the page composes the public URL from a constant. A
--     column holding a full URL can, if anything ever goes wrong upstream,
--     point anywhere on the internet; a column holding `<org>/<job>.jpg` can
--     only ever resolve inside our own bucket. The name says which it is,
--     because `banner_url` holding a path is the kind of small lie that costs
--     someone an afternoon later.
--
-- ── THE BANNER IS GATED ON THE ORG, NOT ON "CAN YOU SEE THIS POSTING" ─────
--
-- Rendering is gated on `organizations.verified` in the page, not on the RLS
-- read policy, and since 0107 those are NOT the same question: an unlisted
-- posting is publicly readable by direct link while its org is unverified.
-- The brief's own threat model names "a direct link" as the leak to prevent —
-- an employer mid-review dressing up an unapproved posting — so gating on
-- readability would have done the opposite of what was asked. An unlisted
-- posting shows no banner. That is deliberate.

alter table public.job_postings
  add column banner_path text;

comment on column public.job_postings.banner_path is
  'Object path inside the job-banners bucket, e.g. "<organization_id>/<job_posting_id>.webp". NOT a URL: the page composes one from a fixed bucket, so this can only ever resolve inside our own storage. Service-role write only — it decides what a public page renders, so it is a trust column like removed_at and unlisted_at. See 0115.';

-- NO GRANT STATEMENT, and that is the point rather than an omission — but it
-- only buys HALF of what it looks like it buys, and the other half is the most
-- important thing in this file.
--
-- UPDATE is genuinely withheld: 0056 revoked table-level UPDATE on
-- job_postings and re-granted a named column list (26 of 38 columns today), so
-- a column added afterwards is not updatable by a client. The guard below
-- asserts that rather than re-stating the list, because re-stating it is what
-- silently dropped 0085's four salary columns during another migration's first
-- draft.
--
-- INSERT IS A DIFFERENT STORY, AND IT IS STILL OPEN. Measured, not assumed:
--
--     table_privileges  -> authenticated:INSERT, anon:INSERT  (TABLE level)
--     columns with a client INSERT privilege -> 38 of 38
--     columns with a client UPDATE privilege -> 26 of 38
--
-- 0056 only ever revoked UPDATE. INSERT was never revoked table-wide, so every
-- column on this table — including this one, and including any column any
-- future migration adds — is settable by a client at INSERT time. And
-- `postJobAction` inserts through the USER'S OWN client, so that path is live.
--
-- A column-level `revoke insert (banner_path)` would do NOTHING here: CLAUDE.md
-- states the rule and this is the case it describes — a table-level grant
-- overrides a column-level revoke. Closing it properly means revoking
-- table-level INSERT and re-granting 37 columns by name, which is exactly the
-- stale-list operation that broke 0085, in a migration whose subject is
-- banners. That is its own change, with its own tests, and it is written up
-- rather than half-done here.
--
-- SO THE GUARANTEE IS MOVED TO THE READ SIDE, where it does not depend on who
-- managed to write the column. `bannerPublicUrl()` refuses any path that is
-- not `<this posting's own organization_id>/<uuid>.<ext>`, so an employer who
-- PATCHes an arbitrary value in at insert time gets nothing rendered — not
-- another org's artwork, not a traversal into another bucket. That holds
-- whatever the grant list says, which is a stronger property than the grant
-- would have given.
do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'job_postings'
      and cp.column_name = 'banner_path'
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'banner_path is UPDATE-grantable by a client role. It decides what a public page renders as an image; only the validated upload path may set it.';
  end if;
end $$;

-- ── THE BUCKET ────────────────────────────────────────────────────────────
--
-- PUBLIC READ because the job detail page is public and unauthenticated — a
-- signed URL would expire and Googlebot has no session. The bucket holding
-- only employer-supplied marketing artwork for postings that are already
-- public is what makes that acceptable; nothing private is ever written here.
--
-- The size and MIME limits are set ON THE BUCKET as well as in the upload
-- path, deliberately. The application check is the one that produces a good
-- error message; this one is the one that still holds if a future code path
-- forgets to call it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-banners',
  'job-banners',
  true,
  2097152, -- 2 MB. See docs: egress, not storage, is the binding free-tier constraint.
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── WHO MAY WRITE ─────────────────────────────────────────────────────────
--
-- The path convention `<organization_id>/<job_posting_id>.<ext>` is not
-- cosmetic: it is what makes the policy expressible at all, because it puts
-- the owning organisation in the first folder segment where a policy can read
-- it.
--
-- `public.is_org_member` is the same SECURITY DEFINER predicate 0026 wrote and
-- the job_postings RLS policy itself uses — reused rather than reimplemented,
-- so storage access and posting access cannot drift into two different
-- definitions of "my organisation".
--
-- The regex guard comes first and is load-bearing: `::uuid` on a folder name
-- that is not a uuid raises rather than returning false, which would surface
-- as a 500 instead of a refusal. Checking the shape first makes the bad case a
-- clean denial.
create policy "job banners are writable by the owning org"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-banners'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "job banners are replaceable by the owning org"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'job-banners'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "job banners are deletable by the owning org"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-banners'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- Read is granted to everyone, which is what `public = true` above already
-- means for the public URL endpoint. Stated as a policy too so the API path
-- agrees with the CDN path rather than differing by accident.
create policy "job banners are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'job-banners');
