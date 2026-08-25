-- 0035 — Make spending credits atomic.
--
-- The same reasoning as 0034, applied where it was actually rooted. 0034 made
-- Auto-Apply's CAP atomic and left the balance DEDUCTION outside the lock; this
-- closes that, and closes it for the three other features that share the same
-- function.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- src/lib/credits/spend.ts did:
--
--     read  profiles.credits_balance                  -- e.g. 5
--     check balance >= amount                         -- 5 >= 5, ok
--     insert credit_ledger { balance_after: 5 - 5 }   -- computed in JS
--
-- and the `apply_credit_ledger_entry` trigger then performs an ABSOLUTE
-- overwrite — `profiles.credits_balance = new.balance_after` — not a relative
-- decrement. So two concurrent spends both read 5, both pass the check, and
-- both write `balance_after = 0`. The second write doesn't stack; it lands on
-- the same value. One of the two AI actions was performed and paid for by
-- nobody. Worse, the ledger's own sum permanently stops matching the cached
-- balance, so the audit trail can no longer be used to reconstruct the truth.
--
-- Reachable in all four call sites, not hypothetically:
--   * tailoring — the route fires the tailoring spend and the cover-letter
--     spend for a single request
--   * Auto-Apply — two chargeable confirmations past the free allowance; 0034's
--     lock is released before spendCredits runs, so it does not cover this
--   * Resume Builder — nothing disables the rewrite button between clicks
--   * Scholarships — eligibility check and SOP draft, same shape
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- One conditional UPDATE does the check and the decrement in a single
-- statement. Postgres takes a row lock for the duration, so a concurrent spend
-- blocks, then re-evaluates `credits_balance >= p_amount` against the value the
-- winner already wrote. Exactly one of two racing spends can succeed at
-- balance == cost; the loser sees an unchanged balance and reports failure.
--
-- The decrement is RELATIVE (`credits_balance - p_amount`), never a value
-- computed outside the database — that is the whole point. The ledger row is
-- written from the balance the UPDATE actually returned, so ledger and cache
-- cannot disagree even under contention. The existing trigger still fires and
-- sets `credits_balance = balance_after`, which is now provably the same value
-- it already holds — a no-op, kept rather than removed so the ledger stays the
-- single writer of record for every other path that inserts into it.
--
-- Fixed once here rather than per call site, deliberately. This repo's audit
-- history is a list of things fixed four times because they were found four
-- times; `spendCredits`'s signature is unchanged, so all four features get the
-- fix without touching any of them.
--
-- service_role only: it is called from server code that has already
-- established the session user, and p_user_id is that user. Granting it to
-- `authenticated` would turn that argument into a forgeable authorisation —
-- the same reasoning as 0034's claim function.

create or replace function public.spend_credits_atomic(
  p_user_id uuid,
  p_amount integer,
  p_reason public.credit_reason,
  p_related_entity_id uuid default null
)
returns table (ok boolean, balance_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  if p_amount <= 0 then
    -- A zero or negative "spend" would be a grant wearing a spend's clothes.
    raise exception 'spend_credits_atomic: amount must be positive, got %', p_amount;
  end if;

  update public.profiles p
     set credits_balance = p.credits_balance - p_amount,
         updated_at = now()
   where p.id = p_user_id
     and p.credits_balance >= p_amount
  returning p.credits_balance into v_new_balance;

  -- No row updated: either the user does not exist, or the balance moved out
  -- from under us while a concurrent spend held the lock.
  if v_new_balance is null then
    select p.credits_balance into v_new_balance from public.profiles p where p.id = p_user_id;
    return query select false, coalesce(v_new_balance, 0);
    return;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, related_entity_id, balance_after)
  values (p_user_id, -p_amount, p_reason, p_related_entity_id, v_new_balance);

  return query select true, v_new_balance;
end;
$$;

revoke all on function public.spend_credits_atomic(uuid, integer, public.credit_reason, uuid) from public;
revoke all on function public.spend_credits_atomic(uuid, integer, public.credit_reason, uuid) from anon;
revoke all on function public.spend_credits_atomic(uuid, integer, public.credit_reason, uuid) from authenticated;
grant execute on function public.spend_credits_atomic(uuid, integer, public.credit_reason, uuid) to service_role;
