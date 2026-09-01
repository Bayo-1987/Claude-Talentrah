/**
 * Teardown helpers with NO dependencies, deliberately.
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────
 *
 * These first lived in ./cleanup.ts, which imports `admin` from ./auth — and
 * that module builds Supabase clients at import time. Pulling it into a
 * PLAYWRIGHT spec, purely to get a control-flow helper, broke five e2e tests
 * that had nothing to do with cleanup: the specs still ran, but organisation
 * creation stopped redirecting. Ten of ten passed with the import removed and
 * five failed with it, on otherwise identical code.
 *
 * The lesson is the boring one — a generic helper must not drag a database
 * client behind it. Nothing here imports anything, so any suite can use it.
 */

/**
 * Run every teardown step, then report whatever failed.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * A teardown hook written the obvious way — delete, check, throw, delete,
 * check, throw — abandons everything after the first failure. The rows it did
 * not reach stay in the shared CI project, and because the hook threw, the
 * suite reports a failure that names only the FIRST problem while quietly
 * creating several more.
 *
 * The worst case is not hypothetical and is why this landed: e2e/admin-blog
 * deletes blog posts, then an `admin_users` row, then a role. A failure on the
 * first left an OPERATOR behind — an admin holding real permissions, in a
 * database other runs share, which then poisons the admin suites in ways that
 * look nothing like a teardown problem when they eventually fail.
 *
 * ── WHY NOT try/finally PER STEP ──────────────────────────────────────────
 *
 * Nested finally blocks give the same guarantee and read terribly at three
 * levels, and — the part that matters — they still surface only one error.
 * Collecting and throwing once means a run that broke three things says so,
 * which is the difference between fixing it and fixing a third of it.
 *
 * ORDER IS PRESERVED, because FK order is real: postings before organisations,
 * admin_users before roles. Steps still run in sequence; a failure just does
 * not stop the queue.
 */
export async function runCleanups(
  ...steps: Array<readonly [label: string, run: () => Promise<unknown>]>
): Promise<void> {
  const failures: string[] = [];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `cleanup left rows behind in ${failures.length} step(s) — ` +
        `every step still ran:\n  - ${failures.join("\n  - ")}`,
    );
  }
}

/**
 * A Supabase delete that reports rather than resolving silently.
 *
 * `await admin.from(x).delete().eq(...)` RESOLVES with an `error` when it is
 * refused; it does not throw. Ten cleanup sites did exactly that and reported
 * success for weeks while test organisations piled up in production. Wrapping
 * the check here means a caller cannot forget it.
 */
export async function mustDelete(
  label: string,
  op: PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await op;
  if (error) throw new Error(`${label}: ${error.message}`);
}
