/**
 * send-119 — the tailoring review list's suggestions became editable
 * before being accepted. `buildAcceptedAdditions` is the one place that
 * decides what actually gets sent to /api/tailoring/accept-additions;
 * pulling it out of tailor-form.tsx is what makes it testable at all in
 * this repo's plain-Node vitest environment, which cannot simulate a
 * textarea keystroke.
 */
import { describe, expect, it } from "vitest";
import { buildAcceptedAdditions } from "@/lib/tailoring/accepted-payload";
import type { ProposedAddition } from "@/lib/tailoring/types";

function addition(over: Partial<ProposedAddition> = {}): ProposedAddition {
  return {
    id: "a1",
    section: "skills",
    text: "Original Farah wording",
    reason: "Named in the JD.",
    source: "model",
    ...over,
  };
}

describe("buildAcceptedAdditions", () => {
  it("an unedited, checked addition saves with Farah's original text — no regression for the common case", () => {
    const result = buildAcceptedAdditions([addition()], new Set(["a1"]), {});
    expect(result).toEqual([addition()]);
  });

  it("an edited, checked addition saves the edited text, not Farah's original", () => {
    const result = buildAcceptedAdditions(
      [addition()],
      new Set(["a1"]),
      { a1: "My own rewritten version" },
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("My own rewritten version");
    expect(result[0].text).not.toBe("Original Farah wording");
  });

  it("everything else about an edited addition (id, section, reason, source) survives unchanged", () => {
    const result = buildAcceptedAdditions(
      [addition({ id: "a2", section: "experience", experienceIndex: 1, reason: "Matches a required skill." })],
      new Set(["a2"]),
      { a2: "Edited bullet text" },
    );
    expect(result[0]).toMatchObject({
      id: "a2",
      section: "experience",
      experienceIndex: 1,
      reason: "Matches a required skill.",
      text: "Edited bullet text",
    });
  });

  it("an unchecked addition is excluded, even if it was edited", () => {
    const result = buildAcceptedAdditions(
      [addition({ id: "a3" })],
      new Set(), // never checked
      { a3: "An edit that should never be sent" },
    );
    expect(result).toEqual([]);
  });

  it("only checked items are included, each with its own edit or original applied independently", () => {
    const additions = [addition({ id: "a1" }), addition({ id: "a2", text: "Second suggestion" })];
    const result = buildAcceptedAdditions(additions, new Set(["a1", "a2"]), { a1: "Edited first" });
    expect(result).toEqual([
      { ...addition({ id: "a1" }), text: "Edited first" },
      addition({ id: "a2", text: "Second suggestion" }),
    ]);
  });
});
