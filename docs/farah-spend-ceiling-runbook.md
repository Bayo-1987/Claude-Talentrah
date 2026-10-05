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
