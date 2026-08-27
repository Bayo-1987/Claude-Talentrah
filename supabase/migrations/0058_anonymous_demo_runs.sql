-- 0058 — one free tailoring run for a visitor with no account (§6.1).
--
-- Two limits, doing two different jobs, and they are not interchangeable:
--
--   PER VISITOR   a lifetime cap of one. Not a window — "one free run per
--                 session/IP" in §6.1 means once, not once an hour.
--   PER DAY       a global ceiling across all anonymous visitors, to protect
--                 the shared model key. See the note on it below.
--
-- ---------------------------------------------------------------------------
-- Identifying a visitor without an account: the tradeoff, stated
-- ---------------------------------------------------------------------------
--
-- There is no good answer here, only two bad ones used together.
--
-- A FIRST-PARTY COOKIE is accurate — it identifies a browser, not a household
-- — and it is trivially defeated. Clearing it, or opening a private window,
-- buys another free run. On its own it is barely a limit.
--
-- AN IP is much harder to shed and much blunter. Nigerian mobile networks
-- carrier-grade NAT aggressively: MTN, Airtel and Glo can put tens of
-- thousands of subscribers behind one address. An IP-only lifetime cap means
-- the first person on a shared address gets the demo and everyone else is told
-- they have already used it — for a product whose whole thesis is serving that
-- market, on the page that is supposed to convert them. That is a real cost,
-- not a hypothetical.
--
-- THIS TABLE STORES BOTH AND TREATS A MATCH ON EITHER AS USED, which is the
-- STRICTER combination and therefore inherits the NAT problem above rather
-- than solving it. Chosen deliberately: the thing being protected is a shared
-- free-tier model key with a 20-request DAILY budget (CLAUDE.md), so the cost
-- of being too permissive is that signed-in users' tailoring and Farah stop
-- working for everyone. The daily ceiling below is what actually bounds that,
-- and it is why this can afford to be strict — a NAT'd visitor who is wrongly
-- refused is shown a create-an-account CTA, which is the conversion path the
-- page exists for anyway.
--
-- Revisit when there is real signal: if the already-used rate is high relative
-- to distinct cookies, NAT is eating real visitors and the OR should become
-- cookie-primary with the IP as a much looser windowed backstop.
--
-- THE IP IS NEVER STORED. `ip_hash` is an HMAC of the address under a server
-- secret, computed in the application (src/lib/demo/anonymous-limit.ts). A
-- plain hash would not do: IPv4 is 2^32 values, which is a few minutes of
-- brute force, so an unkeyed digest is a reversible record of who visited.
-- With no secret configured the application skips the IP dimension entirely
-- rather than storing a weak digest — cookie-only, and it says so in the log.

create table public.anonymous_demo_runs (
  id uuid primary key default gen_random_uuid(),
  -- Either may be null — a visitor blocking cookies has only an IP, and a
  -- request with no usable IP has only a cookie. Both null is refused by the
  -- function, not by a constraint, so the caller gets a reason rather than a
  -- 500.
  ip_hash text,
  visitor_id uuid,
  created_at timestamptz not null default now()
);

-- Partial uniques, not plain ones: null must not collide with null, or the
-- second cookie-less visitor of all time would be told they had already run it.
create unique index anonymous_demo_runs_ip_idx
  on public.anonymous_demo_runs (ip_hash) where ip_hash is not null;
create unique index anonymous_demo_runs_visitor_idx
  on public.anonymous_demo_runs (visitor_id) where visitor_id is not null;

-- ---------------------------------------------------------------------------
-- The global daily ceiling
-- ---------------------------------------------------------------------------
--
-- WHY IT EXISTS SEPARATELY. The per-visitor cap bounds one person. It does not
-- bound the SYSTEM: ten thousand distinct visitors are ten thousand legitimate
-- first runs, each a paid model call on a key that CLAUDE.md records as a
-- free-tier Gemini key with 20 requests a day, shared with every signed-in
-- tailoring run and every Farah reply. Without this, a good day on the landing
-- page is an outage for paying users.
--
-- WHY FIVE. It is a quarter of the documented 20/day budget, which leaves the
-- signed-in product the clear majority of a key it was already sharing. It is
-- not sized from demand data because there is none yet — this endpoint has
-- never run. It is deliberately low enough that the first real traffic hits it
-- and tells us something, rather than high enough to quietly exhaust the key
-- before anyone notices. Raise it when the key is billed (a founder action,
-- per CLAUDE.md), not before.

create table public.anonymous_demo_daily (
  day date primary key,
  runs integer not null default 0
);

