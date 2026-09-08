-- 0117 — An atomic rate limiter for callers with no user id: the check-email
-- resend actions (resendSignupConfirmationAction, resendPasswordResetAction).
--
-- WHY NOT `consume_rate_limit` (0038). Its table is keyed on
-- (user_id uuid references profiles(id), bucket, window_start) because every
-- existing bucket (tailoring, resumeParse, unlistedLinkMint) protects an
-- AUTHENTICATED user's own spend or their own domain-reputation budget. The
-- resend actions are reachable by anyone who knows or guesses an email
-- address at /signup/check-email?email=... or /forgot-password/check-email,
-- with no session and no user id at all. Forcing this through a uuid-keyed
-- table means inventing a fake user id for a caller who isn't one — the wrong
-- fix for the wrong reason. The abuse case is different in kind, too: mailing
-- a STRANGER repeatedly, not spending the caller's own credits.
--
-- SAME ATOMIC PATTERN AS 0038, keyed on TEXT rather than a user uuid. The
-- insert ... on conflict do update ... returning shape is unchanged, and the
-- reasoning is the same: a read-then-increment in JS lets concurrent callers
-- all read the same count and all pass.
--
-- TWO BUCKETS AGAINST ONE TABLE, deliberately: 'resend_email' is keyed on the
-- lowercased recipient address and caps how often ONE inbox gets mailed
-- regardless of who is asking; 'resend_ip' is keyed on the requester's IP
-- (read fresh from `x-forwarded-for` — see getRequestIp in actions.ts;
-- getOrigin() does not already carry this) and caps how many DIFFERENT
-- addresses one caller can target. Either alone misses half the abuse case:
-- email-only lets one IP enumerate many addresses a handful of times each;
-- IP-only lets many IPs (or one behind a rotating proxy) hammer a single
-- stranger's inbox. Both are consumed on every resend attempt, unconditionally
-- and in the same order regardless of which one denies first, so which bucket
-- tripped is never observable from the outside — that would be a second,
-- smaller enumeration channel on top of the one this migration's own footer
-- note describes.
--
-- THE LIMIT: 5 per email per day, 20 per IP per day. Closer to
-- unlistedLinkMint's 5/day than tailoring's 10/hour (see 0038 and
-- src/lib/api/rate-limit.ts), because this protects a third party's inbox and
-- Talentrah's own sending reputation, not the app's own spend — a stranger
-- getting repeatedly mailed on our behalf is worse per event than one wasted
-- model call. The IP bucket is deliberately looser: a shared IP (NAT, campus
-- wifi, a mobile carrier) can legitimately represent many unrelated visitors,
-- so its job is bounding a single actor's blast radius across many addresses,
-- not being the tight limit — the email bucket is that.
--
-- HOW MUCH WORK THIS BUCKET ACTUALLY DOES TODAY. Measured against the CI
-- project, not assumed (docs/admin-auth.md): Supabase's own built-in mailer
-- currently allows just TWO auth emails per hour, PROJECT-WIDE, not per
-- address — the third `resend`/`resetPasswordForEmail`/`signUp` call of any
-- kind in an hour gets refused by GoTrue itself, before this bucket is ever
-- consulted. So today this table is defense-in-depth and the source of a
-- fast, friendly error message rather than the only thing standing between a
-- stranger's inbox and abuse — GoTrue's own project-wide throttle is
-- functionally the tighter limit while it stands. That changes the moment
-- custom SMTP is configured (already tracked in docs/admin-auth.md's "Known
-- gaps" section as blocking the admin reset-password link) and GoTrue's
-- throttle loosens to roughly 30/hour — at which point this per-email/per-IP
-- bucket becomes the load-bearing one. Built now rather than deferred so that
-- day does not arrive with no limiter at all.
--
-- service_role only, same reasoning as 0038: a caller who could point this at
-- someone else's key would defeat the whole limiter.

create table if not exists public.anonymous_rate_limits (
  rate_key text not null,
  bucket text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (rate_key, bucket, window_start)
);

alter table public.anonymous_rate_limits enable row level security;

-- No policies at all, same as api_rate_limits: server bookkeeping only. RLS
-- enabled with nothing granted means a client cannot read its own counter,
-- let alone reset it.
revoke all on public.anonymous_rate_limits from anon, authenticated;

create index if not exists anonymous_rate_limits_window_idx
  on public.anonymous_rate_limits (window_start);

create or replace function public.consume_anonymous_rate_limit(
  p_key text,
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

  insert into public.anonymous_rate_limits (rate_key, bucket, window_start, request_count)
  values (p_key, p_bucket, v_window_start, 1)
  on conflict (rate_key, bucket, window_start)
  do update set request_count = public.anonymous_rate_limits.request_count + 1
  returning request_count into v_count;

  return query select
    v_count <= p_limit,
    v_count,
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_anonymous_rate_limit(text, text, integer, integer) from public;
revoke all on function public.consume_anonymous_rate_limit(text, text, integer, integer) from anon;
revoke all on function public.consume_anonymous_rate_limit(text, text, integer, integer) from authenticated;
grant execute on function public.consume_anonymous_rate_limit(text, text, integer, integer) to service_role;
