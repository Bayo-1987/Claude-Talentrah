-- 0045 — A stored name must contain at least one character a human can see.
--
-- ── The gap ───────────────────────────────────────────────────────────────
-- `signUpSchema` validates `firstName`/`lastName` with
-- `z.string().trim().min(1)`. Two independent problems with that as the gate:
--
-- 1. `.trim()` is not an emptiness test. It strips the ECMAScript WhiteSpace
--    production — spaces, tabs, NBSP, and U+FEFF — but NOT the zero-width
--    FORMAT characters, which are Unicode category Cf rather than Zs. A single
--    U+200B therefore passes `.min(1)` and renders as nothing.
--
-- 2. More importantly, THE SCHEMA IS NOT ON THE WRITE PATH AT ALL. Migration
--    0030 grants `update (first_name, last_name, …)` to `authenticated`, so a
--    signed-in user can PATCH the column straight through PostgREST without
--    executing any application code. Confirmed against production with a real
--    session — every one of these was accepted:
--
--        U+200B only        write=OK  stored_len=1  passes .trim().min(1)=true
--        U+2060 word joiner write=OK  stored_len=1  passes .trim().min(1)=true
--        plain space only   write=OK  stored_len=1  passes .trim().min(1)=false
--
--    Note the third: a literal space is writable too, and three display sites
--    (`layout.tsx:10`, `layout.tsx:29`, `renewals.ts:161`) do not trim at all,
--    so it renders blank in the avatar, in Farah's greeting, and in the Pass
--    renewal email sent to a paying customer.
--
-- This is the same class as 0028/0030/0031/0041: application-layer validation
-- on a column the client is separately granted permission to write. The
-- validation is not wrong, it is simply not reachable. Only a database
-- constraint is.
--
-- ── NULL is allowed, deliberately ─────────────────────────────────────────
-- `first_name`/`last_name` are nullable and NULL is the normal pre-onboarding
-- state — 5 of the 9 profile rows in production are exactly that. A constraint
-- written as `length(trim(first_name)) > 0` would evaluate to NULL for those
-- rows, which Postgres treats as satisfied, so they would survive by accident.
-- The `IS NULL` branch below makes that intent explicit rather than incidental,
-- so nobody later "tightens" it into an outage.
--
-- ── KEEP THIS CHARACTER CLASS IN SYNC WITH src/lib/profile/name.ts ────────
-- The same rule is expressed twice — here and in `INVISIBLE_FORMAT_CHARS` —
-- because a regex cannot be shared between Postgres and JS. They must accept
-- and reject exactly the same strings. Add a codepoint in one place and you
-- must add it to the other in the same change. Drift either way is its own
-- bug: JS accepting what SQL rejects surfaces as an unexplained 23514 to the
-- user; SQL accepting what JS rejects puts the blank name back in the table.
--
--   U+200B ZERO WIDTH SPACE            U+2060 WORD JOINER
--   U+200C ZERO WIDTH NON-JOINER       U+180E MONGOLIAN VOWEL SEPARATOR
--   U+200D ZERO WIDTH JOINER           U+FEFF ZWNBSP / BOM
--
-- U+FEFF is listed HERE but not in the JS class, and that asymmetry is
-- correct rather than an oversight. JS `.trim()` strips U+FEFF (it is in the
-- ECMAScript WhiteSpace production), so `visibleName()` already removes it.
-- Postgres `\s` does NOT — this was caught by testing the two
-- implementations against the same inputs rather than assuming they agreed,
-- and before the fix `has_visible_characters(U+FEFF)` returned TRUE while the
-- JS helper returned false. That is the SQL-accepts-what-JS-rejects direction:
-- it would have put a blank-rendering name back in the table.
--
-- The rule to apply when editing either side is therefore about BEHAVIOUR, not
-- about the character lists matching literally: the two must accept and reject
-- the same strings. Verify by running the same inputs through both.

create or replace function public.has_visible_characters(value text)
returns boolean
language sql
immutable
parallel safe
as $$
  -- btrim of \s, then remove the Cf characters trim() misses. Non-empty means
  -- something is actually rendered.
  select length(
    regexp_replace(btrim(coalesce(value, '')), '[​‌‍⁠᠎﻿\s]', '', 'g')
  ) > 0;
$$;

comment on function public.has_visible_characters(text) is
  'True when the text renders at least one visible character. Mirrors visibleName() in src/lib/profile/name.ts — keep the codepoint list in sync with it (migration 0045).';

-- Fail loudly rather than half-apply: if any existing row would violate this,
-- say which, instead of letting ALTER TABLE report a bare constraint failure.
do $$
declare v_bad text;
begin
  select string_agg(id::text || ' (' || coalesce(first_name, '<null>') || ' / ' || coalesce(last_name, '<null>') || ')', ', ')
    into v_bad
    from public.profiles
   where (first_name is not null and not public.has_visible_characters(first_name))
      or (last_name  is not null and not public.has_visible_characters(last_name));

  if v_bad is not null then
    raise exception
      'Refusing to add the constraint: existing profile(s) have a name with no visible characters: %. Clear or correct them first — adding the constraint would not fix them, it would only block their next update.',
      v_bad;
  end if;
end
$$;

alter table public.profiles
  drop constraint if exists profiles_names_have_visible_characters;

alter table public.profiles
  add constraint profiles_names_have_visible_characters check (
    (first_name is null or public.has_visible_characters(first_name))
    and
    (last_name is null or public.has_visible_characters(last_name))
  );

comment on constraint profiles_names_have_visible_characters on public.profiles is
  'A stored name must render at least one visible character. NULL is allowed — it is the normal pre-onboarding state. Exists because 0030 grants update(first_name,last_name) to authenticated, so the Zod schema is not on the write path at all.';
