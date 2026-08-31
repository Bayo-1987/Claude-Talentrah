-- 0079 — the four content mutations move into the database, permission-checked.
--
-- NUMBERED FROM THE FILES ON MAIN, NOT THE LEDGER, and the distinction cost a
-- renumber. CI's schema_migrations still lists the blog pair under their
-- pre-merge names (0076/0077) because they were applied before
-- 0076_admin_create_operator landed and were then renumbered on disk rather
-- than by rewriting applied history — the 0060/0061 precedent, with both
-- aliases registered in scripts/audit-migrations.ts.
--
-- So the ledger says what has been APPLIED and the files say what has been
-- CLAIMED, and a new number needs the maximum of both. Reading only the ledger
-- picked 0078, which is already on main.
--
-- 0075 gave `operators` a check inside the same statement as its write, and
-- left the eight content areas guarded only by the app. #157 tracked closing
-- that. #162 turned out to be the urgent half — the Server Actions had no
-- permission check at all — and shipped separately. This is the remaining
-- half: the backstop underneath the app guard.
--
-- ── WHY NOT RLS, WHICH IS WHAT #157 ORIGINALLY PROPOSED ──────────────────
--
-- Because it would not do anything. `service_role` has `rolbypassrls = true`,
-- and every admin action goes through createServiceRoleClient(). A
-- permission-gated USING/WITH CHECK policy would be evaluated for exactly
-- nobody. There is already a demonstration of this in the schema:
-- `admin_users` has RLS enabled with ZERO policies, and every admin action and
-- test writes to it perfectly happily.
--
-- A policy like that reads as enforcement in a diff, passes a test that only
-- checks the app's error message, and stops nothing — the same shape as 0064's
-- column revoke, which was a no-op for weeks because a table-level grant sat
-- above it.
--
-- ── WHAT THIS DOES AND DOES NOT PROTECT AGAINST ─────────────────────────
--
-- DOES: a future code path that writes to these tables without checking the
-- permission. The check now lives in the same statement as the write, so
-- there is no ordering in which one happens and the other does not, and no
-- new Server Action can forget it by omission.
--
-- DOES NOT: a compromised service_role key. That key can UPDATE these tables
-- directly no matter what is written here. The only thing that would stop it
-- is revoking service_role's table privileges and forcing everything through
-- these functions — which would break the ingest cron, the renewal cron, the
-- seed and every test suite. Stated plainly rather than left for someone to
-- assume they got more than they did.
--
-- ── NO MUTEX, DELIBERATELY ───────────────────────────────────────────────
--
-- 0075's five functions take `perform 1 from admin_roles for update` and roll
-- back through a savepoint because they defend a CROSS-TABLE invariant: at
-- least one active operator must hold `operators`. None of these four has an
-- analogous invariant — each is a single-row update whose only precondition is
-- "may this actor do this" — so a flat permission check is the whole job.
-- Copying the mutex here would add contention and ceremony to protect nothing.

create or replace function public.admin_permission_catalog()
returns table (permission public.admin_permission)
language sql
stable
security definer
set search_path = public
as $$
  select unnest(enum_range(null::public.admin_permission));
$$;

comment on function public.admin_permission_catalog() is
  'Every permission the enum defines. The role editor reads this instead of a hardcoded list — a permission the UI does not know about is silently deleted from every role somebody saves, because admin_upsert_role replaces the set with what it receives.';


