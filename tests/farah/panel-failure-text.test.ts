/**
 * Farah (C): which failures get S3's "nothing was charged" note. Only what the SERVER reports as a failed call; never a dropped
 * connection (the server may have finished and charged). And a 402 (not enough credits) is shown in the server's own words, as
 * the copy table's row 7 says, because that message already says what happened and the note would only repeat it.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import { NOTHING_CHARGED_NOTE } from "@/lib/farah/failure-note";

interface Mod {
  serverFailureText?: (status: number | null, message?: string) => string;
}
async function fn() {
  const m = await loadModule<Mod>("@/lib/farah/panel-failure-text");
  if (!m.serverFailureText) throw new Error("panel-failure-text.ts does not export serverFailureText");
  return m.serverFailureText;
}

describe("serverFailureText", () => {
  it("a server error event (no HTTP status: a failure partway through the stream) gets the note", async () => {
    const f = await fn();
    expect(f(null, "Farah couldn't finish that.")).toBe(`Farah couldn't finish that. ${NOTHING_CHARGED_NOTE}`);
  });
  it("a failed request gets the note after the server's own words", async () => {
    const f = await fn();
    expect(f(429, "Too many requests.")).toBe(`Too many requests. ${NOTHING_CHARGED_NOTE}`);
    expect(f(500, "Server error.")).toBe(`Server error. ${NOTHING_CHARGED_NOTE}`);
  });
  it("a failed request with no message gets the generic line and the note", async () => {
    const f = await fn();
    expect(f(500, undefined)).toBe(`Something went wrong — try again. ${NOTHING_CHARGED_NOTE}`);
  });
  it("a message that already says nothing was charged is not told twice", async () => {
    const f = await fn();
    const busy = "Farah is busy right now. Please try again in a few minutes. You haven't been charged for this message.";
    expect(f(503, busy)).toBe(busy);
  });
  it("a 402 is the server's words exactly, with no note added", async () => {
    const f = await fn();
    expect(f(402, "Not enough credits — this needs 1, you have 0.")).toBe("Not enough credits — this needs 1, you have 0.");
  });
});
