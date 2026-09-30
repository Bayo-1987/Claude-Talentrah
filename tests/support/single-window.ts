/**
 * Run a rate-limit scenario so that it is ABOUT ONE WINDOW, whatever the clock
 * does (send-482).
 *
 * THE FLAKE THIS REMOVES. `consume_anonymous_rate_limit` (0117) counts in fixed,
 * clock-aligned windows: a 15-minute bucket's windows end at :00, :15, :30 and
 * :45. A test that fires a burst and then asserts "exactly 20 of 23 were
 * allowed" is only true if the whole burst lands in ONE window. If it straddles
 * a boundary the calls are split across two counters, each of which stays under
 * the limit, and all 23 are allowed. That happened once in CI: the test file
 * began at about 11:44:59.95 and the burst ran across 11:45:00.
 *
 * WHY DETECT-AND-RETRY, NOT "WAIT FOR JUST AFTER A BOUNDARY". The window comes
 * from Postgres `now()`; the test process cannot inject a clock into it, and a
 * wait-until-the-window-is-young guard would have to assume the test runner's
 * clock and the database's clock agree. The database already reports which
 * window each call was counted in (`resets_at`), so this asks it, rather than
 * guessing: if every outcome a scenario observed carries the same window end,
 * the scenario ran inside one window and its assertions are valid; if not, it
 * straddled a boundary, and it is run again with a fresh key. A retry can only
 * start after the boundary that split the first attempt, so it lands in the new
 * window. No sleeping, no clock assumption, and nothing is asserted about a
 * straddled run.
 *
 * The scenario must use a FRESH key each attempt (the counter for the old key
 * is already spent) and must return every outcome it saw, denied ones included,
 * since denied calls carry `resetsAt` too.
 */
export interface WindowStamped {
  resetsAt: string | null;
}

export async function inOneWindow<T extends { outcomes: WindowStamped[] }>(
  scenario: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  const windowsSeen: string[][] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await scenario();
    const windows = [...new Set(result.outcomes.map((o) => o.resetsAt ?? "null"))].sort();
    windowsSeen.push(windows);
    if (windows.length === 1 && windows[0] !== "null") return result;
  }
  throw new Error(
    `inOneWindow: ${maxAttempts} attempts in a row did not land in a single window ` +
      `(windows seen per attempt: ${JSON.stringify(windowsSeen)}). A null window means the ` +
      `counter call itself failed; more than one means the scenario kept straddling a boundary.`,
  );
}
