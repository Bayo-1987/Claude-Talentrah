/**
 * Does this function definition take a row lock on the token row BEFORE it updates the posting?
 *
 * Pure, so it can be tested with a definition that has the lock and one that does not
 * (row-lock-check.test.ts), independently of what the database currently holds. The database-backed test
 * (expiry-reminders-db.test.ts) feeds it the live pg_get_functiondef output.
 *
 * The lock is `select ... from public.job_expiry_reminders ... for update`: it is what serialises two uses of one link,
 * so the second finds `used_at` set. It must come before the `update public.job_postings`, otherwise the posting is
 * moved first and the lock protects nothing.
 */
export function takesRowLockBeforeUpdating(definition: string): boolean {
  // Strip line comments so a lock mentioned only in prose does not count.
  const code = definition
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .toLowerCase();

  const lock = /from\s+public\.job_expiry_reminders\s+where\s+token_hash\s*=\s*p_token_hash\s+for\s+update/.exec(code);
  const update = /update\s+public\.job_postings/.exec(code);
  if (!lock || !update) return false;
  return lock.index < update.index;
}
