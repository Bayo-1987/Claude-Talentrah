-- send-446 — logs Google One Tap's own moment-notification outcome
-- (displayed / skipped / dismissed, and why) so a future "One Tap isn't
-- showing" report is a SQL query, not a live browser session with a
-- hand-written google.accounts.id.prompt() probe.
--
-- NO user_id column, deliberately — this fires from GoogleOneTap
-- (src/components/auth/google-one-tap.tsx) for a SIGNED-OUT visitor before
-- any credential exchange happens. There is no user to attach it to; this
-- is the one thing in this codebase that is legitimately, structurally
-- anonymous, not a corner being cut.
--
-- Same shape and same reasoning as credit_gate_events (0000) and
-- country_default_events (0091): written only by the service-role client
-- (src/lib/auth/one-tap-events.ts), best-effort, swallows its own failures.
-- UNLIKE those two, this table has no owner-readable SELECT policy at all —
-- there is no owner to grant it to, so RLS enabled with zero policies is
-- the correct default-deny: only the service role (which bypasses RLS)
-- can read or write a row.
create table public.one_tap_moments (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  moment_type text not null,
  reason text,
  page text not null,
  user_agent text,
  constraint one_tap_moments_pkey primary key (id),
  constraint one_tap_moments_moment_type_check check (moment_type in ('display', 'skipped', 'dismissed'))
);

alter table public.one_tap_moments enable row level security;

-- The only access pattern this table needs: group by reason/page over a
-- date range (the raw SQL documented in src/lib/auth/one-tap-events.ts).
create index idx_one_tap_moments_analysis
  on public.one_tap_moments (moment_type, reason, created_at desc);
