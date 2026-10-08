/**
 * The price of one Farah chat message is ONE credit (founder-confirmed, NGN 125). Every other test reads CREDIT_COSTS.farahChatMessage, so they would all keep passing if the
 * constant were changed to 2 or 0; this pins the VALUE itself, the way a project ref or a price is pinned: a change here must be a decision, not an accident.
 */
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";

describe("the price of a Farah chat message", () => {
  it("is exactly 1 credit", () => {
    expect(CREDIT_COSTS.farahChatMessage).toBe(1);
  });
});
