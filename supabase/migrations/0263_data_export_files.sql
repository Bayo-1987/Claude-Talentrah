-- 0263: the state of an admin-produced data export, the private bucket its file sits in, and the six functions that move a row from one state to the next.
--
-- WHAT IT ADDS (docs/admin-data-export.md has the whole picture). Nothing existing is altered, so it is ADDITIVE: apply it BEFORE the code that uses it merges.
--   public.data_export_files  ONE ROW PER EXPORT. The id is the id in the emailed link. Statuses: generating, generated, downloaded, expired, deleted, failed, cancelled.
--                             A partial unique index allows a person at most one LIVE export (generating or generated). It holds NO personal content.
--   storage bucket data-exports   PRIVATE (public = false) and WITH NO STORAGE POLICIES, on purpose: only the service role (which bypasses policies) can read,
--                             list, write or delete an object in it. An object's path is <export id>/<attempt id>.json.
--   six functions, SECURITY INVOKER with an empty search_path, executable by service_role only (the 0223/0035 pattern). Each is ONE statement:
--     claim_data_export_download(export id, user id)   the single use. One conditional UPDATE ... RETURNING object_path: it succeeds for the owner, once, before expiry.
--     swap_stale_data_export_attempt(export, old, new) a `generating` row older than 15 minutes is handed to a NEW attempt. One conditional UPDATE; zero rows = someone
--                                                      else already swapped it, or it is not stale.
--     finish_data_export_attempt(export, attempt, path) the finish: generating -> generated, sets the path and expires_at = now() + 72 hours, ONLY for the attempt that
--                                                      still owns the row. Zero rows (NULL) = the attempt was cancelled.
--     cancel_stale_data_exports()                      the sweep's rule: every `generating` row older than 15 minutes becomes `failed`. One UPDATE ... RETURNING.
--     cancel_unused_data_export(export, user)          support's way out of a lost link: generated and never claimed -> cancelled. One conditional UPDATE ... RETURNING object_path;
--                                                      zero rows = already claimed, expired, cancelled or never generated. Frees the one-live-export slot at once.
--     mark_data_export_object_deleted(export, attempt, status)  the bytes are gone: sets deleted_at and, where asked, expired / deleted. Conditional on the attempt id,
--                                                      so a late call from a cancelled attempt cannot touch the attempt that owns the row now.
--
-- WHY EVERY TRANSITION IS A CONDITIONAL UPDATE. A read followed by a write in application code is not a gate: two admins starting at the same moment, or a slow attempt
-- that was given up on finishing late, would both succeed. CLAUDE.md's rule for anything that gates on a compared value is ONE statement (0035, 0034). The partial
-- unique index decides the race between two inserts (SQLSTATE 23505).
--
-- THE OBJECT PATH IS DERIVED FROM THE TWO IDS. A check constraint holds object_path to <id>/<attempt_id>.json, so two attempts for the same export can never write the
-- same object, and a late write from a cancelled attempt can only land on its OWN path, which the sweep then removes as an orphan.
--
-- WHO CAN TOUCH THE TABLE. service_role only. RLS is on with NO policy; every privilege is revoked from PUBLIC, anon and authenticated, and service_role's own are
-- written out (the 0214 shape). tests/rls/column-privileges.test.ts and tests/rls/data-export-files.test.ts keep that so.
--
-- DELETION. user_id references profiles ON DELETE CASCADE (class `delete` in docs/account-deletion-map.md). THE BUCKET OBJECT DOES NOT CASCADE: a person who deletes
-- their account inside the 72 hours leaves the file in the bucket with no row pointing at it. The hourly sweep (src/lib/data-export/sweep.ts) lists the whole bucket and
-- deletes any object with no live row. created_by_admin references admin_users ON DELETE SET NULL, so the record outlives the admin.
--
-- ROLLBACK (supabase/rollbacks/0263_data_export_files.rollback.sql) drops the functions and the table. It cannot drop the bucket: Supabase refuses direct SQL deletes on storage tables, so the
-- bucket is emptied and removed through the Storage API (the file says how). Anything exported and not yet downloaded is lost, which is the intended end of an expiring file.

create table if not exists public.data_export_files (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references public.profiles (id) on delete cascade,
  created_by_admin    uuid        references public.admin_users (id) on delete set null,
  attempt_id          uuid        not null,
  attempt_started_at  timestamptz not null default pg_catalog.now(),
  object_path         text,
  status              text        not null default 'generating',
  created_at          timestamptz not null default pg_catalog.now(),
  expires_at          timestamptz,
  claimed_at          timestamptz,
  deleted_at          timestamptz,
  constraint data_export_files_status_known check (status in ('generating', 'generated', 'downloaded', 'expired', 'deleted', 'failed', 'cancelled')),
  -- The path is the two ids, nothing else: one object per attempt, never shared.
  constraint data_export_files_path_is_ids check (object_path is null or object_path = id::text || '/' || attempt_id::text || '.json'),
  -- A row that says "ready" has a file and an end date.
  constraint data_export_files_generated_has_file check (status <> 'generated' or (object_path is not null and expires_at is not null)),
  -- A row that is still generating has neither yet.
  constraint data_export_files_generating_has_none check (status <> 'generating' or (object_path is null and expires_at is null))
);

