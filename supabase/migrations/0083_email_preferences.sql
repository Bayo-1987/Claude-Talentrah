-- 0083 — per-user email preferences, and a real unsubscribe token.
--
-- WHY A TABLE AND NOT COLUMNS ON `profiles`. The token is a bearer credential:
-- whoever holds it can change that person's email settings without signing in,
-- which is the entire point of an unsubscribe link in an email. `profiles` is
-- the table this project's own notes describe as "the table whose grant list
-- exists to grow" — every future feature adds a column and some of them will
-- need to be readable. A bearer token must never be one row-policy away from a
-- SELECT that was widened for an unrelated reason.
--
-- WHY THE TOKEN IS UNREACHABLE FROM PostgREST AT ALL. RLS is enabled and NO
-- policy is created, so `anon` and `authenticated` can address zero rows —
-- not their own, not anyone's. Unsubscribing goes through the SECURITY DEFINER
-- function below, which takes the token and returns only what the page needs
-- to render. The token is therefore never a value the API can hand out; it
-- only ever travels in the email we sent to the address that owns it.
--
-- WHY THE PREFERENCE DEFAULTS TO TRUE AND THE FEATURE STILL DOES NOT SEND.
-- These are two different switches on purpose. `job_match_digest` here is what
-- an individual asked for; `feature_flags.job_match_digest` is whether the
-- product sends at all. A person who never opted out is still subscribed
-- while the feature is off — and turning the feature on must not be able to
-- resurrect somebody who explicitly unsubscribed, which is exactly what a
-- single shared switch would do.

create table public.email_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,

  -- Opted IN by default. This is a product notification about the thing the
  -- account exists for, not marketing; the opt-out is one click in every send.
  job_match_digest boolean not null default true,

  /*
   * 32 random bytes as hex — URL-safe without encoding games, and far beyond
   * guessing. `gen_random_bytes` is pgcrypto, already present.
   *
   * UNIQUE so a token identifies exactly one person. Without it a collision
   * (or a hand-written duplicate) would make the unsubscribe function ambiguous
   * about whose preference it is changing.
   */
  unsubscribe_token text not null unique default encode(gen_random_bytes(32), 'hex'),

  -- Guards against a double send if the cron fires twice, and is the only
  -- thing that makes "have we already done this week" answerable.
  digest_last_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_preferences is
  'Per-user email notification settings. Row-locked to service_role: the unsubscribe token is a bearer credential and must never be selectable through the API. Unsubscribe goes through email_unsubscribe().';

comment on column public.email_preferences.job_match_digest is
  'Whether THIS PERSON wants the digest. Separate from feature_flags.job_match_digest, which is whether the product sends at all — a global switch must not be able to resubscribe someone who opted out.';

alter table public.email_preferences enable row level security;

-- No policies, deliberately. Nothing but service_role reaches this table.
-- Belt and braces on top of that, because RLS and privileges are separate
-- mechanisms and this project has been bitten by assuming one implies the
-- other (0026/0027/0028/0030).
revoke all on public.email_preferences from anon, authenticated;

create index email_preferences_digest_idx
  on public.email_preferences (job_match_digest, digest_last_sent_at)
  where job_match_digest;

/*
 * Everyone who already exists gets a row, so the digest does not silently skip
 * every account created before today. New accounts are handled by the trigger
 * below rather than by the sender, so a missing row can never be the reason
 * somebody stops receiving mail.
 */
insert into public.email_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.ensure_email_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.email_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_ensure_email_preferences
  after insert on public.profiles
  for each row execute function public.ensure_email_preferences();

/*
 * The unsubscribe (and re-subscribe) entry point.
 *
 * Takes the token and nothing else — there is no session, because the person
 * clicking is in their mail client. Returns whether it matched and the state
 * afterwards, so the page can say "you're unsubscribed" or "that link isn't
 * valid" without the caller ever seeing a token or a user id.
 *
 * RETURNS THE SAME SHAPE FOR AN UNKNOWN TOKEN as for a known one that is
 * already in the requested state, so this cannot be used to test whether a
 * token exists.
 */
create or replace function public.email_unsubscribe(
  p_token text,
  p_subscribed boolean default false
)
returns table (matched boolean, job_match_digest boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update public.email_preferences
     set job_match_digest = p_subscribed,
         updated_at = now()
   where unsubscribe_token = p_token
  returning user_id into v_user;

  if v_user is null then
    return query select false, false;
  else
    return query select true, p_subscribed;
  end if;
end;
$$;

revoke all on function public.email_unsubscribe(text, boolean) from public;
grant execute on function public.email_unsubscribe(text, boolean) to service_role;

comment on function public.email_unsubscribe(text, boolean) is
  'Flip a user''s digest preference using their unsubscribe token. SECURITY DEFINER because the table is service_role-only; callable only by service_role, so the token never reaches a client-side query.';
