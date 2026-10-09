/** DELETE-KEEP-1: a near-miss confirmation phrase keeps what was typed so the person fixes the typo instead of retyping it. Only the (public, fixed) phrase comes back. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("delete-account request form", () => {
  it("the near-miss error returns the confirmation field, and the box defaults to it", () => {
    expect(read("src/lib/account-deletion/actions.ts")).toContain('values: submittedValues(formData, ["confirmation"])');
    expect(read("src/components/account-deletion/delete-account-section.tsx")).toContain('defaultValue={inputValue(state.values, "confirmation")}');
  });
});
