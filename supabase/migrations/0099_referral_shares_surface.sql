-- 0099 — Which surface a share came from, so a scholarship share doesn't get
-- silently counted as a /refer share.
--
-- `referral_shares` (0000) has always recorded `user_id` + `channel` only —
-- fine while /refer was the only page calling `logShareAction`. A scholarship
-- card's share button reuses the exact same funnel counter (same table, same
-- reward-eligible channels), and without a way to tell the two apart, every
-- "invites sent" number on the dashboard silently mixes scholarship shares
-- into a metric people are paid against. NOT touching the reward machinery
-- itself — this is provenance on an existing analytics table, not a new
-- condition on `grant_referral_reward` or the activation trigger.
--
-- `not null default 'refer'`, not nullable: every row written before this
-- migration was, in fact, a /refer share (it's the only surface that has
-- ever existed), so the default backfills history correctly rather than
-- leaving a NULL that means "don't know."
alter table public.referral_shares
  add column surface text not null default 'refer';

alter table public.referral_shares
  add constraint referral_shares_surface_check
  check (surface = any (array['refer'::text, 'scholarship'::text]));
