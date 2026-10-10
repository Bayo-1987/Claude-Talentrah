# Farah daily spend ceiling: runbook

What it is: a counter of today's estimated Farah spend (migration 0223, `llm_daily_usage` and `add_llm_usage`) and a ceiling the chat route checks before every model call. The code is in `src/lib/farah/spend-ceiling.ts`, `spend-tally.ts` and `src/app/api/farah/chat/route.ts`.

## Order

1. Apply 0223 to the project (preview, then production) with the owner's yes, using the hash-checked wrapper. Read it back with the post-apply check.
2. After any apply that adds a table or a function, run `notify pgrst, 'reload schema';` as its own owner-approved one-line script. Then confirm the Data API sees the function (the probe below) before the code that calls it is deployed.
3. Merge the code. The ceiling is read from `FARAH_DAILY_SPEND_CEILING_USD` (default 1.00 in USD, one constant: `DEFAULT_DAILY_CEILING_USD`).

## The reserve rule and its assumption

Before the fallback provider (Gemini) is used, the route re-reads today's total and uses the fallback only while the headroom covers everything the fallback can add in a day: `FALLBACK_RESERVE_NANO`, its daily request cap times its worst-case request. With the default ceiling that switches the fallback off once today's estimate passes $0.6364.

The reserve rests on `GEMINI_FALLBACK_REQUESTS_PER_DAY` (20), which is this project's own record that the fallback key is a free-tier key. It is not a reading of the provider's console.

**If the fallback key's tier changes** (an upgrade, a new key, a different model), recalculate: set `GEMINI_FALLBACK_REQUESTS_PER_DAY` to the new daily cap; `FALLBACK_RESERVE_NANO` follows from it. If the new tier has no daily request cap there is nothing to reserve against, so decide a cap in code before relying on the fallback.

The 250,000 tokens a minute used for the primary provider's bound is a console figure, unverified.

## Probe after the apply (read-only, run by the owner with the service key in their own shell; never paste or store the key)

- `GET <project url>/rest/v1/` returns an OpenAPI document whose `paths` contains `/rpc/add_llm_usage`.
- `GET <project url>/rest/v1/llm_daily_usage?select=bucket&limit=1` returns 200 with the service key, and a permission error (not an empty 200) with the anon key.

## The operator alerts (migration 0235)

Two emails go to the address in `ADMIN_ALERT_EMAIL` (the same operator alert as the payment and refund ones, through `sendAdminAlert`):

- **"Farah has used 80% of today's budget"**: sent by a request that sees the day's estimated spend at or above 80% of the ceiling. Farah is still replying.
- **"Farah has used today's whole budget"**: sent by a request that is blocked at the ceiling. Farah is not replying until 00:00 UTC.

**An alert counts as done only after a send succeeded.** Each alert has its own row for the day in `llm_daily_usage_alert_markers` (added by 0235), and two functions decide, in the database, who sends: `claim_llm_alert_attempt` gives an attempt to one caller at a time (an attempt that began in the last 10 seconds holds the others off), at most 3 attempts per alert per day, and none once the day's alert is recorded as sent; `mark_llm_alert_sent` records the success. A send that fails (the recipient or the mail key not set, the provider refused, no answer within 2 seconds) writes one content-free line (`[farah-spend:alert-not-sent] level=eighty|reached`) and records nothing, so a later request the same day tries again, until the 3 attempts are used. The 80% and "reached" alerts are separate rows: an 80% alert earlier in the day cannot swallow the "reached" one. A retry never changes the reply or the 503, and the only wait is the sender's own 2-second cap on the request that took the attempt. The text has only figures and the name of the setting to change (`FARAH_DAILY_SPEND_CEILING_USD`); no user data.

**Duplicates, honestly.** Concurrent requests cannot both send (the lease). But an attempt can reach the mail provider and still be recorded as failed (the 2-second cap gave up on it, or the call that records the success failed), and the retry then sends a second copy. The most that can happen is the 3 attempts of one alert in one day, so at most 3 emails for one alert, and only in those failure sequences.

If no email arrives: look in the log. `[farah-spend:alert-not-sent]` followed by `[admin-alert] NOT SENT (reason)` means the send failed and says why (`ADMIN_ALERT_EMAIL` or the Resend key unset, or the provider refused); after 3 such lines for the same alert in a day it stops until 00:00 UTC. `[farah-spend:alert-counter-failed] ... code=42883` (or `PGRST202`, `42P01`) means 0235 is not applied to this project; the alert is skipped, the reply is never affected. `[farah-spend:alert-mark-failed]` means the mail went out but could not be recorded, so a duplicate may follow. An alert is a convenience; the ceiling is the safeguard.
