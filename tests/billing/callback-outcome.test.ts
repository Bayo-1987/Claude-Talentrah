/** Every fulfillPayment answer has exactly one place in the callback mapping. The Record type makes this file fail to compile when FulfillResult gains a status that is not listed here. */
import { describe, expect, it } from "vitest";
import { callbackOutcome, type CallbackOutcome } from "@/lib/billing/callback-outcome";
import type { FulfillResult } from "@/lib/billing/fulfill";

const EXPECTED: Record<FulfillResult["status"], CallbackOutcome> = {
  success: "paid",
  already_processed: "paid",
  processing: "processing",
  failed: "failed",
  not_found: "error",
  needs_refund: "error",
};

describe("callbackOutcome", () => {
  it.each(Object.entries(EXPECTED))("%s -> %s", (status, outcome) => {
    expect(callbackOutcome(status as FulfillResult["status"])).toBe(outcome);
  });
  it("processing is never a failure and never a success", () => {
    expect(callbackOutcome("processing")).not.toBe("failed");
    expect(callbackOutcome("processing")).not.toBe("paid");
  });
});
