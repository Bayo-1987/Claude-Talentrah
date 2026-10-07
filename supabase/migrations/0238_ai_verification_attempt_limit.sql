-- 0238: AI resume reviews are limited to two per person per rolling 30 days, counted and claimed in ONE statement. A flagged attempt (the resume tried to instruct the grader) is recorded, counts, and is never charged.
--
-- WHAT.
--   1. talent_verifications.flag_source: why the grader refused to grade an AI review. 'pattern' = instruction-like text found in the resume before the model ran; 'model' = the model reported that the resume tried to
--      instruct it. Null on every ordinary review. A check allows a value only on an AI review that was resolved as rejected.
--   2. public.claim_ai_talent_verification(p_user_id): replaces the two-step claim in application code (a conditional UPDATE of the profile, then an INSERT). In one transaction it locks the person's profile row, refuses unless
--      the profile is unverified or rejected, counts that person's AI reviews that were resolved (verified or rejected) in the last 30 days, refuses with 'limit_reached' (and the date the next attempt opens) when the count is 2 or
--      more, and otherwise sets the profile to pending and inserts the pending review row with review_type 'ai' written out (it does not lean on the column default, so a later change of the default cannot make a claimed AI review stop counting toward its own limit). It FAILS CLOSED: a missing profile returns 'no_profile', never a new row.
--   3. public.resolve_flagged_talent_verification(...): resolves a pending AI row as rejected with score 0, the fixed feedback and the flag source, and sets the profile to rejected. No credits move here (the caller never charges a flagged
--      attempt). resolve_talent_verification is not changed.
--
-- WHAT COUNTS. An AI review resolved as verified or rejected, charged or flagged, with decided_at inside the last 30 days. NOT counted: a pending row; a row the application released (a grader failure or a missing balance deletes the
-- pending row, so the person is not penalised for our failure); human reviews (review_type <> 'ai'); a row older than 30 days (it leaves the window by itself, no job). The two numbers, 2 and 30 days, are constants in the function body.
--
-- WHY ONE STATEMENT. A limit read in application code and acted on afterwards is not a limit: two concurrent third attempts would both read two. The profile row lock serialises one person's claims, so only one third attempt gets through,
-- and the human-review claim (a conditional UPDATE on the same profile row) waits on the same lock and then sees 'pending'.
--
-- PRIVILEGES. Both functions are SECURITY DEFINER, executable by service_role only. flag_source needs no column grant: authenticated holds no INSERT, UPDATE or DELETE on talent_verifications, and SELECT only on the explicit column list
-- of 0231, which does not name the new column, so it is unreadable and unwritable by every API role until a migration says otherwise (tests/rls/ai-verification-attempt-limit.test.ts holds that).
-- ORDER. Additive: it applies BEFORE the code that calls it is merged (the code-first rule is for narrowing migrations).

alter table public.talent_verifications add column flag_source text;
alter table public.talent_verifications add constraint talent_verifications_flag_source_check
  check (flag_source is null or (flag_source in ('pattern', 'model') and review_type = 'ai' and status = 'rejected'));
comment on column public.talent_verifications.flag_source is
  'Why the grader refused to grade this AI review: pattern (instruction-like text found before the model ran) or model (the model reported an attempt to instruct it). Null for every ordinary review. Server-written only.';

create or replace function public.claim_ai_talent_verification(p_user_id uuid)
returns table (ok boolean, verification_id uuid, reason text, next_allowed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
  v_nth timestamptz;
  v_id uuid;
begin
  if p_user_id is null then
    return query select false, null::uuid, 'no_profile'::text, null::timestamptz;
    return;
  end if;

  select p.talent_verification_status into v_status from public.profiles p where p.id = p_user_id for update;
  if not found then
    return query select false, null::uuid, 'no_profile'::text, null::timestamptz;
    return;
  end if;
  if v_status not in ('unverified', 'rejected') then
    return query select false, null::uuid, 'not_claimable'::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_count
    from public.talent_verifications tv
   where tv.user_id = p_user_id and tv.review_type = 'ai' and tv.status in ('verified', 'rejected')
     and coalesce(tv.decided_at, tv.requested_at) > pg_catalog.now() - interval '30 days';

  if v_count >= 2 then
    -- The next attempt opens when the count falls below 2: the (count - 1)th oldest counted review leaves the window.
    select coalesce(tv.decided_at, tv.requested_at) into v_nth
      from public.talent_verifications tv
     where tv.user_id = p_user_id and tv.review_type = 'ai' and tv.status in ('verified', 'rejected')
       and coalesce(tv.decided_at, tv.requested_at) > pg_catalog.now() - interval '30 days'
     order by coalesce(tv.decided_at, tv.requested_at) asc
     offset (v_count - 2) limit 1;
    return query select false, null::uuid, 'limit_reached'::text, v_nth + interval '30 days';
    return;
  end if;

  update public.profiles set talent_verification_status = 'pending' where id = p_user_id;
  insert into public.talent_verifications (user_id, status, review_type) values (p_user_id, 'pending', 'ai') returning id into v_id;
  return query select true, v_id, null::text, null::timestamptz;
end;
$$;

create or replace function public.resolve_flagged_talent_verification(p_verification_id uuid, p_user_id uuid, p_feedback text, p_flag_source text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated uuid;
begin
  if p_flag_source is null or p_flag_source not in ('pattern', 'model') then
    raise exception 'resolve_flagged_talent_verification: flag source must be pattern or model' using errcode = '22023';
  end if;

  update public.talent_verifications
     set status = 'rejected', ai_score = 0, ai_feedback = p_feedback, decided_at = pg_catalog.now(), flag_source = p_flag_source
   where id = p_verification_id and user_id = p_user_id and status = 'pending' and review_type = 'ai'
  returning id into v_updated;

  if v_updated is null then
    return false;
  end if;

  update public.profiles
     set talent_verification_status = 'rejected', talent_verification_score = 0, talent_verified_at = null
   where id = p_user_id;
  return true;
end;
$$;

revoke all on function public.claim_ai_talent_verification(uuid) from public, anon, authenticated;
revoke all on function public.resolve_flagged_talent_verification(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_ai_talent_verification(uuid) to service_role;
grant execute on function public.resolve_flagged_talent_verification(uuid, uuid, text, text) to service_role;

-- Self-check: the migration fails (and rolls back) unless the column exists and no API role can read or write it, and both functions are executable by service_role only.
do $check$
declare
  role_name text;
  fn text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.talent_verifications'::regclass and attname = 'flag_source' and not attisdropped) then
    raise exception '0238: flag_source is missing';
  end if;
  foreach role_name in array array['anon', 'authenticated'] loop
    if has_column_privilege(role_name, 'public.talent_verifications', 'flag_source', 'SELECT')
       or has_column_privilege(role_name, 'public.talent_verifications', 'flag_source', 'INSERT')
       or has_column_privilege(role_name, 'public.talent_verifications', 'flag_source', 'UPDATE') then
      raise exception '0238: % can read or write talent_verifications.flag_source', role_name;
    end if;
  end loop;
  foreach fn in array array['public.claim_ai_talent_verification(uuid)', 'public.resolve_flagged_talent_verification(uuid, uuid, text, text)'] loop
    if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE') or not has_function_privilege('service_role', fn, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) g where p.oid = fn::regprocedure and g.grantee = 0) then
      raise exception '0238: % has the wrong execute privileges', fn;
    end if;
  end loop;
end
$check$;
