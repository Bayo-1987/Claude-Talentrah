-- 0067 — surface credential events on OPERATOR accounts, and only those.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────
--
-- The seeker forgot-password flow shipped on 2026-08-29. It calls
-- `resetPasswordForEmail`, which operates on any `auth.users` row, and an
-- admin's credential IS a seeker credential — 0060 isolates the AUTHORISATION
-- in `admin_users`, deliberately not the credential. So from that day an
-- admin's password became resettable from the public /login page by whoever
-- controls that inbox.
--
-- That is the ordinary consequence of email-based recovery and NOT a defect in
-- the seeker flow. Excluding operators from reset would be wrong twice over: a
-- form that behaves differently for an operator's address is an enumeration
-- oracle for exactly the accounts that most need not to be enumerable, and it
-- would leave a locked-out operator with no recovery at all.
--
-- What was missing is that nothing SURFACED it. `admin_audit_log` records what
-- an operator DID; nothing recorded something being done TO an operator's
-- account. This closes that, and it does so by reading an event GoTrue already
-- writes rather than by adding a write path of our own — which also makes it
-- RETROACTIVE, covering resets that happened before this shipped.
--
-- ── WHY A FUNCTION AND NOT A VIEW, AND WHY SECURITY DEFINER ──────────────
--
-- Measured before choosing, not assumed:
--
--   PostgREST cannot see the auth schema at all
--       supabase.schema("auth").from("audit_log_entries")  ->  PGRST106
--                                                              Invalid schema: auth
--   and the service role cannot read the table even in SQL
--       has_schema_privilege('service_role','auth','usage')                   true
--       has_table_privilege ('service_role','auth.audit_log_entries','select') FALSE
--       owner                                                    supabase_auth_admin
--
-- So the data is genuinely unreachable from the application without help, and
-- SECURITY DEFINER is required rather than preferred — `postgres` owns this
-- function and can read the table. (Contrast `admin_session_validate` in 0060,
-- which is deliberately INVOKER because the service role could already reach
-- everything it touches. Reaching for DEFINER when INVOKER would do is how a
-- function becomes an ambient privilege; reaching for it when the data is
-- otherwise unreachable is what it is for.)
--
-- A VIEW was the alternative and is worse HERE. A view in `public` is a
-- relation PostgREST exposes, so its safety would rest on a grant staying
-- revoked on a table-shaped object — the mechanism that produced four findings
-- in this repo (0026-0030). A function's grant list is one line and reads as a
-- decision.
--
-- ── THE FILTER IS THE SECURITY BOUNDARY, NOT THE GRANT ───────────────────
--
-- `auth.audit_log_entries` holds events for EVERY user, and its payload
-- carries `actor_username` — an email address. A function that returned the
-- whole table behind a service-role grant would be one careless later grant
-- away from exposing every user's recovery history.
--
-- So the join to `admin_users` is INSIDE the function and is not a parameter.
-- There is no argument that widens it, no "all users" mode, and no way to ask
-- it about somebody who is not an operator. Even if the EXECUTE grant were
-- wrongly widened tomorrow, the worst case is disclosure of credential events
-- for the handful of accounts that operate this dashboard — not for the user
-- base.
--
-- ── WHY BOTH ACTIONS ─────────────────────────────────────────────────────
--
--   user_recovery_requested  somebody asked for a reset link on that account.
--                            The event that matters for the new exposure.
--   user_modified            the account was changed by some other route,
--                            including the Supabase dashboard. GoTrue does not
--                            say WHICH field, so this cannot be read as "the
--                            password changed" — but an unexplained
--                            user_modified on an operator account is worth a
--                            look on its own, and labelling them distinctly is
--                            what stops the ambiguity becoming a false claim.

create or replace function public.operator_credential_events(p_since timestamptz default now() - interval '90 days')
returns table (
  event_action text,
  operator_id uuid,
  operator_email text,
  occurred_at timestamptz,
  event_ip text
)
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select
    e.payload ->> 'action',
    a.id,
    a.email,
    e.created_at,
    -- Recorded by GoTrue; shown so an operator can tell "I did that" from "I
    -- did not". Frequently blank, and the column is `character varying` rather
    -- than `inet` — so no host()/inet formatting applies, which the first
    -- version of this assumed and the apply rejected (42883).
    nullif(e.ip_address::text, '')
  from auth.audit_log_entries e
  join public.admin_users a
    on a.id = (e.payload ->> 'actor_id')::uuid
  where e.payload ->> 'action' in ('user_recovery_requested', 'user_modified')
    and e.created_at >= p_since
  order by e.created_at desc;
$$;

-- Only the service role, which is how every admin screen reaches its data.
-- Revoking from `public`/`anon`/`authenticated` is safe here in a way it was
-- not in 0027: this function is used by NO RLS policy, so no role needs to
-- evaluate it as a side effect of reading something else. That is the
-- distinction 0032 had to restore after 0027 revoked a grant a policy depended
-- on.
revoke all on function public.operator_credential_events(timestamptz) from public, anon, authenticated;
grant execute on function public.operator_credential_events(timestamptz) to service_role;

comment on function public.operator_credential_events(timestamptz) is
  'Credential events (password recovery requests, account modifications) for admin_users accounts ONLY — the join is inside the function and cannot be widened by an argument. SECURITY DEFINER because auth.audit_log_entries is owned by supabase_auth_admin and unreadable by service_role, and invisible to PostgREST entirely.';
