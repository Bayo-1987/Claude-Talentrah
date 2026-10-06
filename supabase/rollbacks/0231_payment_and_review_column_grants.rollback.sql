-- ROLLBACK of 0231: restores the privileges the 5 Oct 2026 privilege snapshots recorded on these five tables (production and preview were identical for them): on the four column-granted tables authenticated holds SELECT on the whole
-- table again (the per-column grants go with the table-level revoke; ad_wallet_ledger's authenticated SELECT was never changed), and anon holds again exactly what it held before: INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on four tables
-- and SELECT, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on ad_wallet_ledger. If 0227 or 0229 has been applied since, they removed some of those; this rollback would put them back, so amend it or roll those back first.

grant select, truncate, references, trigger on table public.ad_wallet_ledger to anon;
do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.ad_wallet_ledger to anon'; end if; end $m$;

revoke select on table public.payment_transactions from authenticated;
grant select on table public.payment_transactions to authenticated;
grant insert, select, update, delete, truncate, references, trigger on table public.payment_transactions to anon;
do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.payment_transactions to anon'; end if; end $m$;

revoke select on table public.talent_directory_subscriptions from authenticated;
grant select on table public.talent_directory_subscriptions to authenticated;
grant insert, select, update, delete, truncate, references, trigger on table public.talent_directory_subscriptions to anon;
do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.talent_directory_subscriptions to anon'; end if; end $m$;

revoke select on table public.talent_verifications from authenticated;
grant select on table public.talent_verifications to authenticated;
grant insert, select, update, delete, truncate, references, trigger on table public.talent_verifications to anon;
do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.talent_verifications to anon'; end if; end $m$;

revoke select on table public.user_passes from authenticated;
grant select on table public.user_passes to authenticated;
grant insert, select, update, delete, truncate, references, trigger on table public.user_passes to anon;
do $m$ begin if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.user_passes to anon'; end if; end $m$;

