# Farah foundation: the allowance, the price and the failure note

Three small, shared pieces that the Farah panel and the billing facts call instead of working things out for themselves. Nothing here is panel UI or copy.

## What to call

| Need | Call | Where |
|---|---|---|
| What the next message costs this account (free, a Pass, credits, or refused) | `farahMessageCharge({ freeLeft, passCovered, balance })` | `src/lib/credits/farah-message-charge.ts` (pure, client-safe) |
| The same, from what the panel holds | `panelChipCharge(freeRemaining, balance)` (`freeRemaining`: a number, `null` for an active Pass, `undefined` until loaded) | same file |
| The price of one paid message, for text that reports a charge | `paidMessageCredits()` | same file |
| The allowance numbers and the window edge | `FARAH_CHAT_FREE_ALLOWANCE` (3), `FARAH_CHAT_FREE_WINDOW_DAYS` (30), `freeWindowStart(now)` | `src/lib/farah/free-allowance.ts` (client-safe) |
| When the next free message comes back, from the in-window times | `nextFreeMessageAt(usedAt, now)` returns a `Date` or `null` | same file (pure) |
| When the next free message comes back, for one user | `farahChatNextFreeMessageAt(userId, now?)` returns an ISO string or `null` | `src/lib/farah/chat-gate.ts` (server only) |
| The line to add when a reply fails | `withNothingChargedNote(message)`, `NOTHING_CHARGED_NOTE` | `src/lib/farah/failure-note.ts` (client-safe) |

## The rules behind them

- **A free message comes back 30 days after it was used, one at a time.** It is a rolling window, never a calendar month. A person is free again once FEWER than 3 free messages are inside the last 30 days, so with `n` inside the window the next free message comes back when the `(n - 3 + 1)`th oldest of them (1-based, oldest first) turns 30 days old: the oldest when `n` is 3, the second oldest when `n` is 4. Fewer than 3 inside the window means a free message is already left, so there is nothing to wait for (`null`). A message used exactly 30 days ago still counts (the gate's query is `created_at >= now - 30 days`), so the gate frees the slot one millisecond after the returned instant; a time slightly in the future (the database clock running ahead) still counts, as it does for the gate.
- **The read asks for only the 3 newest in-window rows, newest first.** The row that decides is the 3rd newest for every `n >= 3`, so nothing else is needed: at most 3 rows however many there are, and no bound to hit.
- **`n` can be above 3 today, and this change does not fix that.** The gate checks the allowance before the model call and commits after it, so parallel requests can all pass the check and push the count past the allowance (`tests/farah/chat-gate-concurrent-commit.test.ts` characterises it). This change only makes the displayed time correct for that state: taking the oldest message would name a moment when the window still holds 3 or more and the next message is not free. The over-commit itself is unchanged.
- **`null` means nothing to show.** From `nextFreeMessageAt` and `farahChatNextFreeMessageAt` it means fewer than 3 were used in the window, or (for the read) that the read failed. Show no date; never guess one.
- **The date is an instant, not a day.** Format it with `formatDateTime` (the app's one formatter) in the viewer's zone: a slot returns mid-day.
- **A Pass holder's free messages follow the same schedule**, but the history route reports no free count for a Pass holder; whether to show the date for one is the caller's decision.
- **The order is free, then a Pass, then credits** (0123). `farahMessageCharge` is the only place that decides it, and the gate calls it, so a label cannot promise a price the gate does not take.
- **The failure note is only for a failure the server reports** (a rate limit, an error, a failure partway through the stream). Never for a dropped connection: the server may have finished and charged by then.

## On the wire

`nextFreeMessageAt` (an ISO time or `null`) is an additive, optional field on two responses:

- **`GET /api/farah/history`**, beside `freeMessagesRemaining`.
- **The chat `done` event**, beside `freeMessagesRemaining` and `creditsBalance` (on both the saved and the not-saved variant).

It is a time only when the free messages are used up (`freeMessagesRemaining === 0`) and no Pass is active; in every other case it is `null` and no read is made (no extra database read for a Pass holder or while free messages remain). A failed read is `null` and never blocks or charges. A message that fails or is cut off at the length cap commits nothing, so it uses no free message and cannot move the time. Format the time with `formatDateTime`; an older client that does not know the field ignores it.