-- ── scholarships: approve / reject ───────────────────────────────────────
create or replace function public.admin_moderate_scholarship(
  p_actor uuid,
  p_id uuid,
  p_status text,
  p_note text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_updated uuid;
begin
  if not public.admin_has_permission(p_actor, 'scholarships') then
    return query select false, 'not_authorised'::text; return;
  end if;
  if p_status not in ('verified', 'rejected') then
    return query select false, 'bad_status'::text; return;
  end if;

  update public.scholarships
     -- CAST, because the column is the enum scholarship_moderation_status and
     -- not text. Assigning a text parameter straight in raises 42804 at call
     -- time, not at create time — the function is created happily and fails on
     -- first use, which is precisely why the holder-path test exists alongside
     -- the refusal tests.
     set moderation_status = p_status::public.scholarship_moderation_status,
         moderation_note = nullif(btrim(coalesce(p_note, '')), ''),
         moderated_at = now(),
         moderated_by = p_actor
   where id = p_id
     -- Only something still awaiting review. A second decision arriving late
     -- must not quietly overwrite the first one's reason.
     and moderation_status = 'pending'
  returning id into v_updated;

  if v_updated is null then
    return query select false, 'not_pending'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;


-- ── reported postings: remove / restore ──────────────────────────────────
create or replace function public.admin_moderate_job_posting(
  p_actor uuid,
  p_id uuid,
  p_action text,
  p_reason text
)
returns table (ok boolean, reason text, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if not public.admin_has_permission(p_actor, 'reported_postings') then
    return query select false, 'not_authorised'::text, null::text; return;
  end if;
  if p_action not in ('remove', 'restore') then
    return query select false, 'bad_action'::text, null::text; return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    -- Both directions. A removal with no reason leaves the employer nothing to
    -- answer; a restore with no reason leaves no record of why a removal was
    -- reversed, which is the only thing making a bad removal auditable.
    return query select false, 'reason_required'::text, null::text; return;
  end if;

  if p_action = 'remove' then
    update public.job_postings
       set status = 'removed', removed_at = now(),
           removal_reason = btrim(p_reason), removed_by = p_actor
     where id = p_id and status <> 'removed'
    returning status into v_status;
  else
    update public.job_postings
       set status = 'closed',
           -- Cleared in the SAME statement: preserve_job_posting_removal only
           -- lets a row leave `removed` when removed_at goes null with it,
           -- which is what stops the nightly ingest un-removing a scam listing.
           removed_at = null, removal_reason = null,
           -- The restorer is the operator of record now; admin_audit_log keeps
           -- both halves of the history.
           removed_by = p_actor
     where id = p_id and status = 'removed'
    returning status into v_status;
  end if;

  if v_status is null then
    return query select false, 'wrong_state'::text, null::text; return;
  end if;
  return query select true, 'ok'::text, v_status;
end;
$$;


-- ── feedback triage ──────────────────────────────────────────────────────
create or replace function public.admin_triage_feedback(
  p_actor uuid,
  p_id uuid,
  p_status text,
  p_note text
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_updated uuid;
begin
  if not public.admin_has_permission(p_actor, 'feedback') then
    return query select false, 'not_authorised'::text; return;
  end if;
  if p_status not in ('new', 'in_review', 'resolved', 'declined') then
    return query select false, 'bad_status'::text; return;
  end if;

  update public.feedback
     set status = p_status::public.feedback_status,
         triaged_by = p_actor,
         triaged_at = now(),
         -- Only overwrite the note when one was given, so moving a row between
         -- states does not erase why it was put there.
         triage_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), triage_note)
   where id = p_id
  returning id into v_updated;

  if v_updated is null then
    return query select false, 'not_found'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;


-- ── course catalog ───────────────────────────────────────────────────────
create or replace function public.admin_update_course(
  p_actor uuid,
  p_id uuid,
  p_active boolean default null,
  p_skill_tag text default null,
  p_provider text default null,
  p_title text default null,
  p_affiliate_url text default null,
  p_price_tier text default null
)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare v_updated uuid;
begin
  if not public.admin_has_permission(p_actor, 'courses') then
    return query select false, 'not_authorised'::text; return;
  end if;

  -- Null means "leave alone", so one function covers the toggle and the edit
  -- without either having to restate the other's columns.
  update public.course_recommendations c
     set active = coalesce(p_active, c.active),
         skill_tag = coalesce(nullif(btrim(coalesce(p_skill_tag, '')), ''), c.skill_tag),
         provider = coalesce(nullif(btrim(coalesce(p_provider, '')), ''), c.provider),
         title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), c.title),
         affiliate_url = coalesce(nullif(btrim(coalesce(p_affiliate_url, '')), ''), c.affiliate_url),
         price_tier = coalesce(nullif(btrim(coalesce(p_price_tier, '')), ''), c.price_tier),
         updated_at = now()
   where c.id = p_id
  returning c.id into v_updated;

  if v_updated is null then
    return query select false, 'not_found'::text; return;
  end if;
  return query select true, 'ok'::text;
end;
$$;


-- ── grants: service role only, same posture as every other admin function ─
revoke all on function public.admin_permission_catalog() from public, anon, authenticated;
revoke all on function public.admin_moderate_scholarship(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_moderate_job_posting(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_triage_feedback(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_course(uuid, uuid, boolean, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.admin_permission_catalog() to service_role;
grant execute on function public.admin_moderate_scholarship(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_moderate_job_posting(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_triage_feedback(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_update_course(uuid, uuid, boolean, text, text, text, text, text) to service_role;
