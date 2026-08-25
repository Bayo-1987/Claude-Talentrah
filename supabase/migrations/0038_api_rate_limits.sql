-- 0038 — A shared, atomic request rate limiter for the paid-LLM routes.
--
-- WHY THIS EXISTS. Only /api/farah/chat rate-limited anything (30 messages an
-- hour, counted from farah_messages rows). /api/tailoring and
-- /api/resume/parse both call a paid model on every request and had no
-- frequency limit at all. Tailoring's credit gate constrains SPEND, not BURST:
-- a user with credits — or one hitting the free-trial path before it flips —
-- can fire concurrent requests as fast as the network allows. resume/parse has
-- no gate of any kind.
--
-- WHY A TABLE RATHER THAN COUNTING EXISTING ROWS. Farah's limit works by
-- counting its own message rows, which is neat but only possible because every
-- accepted request writes exactly one. Tailoring writes a row only on SUCCESS,
-- so counting them would let a user hammer the expensive path indefinitely as
-- long as each attempt failed. resume/parse upserts a single base resume, so
-- there is nothing to count at all. A dedicated counter is the only thing that
-- measures attempts rather than outcomes.
--
-- ATOMIC, for the reason 0034 and 0035 already had to be: read-then-increment
-- lets N concurrent requests all read the same count and all pass. The INSERT
-- ... ON CONFLICT DO UPDATE below does the increment and the read in one
-- statement, so concurrent callers serialise on the row and each sees a
-- distinct count.
--
-- Fixed window rather than sliding: a burst can straddle a boundary and get up
-- to 2x the limit in a short span. That is a known and acceptable trade for a
-- cost-control limit — the goal is to stop unbounded hammering, not to meter
-- precisely — and a sliding window costs a per-request row.
--
-- service_role only, like every other function that a caller could otherwise
-- point at someone else's user id.

create table if not exists public.api_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.api_rate_limits enable row level security;

-- No policies at all: this is server bookkeeping. RLS-enabled with nothing
-- granted means a client cannot read its own counter, let alone reset it.
revoke all on public.api_rate_limits from anon, authenticated;

create index if not exists api_rate_limits_window_idx
  on public.api_rate_limits (window_start);

create or replace function public.consume_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, used integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits (user_id, bucket, window_start, request_count)
  values (p_user_id, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into v_count;

  return query select
    v_count <= p_limit,
    v_count,
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from public;
revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from anon;
revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer) to service_role;
