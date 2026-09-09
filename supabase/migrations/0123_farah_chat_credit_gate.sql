-- 0123 — Farah chat gets a real entitlement gate.
--
-- Founder-decided pricing call: 3 free Farah chat messages per account in a
-- rolling 30-day window, then checkPassCoverage, then spendCredits — the
-- exact same mechanism every other AI action already goes through, not a
-- second gating system for one surface.
--
-- Checked before writing this: 15 Farah messages total, from 3 users, since
-- 2026-08-26 — not an active abuse incident. The route's own MAX_USER_
-- MESSAGES_PER_HOUR (30, unchanged by this migration) was always an
-- abuse/cost safety net, not a monetization mechanism, and its own comment
-- said so. This closes the actual gap: Groq's openai/gpt-oss-120b is a paid,
-- metered API, and until now nothing stopped an authenticated user from
-- costing real money on every message.
--
-- Two enum additions, no new tables — `credit_gate_events` (0000, extended
-- 0087 for covered_by_pass) is already the source of truth checkPassCoverage
-- reads for its own rolling window; the free allowance reuses it rather than
-- inventing a second counter table, so one place answers "how many times has
-- this user used this gate, and how."

alter type public.credit_reason add value if not exists 'farah_chat_message';
alter type public.credit_gate_outcome add value if not exists 'covered_by_free_allowance';
