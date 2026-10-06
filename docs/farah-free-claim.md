# Farah free messages: the claim (migration 0236)

Three free messages per account in a rolling 30 days. This is how a free message is **claimed before the model call and settled after it**, so parallel requests cannot give one account more than its allowance.

## The problem it fixes

The gate used to read how many free messages an account had used, answer "free" if fewer than 3, and write the free-message event only **after** the reply completed. N requests that started within one reply's time (up to about a minute) all passed that read, all called the model and all committed. `tests/farah/chat-gate-concurrent-commit.test.ts` characterised it: 10 parallel requests with one slot left gave 12 events. The daily spend ceiling (0223, `docs/farah-spend-ceiling-runbook.md`) bounds the money, not who gets it: one scripted burst could use the whole day's budget and put Farah in "resting" mode for everyone.

## How it works

| Step | Where | What |
|---|---|---|
| read | `countFreeAllowanceUsed` | a cheap count; only a pre-filter. If it says none left, no claim is asked for and the message goes to Pass / credits / refusal as before. |
| claim | `claim_farah_free_message`, in `checkFarahChatAllowance`, **before** the model call | one locked step per account: counts committed free messages in the window **plus unexpired pending claims**, and records a pending claim only if the count is below 3. |
| lose | same call | the request is handled exactly as an account whose free messages are used up: an active Pass, credits, or the same refusal with the same words. No model call is made. |
| commit | `commit_farah_free_claim`, in `commitFarahChatAllowance`, after a completed reply | one statement: the claim becomes the same `covered_by_free_allowance` event as always. Every reader of that event (the count, the next-free date, the history route, analytics) is unchanged. |
| release | `release_farah_free_claim`, `releaseFarahChatAllowance`, on **every other way out** of `chat/route.ts` | an early refusal, a model failure, an empty reply, a reply cut off at the length cap, a reader that went away, a request aborted before the call. A message that never happened never uses a free slot. |
| expiry | in the database | a claim nobody settles (a crash, a failed release) expires by itself after **120 seconds** (`FARAH_FREE_CLAIM_HOLD_SECONDS`); the count ignores it and the next claim for the account sweeps it. No cleanup job. |

## Rules to keep

- **A claim lives in `farah_free_claims`, not in `credit_gate_events`**, because an event row has no way to mean "not real yet" and every reader of events expects real ones.
- **A claim that expired before the reply finished is not recorded** (the slot may already be someone else's). The reply is still delivered and nothing is charged. This is the direction every failure here goes.
- **If the claim function is missing** (the migration is not applied yet), the gate logs one loud content-free line (`[farah-chat-gate] free claim function missing ...`) and uses the old check-then-commit path, so a deploy that arrives before the migration does not turn every free message into a paid one. Apply the migration **before** merging the code.
- **Any other failure to claim is a lost claim** (it closes, like a failed count), with one content-free line, no account id and no error text.
- **The Pass's daily fair-use cap has the same check-then-commit shape and is not covered here.**
- **The test-user pool's reset clears the table.** A pooled test identity is reused, and a pending claim left on it by a test that never settled it would count against the next claimer for up to 120 seconds. 0236 adds one row, `('farah_free_claims', 'user_id')`, to the table list of `reset_test_pool_user` (0188, 0201, 0212), patched from the function's live definition in the same way 0212 patches it: the anchor row must be found exactly once, and the function's owner, grants, search_path and security setting are compared before and after. The rollback removes that one row the same way.

## Tests

- `tests/farah/free-claim.test.ts`, `tests/farah/free-claim-pool-reset.test.ts` and `tests/rls/farah-free-claims-grants.test.ts`: against the real database, **CI only** (the first run is CI's).
- `tests/farah/free-claim-gate.test.ts`, `free-claim-route.test.ts`, `free-claim-end-to-end.test.ts`, `free-claim-race-detection.test.ts`, `tests/supabase/migration-0236-shape.test.ts`: no database; the functions are modelled rule by rule in `tests/farah/support/free-claim-model.ts`.
