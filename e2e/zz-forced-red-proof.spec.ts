/**
 * FORCED RED, DRAFT PR #802 ONLY: this test fails on purpose to prove the "Playwright e2e" aggregator goes red when one shard fails. It is reverted
 * in the next commit and must never reach main.
 */
import { test } from "@playwright/test";

test("forced red: fails on purpose so the aggregator can be seen red", () => {
  throw new Error("forced red (draft PR #802 proof): this failure is expected");
});
