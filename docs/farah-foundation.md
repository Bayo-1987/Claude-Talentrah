# Farah foundation: the allowance, the price and the failure note

Three small, shared pieces that the Farah panel and the billing facts call instead of working things out for themselves. Nothing here is panel UI or copy.

## What to call

| Need | Call | Where |
|---|---|---|
| What the next message costs this account (free, a Pass, credits, or refused) | `farahMessageCharge({ freeLeft, passCovered, balance })` | `src/lib/credits/farah-message-charge.ts` (pure, client-safe) |
| The same, from what the panel holds | `panelChipCharge(freeRemaining, balance)` (`freeRemaining`: a number, `null` for an active Pass, `undefined` until loaded) | same file |
| The price of one paid message, for text that reports a charge | `paidMessageCredits()` | same file |
| The allowance numbers and the window edge | `FARAH_CHAT_FREE_ALLOWANCE` (3), `FARAH_CHAT_FREE_WINDOW_DAYS` (30), `freeWindowStart(now)` | `src/lib/farah/free-allowance.ts` (client-safe) |
| When the next free message comes back, from a list of times | `nextFreeMessageAt(usedAt, now)` returns a `Date` or `null` | same file (pure) |
| When the next free message comes back, for one user | `farahChatNextFreeMessageAt(userId, now?)` returns an ISO string or `null` | `src/lib/farah/chat-gate.ts` (server only) |
| The line to add when a reply fails | `withNothingChargedNote(message)`, `NOTHING_CHARGED_NOTE` | `src/lib/farah/failure-note.ts` (client-safe) |

## The rules behind them

- **A free message comes back 30 days after it was used, one at a time.** It is a rolling window, never a calendar month. The next one to come back is the oldest free message still inside the last 30 days, plus 30 days. A message used exactly 30 days ago still counts (the gate's query is `created_at >= now - 30 days`).
- **`null` means nothing to show.** From `nextFreeMessageAt` and `farahChatNextFreeMessageAt` it means nothing was used in the window, or (for the read) that the read failed. Show no date; never guess one.
- **The date is an instant, not a day.** Format it with `formatDateTime` (the app's one formatter) in the viewer's zone: a slot returns mid-day.
- **A Pass holder's free messages follow the same schedule**, but the history route reports no free count for a Pass holder; whether to show the date for one is the caller's decision.
- **The order is free, then a Pass, then credits** (0123). `farahMessageCharge` is the only place that decides it, and the gate calls it, so a label cannot promise a price the gate does not take.
- **The failure note is only for a failure the server reports** (a rate limit, an error, a failure partway through the stream). Never for a dropped connection: the server may have finished and charged by then.
