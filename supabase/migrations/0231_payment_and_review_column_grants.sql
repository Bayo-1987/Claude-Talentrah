-- 0231: card authorisation codes, renewal references and the reviewer's payment record are no longer readable by the API roles, and signed-out visitors lose all access to five payment and verification tables.
-- Explicit per-column SELECT grants (the 0218 pattern).
--
-- WHAT. On five tables anon is granted nothing at all. On four of them SELECT is no longer granted on the whole table to authenticated: authenticated is granted SELECT on every column by name except the withheld
-- columns below. Each of them holds a card authorisation code, a renewal reference or the reviewer's payment record, and is read only on the server (the service role). Withheld columns:
--   payment_transactions: authorization_code
--   talent_directory_subscriptions: authorization_code, pending_renewal_reference
--   talent_verifications: reviewer_id, reviewer_notes, reviewer_paid_at, reviewer_payout_ngn, reviewer_payout_reference
--   user_passes: authorization_code, pending_renewal_reference
--
-- ad_wallet_ledger has no withheld column: only anon loses its access, and authenticated keeps its whole-table SELECT. The payment reference (paystack_reference) on payment_transactions and ad_wallet_ledger stays readable by
-- authenticated: it is scoped by row-level security (the person who paid; the members of the organisation for the wallet) and the billing page and the receipt e-mail show it to the person who paid.
-- talent_verifications.ai_feedback stays readable: the candidate is shown it. No signed-out read exists on any of the five tables (no page, no policy on another table, no view and no invoker function names
-- them), so anon loses every privilege on them, not just SELECT.
--
-- CONSEQUENCES. select * on the four column-granted tables now fails 42501 for the API roles, and so does a read of a withheld column by name, as a filter or as UPDATE ... RETURNING; a column added later is unreadable until a
-- migration grants it (tests/rls/payment-token-column-grants.test.ts holds that). authenticated keeps its INSERT and UPDATE column grants and its other privileges; the service role and the SECURITY DEFINER
-- functions are unaffected. Nothing on any other table changes. No application code reads a withheld column through the signed-in user's client.

revoke all on table public.ad_wallet_ledger from anon;

revoke all on table public.payment_transactions from anon;
revoke select on table public.payment_transactions from authenticated;
grant select (amount, channel, created_at, currency, id, organization_id, paystack_reference, product_id, product_type, rail, renewal_for_pass_id, status, user_id) on public.payment_transactions to authenticated;

revoke all on table public.talent_directory_subscriptions from anon;
revoke select on table public.talent_directory_subscriptions from authenticated;
grant select (auto_renew_status, created_at, expires_at, id, last_renewal_failure_at, next_renewal_date, organization_id, payment_transaction_id, plan_id, renewal_attempt_count, renewal_reminder_sent_at, started_at, status) on public.talent_directory_subscriptions to authenticated;

revoke all on table public.talent_verifications from anon;
revoke select on table public.talent_verifications from authenticated;
grant select (ai_feedback, ai_score, claimed_at, credit_ledger_id, decided_at, id, requested_at, review_type, status, target_industry, target_role, user_id) on public.talent_verifications to authenticated;

revoke all on table public.user_passes from anon;
revoke select on table public.user_passes from authenticated;
grant select (auto_renew, auto_renew_status, created_at, expires_at, id, last_renewal_failure_at, next_renewal_date, pass_id, payment_method, payment_transaction_id, renewal_attempt_count, renewal_claimed_at, renewal_reminder_sent_at, started_at, status, user_id) on public.user_passes to authenticated;

-- Self-check: the migration fails (and rolls back) unless every live column of every table is in the intended state for each role.
do $check$
declare
  rec record;
  c record;
begin
  for rec in select * from (values
    ('ad_wallet_ledger', array[]::text[]),
    ('payment_transactions', array['authorization_code']),
    ('talent_directory_subscriptions', array['authorization_code', 'pending_renewal_reference']),
    ('talent_verifications', array['reviewer_id', 'reviewer_notes', 'reviewer_paid_at', 'reviewer_payout_ngn', 'reviewer_payout_reference']),
    ('user_passes', array['authorization_code', 'pending_renewal_reference'])
  ) as v(tbl, withheld) loop
    if exists (select 1 from pg_class k cross join lateral aclexplode(coalesce(k.relacl, acldefault('r', k.relowner))) g
                where k.oid = ('public.' || rec.tbl)::regclass and g.grantee = (select oid from pg_roles where rolname = 'anon')) then
      raise exception '0231: anon still holds a table-level privilege on %', rec.tbl;
    end if;
    if exists (select 1 from pg_attribute a, aclexplode(a.attacl) g where a.attrelid = ('public.' || rec.tbl)::regclass and a.attnum > 0 and not a.attisdropped
                and g.grantee = (select oid from pg_roles where rolname = 'anon')) then
      raise exception '0231: anon still holds a column-level privilege on %', rec.tbl;
    end if;
    for c in select a.attname::text as col from pg_attribute a where a.attrelid = ('public.' || rec.tbl)::regclass and a.attnum > 0 and not a.attisdropped loop
      if c.col = any (rec.withheld) then
        if has_column_privilege('authenticated', ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
          raise exception '0231: authenticated is still granted SELECT on %.%', rec.tbl, c.col;
        end if;
        if not has_column_privilege('service_role', ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
          raise exception '0231: service_role lost SELECT on %.%', rec.tbl, c.col;
        end if;
      elsif not has_column_privilege('authenticated', ('public.' || rec.tbl)::regclass, c.col, 'SELECT') then
        raise exception '0231: authenticated cannot read %.% (a live column missing from the grant list)', rec.tbl, c.col;
      end if;
    end loop;
  end loop;
end
$check$;