alter table public.anonymous_demo_runs enable row level security;
alter table public.anonymous_demo_daily enable row level security;

-- No policies, and the privileges revoked as well as unpolicied — the same
-- distinction 0054 turns on. This is server bookkeeping about people who are
-- not even signed in; there is no client that should read or write it.
revoke all on public.anonymous_demo_runs from anon, authenticated;
revoke all on public.anonymous_demo_daily from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claiming a run
-- ---------------------------------------------------------------------------
--
-- Atomic, for the reason 0034, 0035 and 0038 all had to be: a read-then-insert
-- in TypeScript lets two concurrent requests both see "not used yet" and both
-- get a free model call. The two limits serialise differently and both are
-- handled:
--
--   the DAILY ceiling by a conditional UPDATE — `where runs < cap` inside ON
--   CONFLICT DO UPDATE, exactly the shape of spend_credits_atomic. No row
--   comes back when the cap is met, and concurrent callers serialise on the
--   day's row.
--
--   the PER-VISITOR cap by the unique indexes. Two simultaneous first requests
--   from one visitor both pass any SELECT-based check; only one survives the
--   insert. The constraint IS the check, and 23505 is its answer.
--
-- ORDER, and the refund. The daily budget is claimed FIRST so the expensive
-- ceiling is never overrun by a request that then turns out to be a repeat.
-- If the per-visitor insert then fails, the day's counter is given back — that
-- visitor got no model call, so they must not consume one from the global
-- budget. A compensating update rather than a rollback because the failure is
-- an expected outcome with its own return value, not an error.

create or replace function public.claim_anonymous_demo_run(
  p_ip_hash text,
  p_visitor_id uuid,
  p_daily_cap integer
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runs integer;
begin
  if p_ip_hash is null and p_visitor_id is null then
    -- Nothing to key on. Refused rather than allowed: an unidentifiable
    -- caller is precisely the one that could take the whole daily budget.
    return query select false, 'no_identifier'::text;
    return;
  end if;

  insert into public.anonymous_demo_daily (day, runs)
  values (current_date, 1)
  on conflict (day) do update
    set runs = public.anonymous_demo_daily.runs + 1
    where public.anonymous_demo_daily.runs < p_daily_cap
  returning public.anonymous_demo_daily.runs into v_runs;

  if v_runs is null then
    return query select false, 'daily_cap'::text;
    return;
  end if;

  begin
    insert into public.anonymous_demo_runs (ip_hash, visitor_id)
    values (p_ip_hash, p_visitor_id);
  exception when unique_violation then
    update public.anonymous_demo_daily
       set runs = public.anonymous_demo_daily.runs - 1
     where public.anonymous_demo_daily.day = current_date;
    return query select false, 'already_used'::text;
    return;
  end;

  return query select true, 'ok'::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Giving it back when the model call fails
-- ---------------------------------------------------------------------------
--
-- A visitor whose one lifetime run died on a 502 has not had the demo. Keeping
-- the claim would spend their only attempt on our failure and show them a
-- create-an-account wall as though they had used it — the worst possible first
-- impression on the page whose entire job is the opposite.
--
-- Both halves are released: the visitor's row and the day's counter. Safe to
-- call when nothing was claimed (the delete matches nothing and the counter is
-- floored at zero), so the route can call it from an error path without first
-- working out whether the claim succeeded.

create or replace function public.release_anonymous_demo_run(
  p_ip_hash text,
  p_visitor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.anonymous_demo_runs
   where (p_ip_hash is not null and ip_hash = p_ip_hash)
      or (p_visitor_id is not null and visitor_id = p_visitor_id);
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    update public.anonymous_demo_daily
       set runs = greatest(0, public.anonymous_demo_daily.runs - v_deleted)
     where public.anonymous_demo_daily.day = current_date;
  end if;
end;
$$;

-- service_role only, like every other function a caller could otherwise point
-- at someone else's identifier.
revoke all on function public.claim_anonymous_demo_run(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_anonymous_demo_run(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_anonymous_demo_run(text, uuid, integer) to service_role;
grant execute on function public.release_anonymous_demo_run(text, uuid) to service_role;

comment on table public.anonymous_demo_runs is
  'One free pre-signup tailoring run per visitor, forever. Keyed on an HMAC of the IP (never the IP) and a first-party cookie id; a match on either counts as used. See the migration for why that is strict on purpose.';
comment on table public.anonymous_demo_daily is
  'Global daily ceiling on anonymous demo runs, protecting the shared free-tier model key. Independent of the per-visitor cap.';
