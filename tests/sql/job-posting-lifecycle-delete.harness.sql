-- JOBS-LIFECYCLE-1, stage 1: a catalog-driven proof of public.job_posting_delete_unreferenced (migration 0279), run against a LOCAL database that has every migration applied.
--
--   docker exec -i <local-db-container> psql -U postgres -d <database with 0000..0279 applied> -v ON_ERROR_STOP=1 -q < tests/sql/job-posting-lifecycle-delete.harness.sql
--
-- It exits non-zero on the first failed claim. It changes nothing that lasts: one transaction, rolled back at the end. Foreign-key triggers are switched off for the transaction (session_replication_role
-- = replica) so a child row can be built with dummy parents; only the child's job_posting_id matters to the function. It is a harness, not a vitest file, because the unit suite has no direct database
-- connection; the supabase-js specs (tests/rls/job-posting-lifecycle-delete.test.ts) run in CI and cover the same claims through the API with real parents.
--
-- WHAT IT PROVES
--   1. POSITIVE CONTROL: a closed row nothing references is deleted and its tombstone is written (id, fingerprint, title, company, closed_at, snapshot), and the banner path comes back.
--   2. ONE CASE PER FOREIGN KEY, generated from pg_constraint (NOT from a list in this file): a closed row referenced through each is NOT deleted and writes no tombstone. A table added later is
--      covered the moment it exists; one this harness cannot build a row for FAILS, naming the table.
--   3. Not eligible: an open row, a closed row with no closed_at and a closed row newer than the cutoff are untouched; a second call deletes nothing and writes no second tombstone; an id that is not
--      in p_ids is untouched; a deleted job can be restored from its snapshot.
begin;
set local session_replication_role = replica;

create function pg_temp.mk_job(p_status text default 'closed', p_closed_at timestamptz default now() - interval '2 days', p_banner text default null) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.job_postings (source_type, title, company_name, description, dedup_fingerprint, status, closed_at, external_source, banner_path)
  values ('external', 'Harness job', 'Harness Co', 'Harness description', 'harness-' || gen_random_uuid(), p_status::public.job_status, case when p_status = 'closed' then p_closed_at end, 'manual-harness', p_banner)
  returning id into v_id;
  return v_id;
end $$;

-- One row in p_table whose p_col points at p_job, with a dummy value for every other NOT NULL column that has no default.
create function pg_temp.mk_child(p_table text, p_col text, p_job uuid) returns void
language plpgsql as $$
declare
  cols text[] := array[format('%I', p_col)];
  vals text[] := array[format('%L', p_job)];
  r record;
  v text;
  -- Values for the columns whose CHECK constraints reject the generic dummy: 'table.column' -> SQL literal.
  overrides constant jsonb := '{
    "ad_campaigns.daily_rate_ngn": "100",
    "ad_campaigns.total_budget_ngn": "1000",
    "applicant_messages.kind": "''custom''",
    "applicant_messages.status": "''sent''",
    "country_default_events.country_state": "''none''",
    "country_default_events.event_type": "''feed_view''",
    "interview_bookings.duration_minutes": "30",
    "interview_bookings.status": "''booked''",
    "interview_offers.kind": "''video''",
    "interview_offers.status": "''open''",
    "job_posting_screening_questions.question_type": "''free_text''",
    "job_posting_screening_questions.screening_mode": "''self''"
  }';
