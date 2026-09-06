-- 0098 — A SECURITY DEFINER function so a signed-out visitor's `?ref=` link
-- can be validated without touching a row they have no right to read.
--
-- THE PROBLEM THIS SOLVES. Scholarship cards get a share button, and shared
-- links carry `?ref=<code>` on the scholarship page itself, not on /signup —
-- a signup wall in front of shared content kills a shared link's engagement,
-- so the code has to be captured wherever the visitor actually lands.
-- Something has to check that code is real before the proxy sets a
-- first-touch cookie for it. `profiles` is
-- "self-readable" only (0000's own `profiles are self-readable` policy: `for
-- select using (auth.uid() = id)`), which is exactly right for owner data and
-- exactly wrong for this: a signed-out visitor is nobody's `auth.uid()`, so a
-- plain anon-key `select ... from profiles where referral_code = $1` returns
-- zero rows for every code, real or not. Widening the SELECT policy to let
-- anyone read referral_code by value would leak who invited whom to anyone
-- willing to guess codes.
--
-- WHY A FUNCTION RETURNING A BARE BOOLEAN, NOT A WIDER READ. The proxy needs
-- exactly one bit — "does this code belong to a real profile" — and nothing
-- else about that profile. A function that can only ever answer true/false
-- cannot be misused later to leak a name or an id even if a future edit
-- forgets why it was scoped this way; a `select *` helper could be.
--
-- SAME SHAPE AS EVERY OTHER SECURITY DEFINER HERE: pinned search_path,
-- EXECUTE revoked from the world, granted back only to the role that
-- actually calls it. The caller here is `createPublicReadClient()` from
-- `src/proxy.ts`, running with no session — i.e. anon. `authenticated` gets
-- no grant: the proxy never calls this for a request that already carries a
-- session (an existing user clicking a friend's link isn't a referral), so
-- nothing authenticated has a legitimate reason to call it, and granting
-- unused reach is exactly what 0027/0032 exist to undo elsewhere.
create or replace function public.is_valid_referral_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where referral_code = p_code
  );
$$;

revoke all on function public.is_valid_referral_code(text) from public;
revoke all on function public.is_valid_referral_code(text) from authenticated;
grant execute on function public.is_valid_referral_code(text) to anon;
