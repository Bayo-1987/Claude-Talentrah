/**
 * A cross-file lock for the suites that touch the data-exports bucket as a WHOLE.
 *
 * The sweep lists and empties the entire bucket, and so do the cleanups of several suites, while vitest runs test files in parallel workers: one file's sweep would delete another
 * file's planted objects mid-test. A lock directory in the OS temp dir serialises the files that need the bucket to themselves. Created with mkdir (atomic), taken with a bounded wait,
 * and broken only if it is clearly abandoned (older than five minutes). Local stack only: it protects a test database, nothing else.
 */
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = join(tmpdir(), `talentrah-data-export-bucket-${process.env.LOCAL_LOCK_SCOPE ?? "default"}.lock`);
const STALE_MS = 5 * 60 * 1000;
let held = false;

export async function acquireBucketLock(timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(DIR);
      held = true;
      return;
    } catch {
      try {
        if (Date.now() - statSync(DIR).mtimeMs > STALE_MS) rmSync(DIR, { recursive: true, force: true });
      } catch {
        /* released between the two calls: try again */
      }
      if (Date.now() > deadline) throw new Error("could not take the data-exports bucket lock");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

export function releaseBucketLock(): void {
  if (!held) return;
  held = false;
  rmSync(DIR, { recursive: true, force: true });
}