begin
  for r in
    select a.attname::text as attname, a.atttypid, t.typtype, format_type(a.atttypid, a.atttypmod) as ft
    from pg_attribute a join pg_type t on t.oid = a.atttypid
    where a.attrelid = ('public.' || quote_ident(p_table))::regclass and a.attnum > 0 and not a.attisdropped
      and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = '' and a.attname <> p_col
  loop
    v := case
      when overrides ? (p_table || '.' || r.attname) then overrides ->> (p_table || '.' || r.attname)
      when r.typtype = 'e' then format('%L', (select enumlabel from pg_enum where enumtypid = r.atttypid order by enumsortorder limit 1)) || '::' || r.ft
      when r.ft = 'uuid' then 'gen_random_uuid()'
      when r.ft like 'timestamp%' then 'now()'
      when r.ft = 'date' then 'current_date'
      when r.ft = 'boolean' then 'false'
      when r.ft in ('integer', 'bigint', 'smallint') or r.ft like 'numeric%' then '0'
      when r.ft in ('jsonb', 'json') then '''{}''::' || r.ft
      when r.ft like '%[]' then '''{}'''
      else '''x'''
    end;
    cols := cols || format('%I', r.attname);
    vals := vals || v;
  end loop;
  begin
    execute format('insert into public.%I (%s) values (%s)', p_table, array_to_string(cols, ', '), array_to_string(vals, ', '));
  exception when others then
    raise exception 'HARNESS: cannot build a referencing row for %.% (%): % -- add an override to pg_temp.mk_child', p_table, p_col, array_to_string(cols, ', '), sqlerrm;
  end;
end $$;

do $$
declare
  v_job uuid;
  v_n int;
  v_fk record;
  v_cases int := 0;
  v_banner text;
  v_tomb record;
  v_ids uuid[];
  v_other uuid;
  v_cols text;
begin
  -- 1. POSITIVE CONTROL
  v_job := pg_temp.mk_job('closed', now() - interval '2 days', null);
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_n <> 1 then raise exception 'FAIL 1: an unreferenced closed row was not deleted (returned % rows)', v_n; end if;
  if exists (select 1 from public.job_postings where id = v_job) then raise exception 'FAIL 1: the row is still there'; end if;
  select * into v_tomb from public.job_posting_tombstones where job_id = v_job;
  if not found then raise exception 'FAIL 1: no tombstone was written'; end if;
  if v_tomb.title <> 'Harness job' or v_tomb.company_name <> 'Harness Co' or v_tomb.dedup_fingerprint not like 'harness-%' or v_tomb.closed_at is null or v_tomb.deleted_at is null
     or v_tomb.row_snapshot ->> 'id' <> v_job::text or v_tomb.row_snapshot ->> 'description' <> 'Harness description' or v_tomb.external_source <> 'manual-harness' then
    raise exception 'FAIL 1: the tombstone is wrong: %', to_jsonb(v_tomb);
  end if;
  raise notice 'PASS 1: unreferenced closed row deleted, tombstone written with the whole row';

  -- a second call writes nothing more
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_n <> 0 or (select count(*) from public.job_posting_tombstones where job_id = v_job) <> 1 then raise exception 'FAIL 1b: a second call deleted or wrote again'; end if;
  raise notice 'PASS 1b: a second call deletes nothing and writes no second tombstone';

  -- the banner path comes back
  v_job := pg_temp.mk_job('closed', now() - interval '2 days', null);
  update public.job_postings set banner_path = 'org/harness-banner.png' where id = v_job;
  select deleted_banner_path into v_banner from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_banner is distinct from 'org/harness-banner.png' then raise exception 'FAIL 1c: the banner path did not come back (%)', v_banner; end if;
  raise notice 'PASS 1c: the banner path is returned for the caller to remove';

  -- 2. one case per foreign key, from the catalog
  for v_fk in
    select c.conrelid::regclass::text as tbl, (select cl.relname from pg_class cl where cl.oid = c.conrelid)::text as rel, a.attname::text as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.job_postings'::regclass
    order by 1, 3
  loop
    v_job := pg_temp.mk_job('closed', now() - interval '2 days', null);
    if v_fk.rel = 'job_postings' then
      -- the self-link: another row names this one as the posting that replaced it
      v_other := pg_temp.mk_job('open');
      update public.job_postings set superseded_by = v_job, superseded_at = now() where id = v_other;
      if not exists (select 1 from public.job_postings where superseded_by = v_job) then raise exception 'HARNESS: the self-link fixture was not built'; end if;
    else
      perform pg_temp.mk_child(v_fk.rel, v_fk.col, v_job);
    end if;
    select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
    if v_n <> 0 then raise exception 'FAIL 2: a closed row referenced through %.% was DELETED', v_fk.rel, v_fk.col; end if;
    if not exists (select 1 from public.job_postings where id = v_job) then raise exception 'FAIL 2: the row referenced through %.% is gone', v_fk.rel, v_fk.col; end if;
    if exists (select 1 from public.job_posting_tombstones where job_id = v_job) then raise exception 'FAIL 2: a tombstone was written for a row referenced through %.%', v_fk.rel, v_fk.col; end if;
    v_cases := v_cases + 1;
    raise notice 'PASS 2: kept, no tombstone: %.%', v_fk.rel, v_fk.col;
  end loop;
  if v_cases = 0 then raise exception 'FAIL 2: the catalog returned no foreign key into job_postings'; end if;
  raise notice 'PASS 2: % foreign keys, one case each', v_cases;

  -- applications, by name: an applied one and a saved one both keep the job (the generic case above used the first enum label)
  v_job := pg_temp.mk_job('closed');
  perform pg_temp.mk_child('applications', 'job_posting_id', v_job);
  update public.applications set stage = 'applied' where job_posting_id = v_job;
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_n <> 0 then raise exception 'FAIL 2b: a job with an applied application was deleted'; end if;
  update public.applications set stage = 'saved' where job_posting_id = v_job;
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_n <> 0 then raise exception 'FAIL 2b: a saved job was deleted'; end if;
  raise notice 'PASS 2b: an applied job and a saved job are kept';

  -- 3. not eligible
  v_ids := array[pg_temp.mk_job('open'), pg_temp.mk_job('closed', null), pg_temp.mk_job('closed', now() + interval '1 hour'), pg_temp.mk_job('draft')];
  select count(*) into v_n from public.job_posting_delete_unreferenced(v_ids, now(), null);
  if v_n <> 0 then raise exception 'FAIL 3: an ineligible row was deleted (% rows)', v_n; end if;
  if (select count(*) from public.job_postings where id = any (v_ids)) <> 4 then raise exception 'FAIL 3: an ineligible row is gone'; end if;
  raise notice 'PASS 3: open, closed with no closed_at, closed after the cutoff and draft rows are untouched';

  v_job := pg_temp.mk_job('closed');
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[gen_random_uuid()], now(), null);
  if v_n <> 0 or not exists (select 1 from public.job_postings where id = v_job) then raise exception 'FAIL 3b: a row outside p_ids was touched'; end if;
  select count(*) into v_n from public.job_posting_delete_unreferenced(null, now(), null);
  if v_n <> 0 or not exists (select 1 from public.job_postings where id = v_job) then raise exception 'FAIL 3b: a null id list deleted something'; end if;
  raise notice 'PASS 3b: a row outside p_ids, and a null list, are untouched';

  -- a delete can be undone from the tombstone's snapshot
  select count(*) into v_n from public.job_posting_delete_unreferenced(array[v_job], now(), null);
  if v_n <> 1 then raise exception 'FAIL 4: setup'; end if;
  -- The restore skips generated columns (description_preview, search_vector): the database rebuilds them.
  select string_agg(format('%I', attname), ', ' order by attnum) into v_cols from pg_attribute where attrelid = 'public.job_postings'::regclass and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into public.job_postings (%1$s) select %1$s from jsonb_populate_record(null::public.job_postings, (select row_snapshot from public.job_posting_tombstones where job_id = %2$L))', v_cols, v_job);
  if not exists (select 1 from public.job_postings where id = v_job and title = 'Harness job' and status = 'closed') then raise exception 'FAIL 4: the snapshot did not restore the row'; end if;
  raise notice 'PASS 4: a deleted row restores from its snapshot with the same id';
end $$;

rollback;
