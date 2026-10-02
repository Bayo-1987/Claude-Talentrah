-- 0208 — record every attempt at the homepage demo, with its outcome.
--
-- WHY. Production had exactly three demo runs in its history (0058's anonymous_demo_runs), every one with a null
-- ip_hash, and a refused or failed attempt left no trace anywhere. "The aha demo is barely used" and "the aha
-- demo is silently failing" were indistinguishable, which is the thing to be able to tell apart before anyone
-- decides how to change the limits. This is measurement only: no limit changes here or in the code that writes
-- to it.
--
-- WHAT A ROW IS. One POST to /api/public/jd-demo:
--   outcome  success | refused | error | invalid
--   reason   refused: daily_cap | visitor_cookie | visitor_or_ip | unidentifiable | claim_error
--            invalid: link_only | too_short | malformed_body
--   error_class  error: the provider failure kind (rate_limit/auth/unknown) or the exception's constructor name
--   ip_rule_active  whether a per-IP rule was in play for that request (off unless ANON_DEMO_IP_SALT is set,
--                   which is deliberately left unset: shared mobile-carrier addresses)
--
-- NO PII, by construction AND by schema: no address (not even the keyed hash), no visitor id, no pasted text, and
-- no error message (those can echo the prompt, which holds the visitor's paste). Short codes only, and the two text
-- columns that carry them are CHECK-constrained, so a sentence (spaces, length) cannot be stored in either one, even
-- by a future writer that tried:
--   reason       ~ '^[a-z_]{1,32}$'
--   error_class  ~ '^[A-Za-z0-9_.]{1,64}$'
-- (src/lib/demo/attempt-codes.ts lists every code the route writes and tests/demo/attempt-table.test.ts proves the
-- database accepts all of them and refuses the rest.) If a column is ever added here, the question is whether it
-- could identify a visitor or hold their text.
--
-- ADDITIVE, so per CLAUDE.md it is applied to production BEFORE the code that writes it merges. The writer is
-- fail-safe regardless (src/lib/demo/attempt-log.ts never rejects), so a window where the code is live and the
-- table is not costs only that window's rows, never the demo.

create table public.anonymous_demo_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  outcome text not null check (outcome in ('success', 'refused', 'error', 'invalid')),
  reason text,
  error_class text,
  ip_rule_active boolean not null default false,
  constraint anonymous_demo_attempts_reason_shape
    check (reason is null or reason ~ '^[a-z_]{1,32}$'),
  constraint anonymous_demo_attempts_error_class_shape
    check (error_class is null or error_class ~ '^[A-Za-z0-9_.]{1,64}$')
);

create index anonymous_demo_attempts_created_at_idx on public.anonymous_demo_attempts (created_at desc);

-- Server bookkeeping about people who are not signed in: RLS on, no policies, AND the privileges revoked —
-- the same distinction 0054 and 0058 turn on. Only the service role (the route) writes; no client reads.
alter table public.anonymous_demo_attempts enable row level security;
revoke all on public.anonymous_demo_attempts from anon, authenticated;

-- The read-only count: last 7 days by outcome. security_invoker so it can never be a way around the table's
-- own privileges; read it as the project owner / service role (the Supabase SQL editor or connector):
--
--   select * from public.anonymous_demo_outcomes_7d;
--
-- Reading it: `success` against `refused` and `error` is the headline. `error` rows with error_class
-- rate_limit mean the model key, not the visitor. `invalid` with link_only / too_short means people reach the
-- box and the box turns them away, which is a copy or input problem, not a limit problem.
create view public.anonymous_demo_outcomes_7d
with (security_invoker = true) as
select
  outcome,
  reason,
  error_class,
  count(*)::int as attempts,
  max(created_at) as last_at
from public.anonymous_demo_attempts
where created_at >= now() - interval '7 days'
group by outcome, reason, error_class
order by attempts desc, outcome;

revoke all on public.anonymous_demo_outcomes_7d from anon, authenticated;