-- At most one LIVE export per person. Cancelling or finishing a row frees the slot.
create unique index if not exists data_export_files_one_live
  on public.data_export_files (user_id)
  where status in ('generating', 'generated');

create index if not exists data_export_files_sweep
  on public.data_export_files (status, expires_at);

comment on table public.data_export_files is
  '0263: one row per admin-produced data export. The id is the id in the emailed link. Holds no personal content: ids, a status and times. Server-only (service_role); no policy, no client grant.';
comment on column public.data_export_files.attempt_id is
  'The attempt that currently owns the row. A stale `generating` row is handed to a new attempt by swap_stale_data_export_attempt(); the finish only succeeds for the attempt that still owns it.';
comment on column public.data_export_files.object_path is
  'Path inside the private data-exports bucket: <id>/<attempt_id>.json (enforced). NULL until the finish.';
comment on column public.data_export_files.expires_at is
  'NULL while generating; set by finish_data_export_attempt() to now() + 72 hours. The claim function checks it.';

alter table public.data_export_files enable row level security;
revoke all on table public.data_export_files from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.data_export_files to service_role;

-- The private bucket. public = false, and NO storage.objects policy is created for it: the service role bypasses policies, nothing else is let in.
-- on conflict forces public back to false if the bucket was ever created by hand.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data-exports', 'data-exports', false, 52428800, array['application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- THE SINGLE USE. One conditional UPDATE: it matches only the owner's own, unclaimed, undeleted, unexpired, generated export and returns the path of the CURRENT attempt.
-- NULL means: not yours, already used, expired, or not ready. The caller cannot tell which, by design.
create or replace function public.claim_data_export_download(p_export_id uuid, p_user_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set claimed_at = pg_catalog.now(),
         status = 'downloaded'
   where f.id = p_export_id
     and f.user_id = p_user_id
     and f.status = 'generated'
     and f.claimed_at is null
     and f.deleted_at is null
     and f.object_path is not null
     and f.expires_at > pg_catalog.now()
  returning f.object_path;
$$;

-- A `generating` row older than 15 minutes belongs to nobody any more: hand it to a NEW attempt in one statement. Zero rows = not stale, or somebody else swapped it first.
create or replace function public.swap_stale_data_export_attempt(p_export_id uuid, p_old_attempt uuid, p_new_attempt uuid)
returns table (export_id uuid, new_attempt_id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set attempt_id = p_new_attempt,
         attempt_started_at = pg_catalog.now(),
         object_path = null,
         expires_at = null,
         status = 'generating'
   where f.id = p_export_id
     and f.attempt_id = p_old_attempt
     and p_new_attempt <> p_old_attempt
     and f.status = 'generating'
     and f.attempt_started_at < pg_catalog.now() - interval '15 minutes'
  returning f.id, f.attempt_id;
$$;

-- THE FINISH. Only the attempt that still owns the row can mark it ready. Returns the new expires_at, or NULL when the attempt was cancelled (the caller then deletes its own object).
create or replace function public.finish_data_export_attempt(p_export_id uuid, p_attempt_id uuid, p_object_path text)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set status = 'generated',
         object_path = p_object_path,
         expires_at = pg_catalog.now() + interval '72 hours'
   where f.id = p_export_id
     and f.attempt_id = p_attempt_id
     and f.status = 'generating'
  returning f.expires_at;
$$;

-- The sweep's stale rule: every `generating` row older than 15 minutes becomes `failed`. The caller removes each attempt's object (<export id>/<attempt id>.json).
create or replace function public.cancel_stale_data_exports()
returns table (export_id uuid, user_id uuid, attempt_id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set status = 'failed'
   where f.status = 'generating'
     and f.attempt_started_at < pg_catalog.now() - interval '15 minutes'
  returning f.id, f.user_id, f.attempt_id;
$$;

-- SUPPORT'S WAY OUT OF A LOST LINK. A generated export that nobody has claimed can be cancelled, once: ONE conditional UPDATE. It returns the object path so the caller can delete
-- the bytes; NULL means already claimed, expired, cancelled or never generated. deleted_at is set here, so the retry of a failed delete is the sweep's whole-bucket pass
-- (a cancelled row is not live, so its object is an orphan), not a row flag.
create or replace function public.cancel_unused_data_export(p_export_id uuid, p_user_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set status = 'cancelled',
         deleted_at = pg_catalog.now()
   where f.id = p_export_id
     and f.user_id = p_user_id
     and f.status = 'generated'
     and f.claimed_at is null
  returning f.object_path;
$$;

-- The bytes are gone: record it. p_status null = keep the status (a `failed` row); 'expired' only for a generated row past its end; 'deleted' only for a claimed one.
-- Conditional on the attempt id, so a late call from a cancelled attempt cannot touch the attempt that owns the row now. Returns the id, or NULL when nothing matched.
create or replace function public.mark_data_export_object_deleted(p_export_id uuid, p_attempt_id uuid, p_status text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update public.data_export_files f
     set deleted_at = coalesce(f.deleted_at, pg_catalog.now()),
         status = coalesce(p_status, f.status)
   where f.id = p_export_id
     and f.attempt_id = p_attempt_id
     and (
          (p_status is null and f.status in ('failed', 'expired', 'deleted', 'cancelled'))
       or (p_status = 'expired' and f.status = 'generated' and f.expires_at <= pg_catalog.now())
       or (p_status = 'deleted' and f.status = 'downloaded')
     )
  returning f.id;
$$;

revoke all on function public.claim_data_export_download(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.swap_stale_data_export_attempt(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finish_data_export_attempt(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.cancel_stale_data_exports() from public, anon, authenticated, service_role;
revoke all on function public.cancel_unused_data_export(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_data_export_object_deleted(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_data_export_download(uuid, uuid) to service_role;
grant execute on function public.swap_stale_data_export_attempt(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_data_export_attempt(uuid, uuid, text) to service_role;
grant execute on function public.cancel_stale_data_exports() to service_role;
grant execute on function public.cancel_unused_data_export(uuid, uuid) to service_role;
grant execute on function public.mark_data_export_object_deleted(uuid, uuid, text) to service_role;

-- Checks itself when it is applied: the apply fails, and nothing is kept, if the closed-to-clients design did not come out as written.
do $check$
declare
  t    text := 'public.data_export_files';
  v_fn oid;
  r    name;
  p    text;
  f    text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = t::regclass) then
    raise exception '0263 self-check: RLS is not enabled on %', t;
  end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = t::regclass) then
    raise exception '0263 self-check: % has a policy (it must have none)', t;
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if pg_catalog.has_table_privilege(r, t::regclass, p) then
        raise exception '0263 self-check: % holds % on %', r, p, t;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a where c.oid = t::regclass and a.grantee = 0) then
    raise exception '0263 self-check: PUBLIC holds a privilege on %', t;
  end if;
  if not (pg_catalog.has_table_privilege('service_role', t::regclass, 'select') and pg_catalog.has_table_privilege('service_role', t::regclass, 'insert') and pg_catalog.has_table_privilege('service_role', t::regclass, 'update')) then
    raise exception '0263 self-check: service_role lacks select, insert or update on %', t;
  end if;

  if not exists (select 1 from storage.buckets b where b.id = 'data-exports' and b.public = false) then
    raise exception '0263 self-check: the data-exports bucket is missing or public';
  end if;
  -- NO storage policy may mention the bucket. (A policy with no bucket test at all is a different problem and is checked by tests/storage/data-exports-bucket-privacy.test.ts.)
  if exists (
    select 1 from pg_catalog.pg_policies sp
     where sp.schemaname = 'storage' and sp.tablename = 'objects'
       and (coalesce(sp.qual, '') like '%data-exports%' or coalesce(sp.with_check, '') like '%data-exports%')
  ) then
    raise exception '0263 self-check: a storage.objects policy mentions the data-exports bucket (it must have none)';
  end if;

  foreach f in array array[
    'public.claim_data_export_download(uuid, uuid)',
    'public.swap_stale_data_export_attempt(uuid, uuid, uuid)',
    'public.finish_data_export_attempt(uuid, uuid, text)',
    'public.cancel_stale_data_exports()',
    'public.cancel_unused_data_export(uuid, uuid)',
    'public.mark_data_export_object_deleted(uuid, uuid, text)'
  ] loop
    v_fn := f::regprocedure;
    foreach r in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(r, v_fn, 'execute') then
        raise exception '0263 self-check: % can execute %', r, f;
      end if;
    end loop;
    if exists (select 1 from pg_catalog.pg_proc fn, pg_catalog.aclexplode(coalesce(fn.proacl, pg_catalog.acldefault('f', fn.proowner))) a where fn.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0263 self-check: PUBLIC can execute %', f;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0263 self-check: service_role cannot execute %', f;
    end if;
    if (select prosecdef from pg_catalog.pg_proc where oid = v_fn) then
      raise exception '0263 self-check: % is SECURITY DEFINER (it must be SECURITY INVOKER)', f;
    end if;
  end loop;
end
$check$;
