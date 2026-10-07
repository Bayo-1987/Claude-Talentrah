/**
 * How the panel uses its message box (a source check: this project's unit environment has no DOM, so real typing is e2e). Enter and the send button are ONE path, the box is the shared TextArea (not a raw
 * <textarea> or <input>), the message that is sent is prepared in one place, and focus is taken back after a reply by the one rule that decides it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/app-shell/farah-panel.tsx", "utf8");
const composer = readFileSync("src/components/app-shell/farah-composer.tsx", "utf8");

describe("the panel", () => {
  it("renders the composer, and no raw text input or textarea of its own", () => {
    expect(panel).toContain("<FarahComposer");
    expect(panel).not.toMatch(/<textarea\b/);
    expect(panel).not.toMatch(/<input\b/);
  });
  it("Enter and the send button are one path: both call submitCurrent()", () => {
    expect(panel).toMatch(/onEnterSend=\{submitCurrent\}/);
    expect(panel).toMatch(/function handleSubmit\(e: React\.FormEvent\) \{\s*e\.preventDefault\(\);\s*submitCurrent\(\);/);
  });
  it("what is sent is prepared by prepareMessage, once, inside send()", () => {
    expect(panel.match(/prepareMessage\(/g)?.length).toBe(1);
    expect(panel).toMatch(/const trimmed = prepareMessage\(text\);\s*if \(!trimmed \|\| pending\) return;/);
  });
  it("takes focus back after a reply through shouldRefocusAfterSend, and only there", () => {
    expect(panel).toContain("shouldRefocusAfterSend({");
    expect(panel.match(/inputRef\.current\?\.focus\(\)/g)?.length).toBe(2); // the chip prefill (existing) and the refocus
  });
  it("sends the same request as before: the same endpoint and body fields", () => {
    expect(panel).toContain('"/api/farah/chat"');
    expect(panel).toMatch(/JSON\.stringify\(\{ message: trimmed, quickAction, sessionId: sessionId\(\), jobId, \.\.\.ids \}\)/);
  });
});

describe("the composer", () => {
  it("uses the shared TextArea in compact mode, imported by its own path (never the barrel)", () => {
    expect(composer).toContain('from "@/components/ui/text-area"');
    expect(composer).toContain("<TextArea");
    expect(composer).toContain("compact");
  });
  it("is disabled while a reply streams, carries the server's limit, and sends only through the shared handler", () => {
    expect(composer).toContain("disabled={pending}");
    expect(composer).toContain("limit={MAX_MESSAGE_LENGTH}");
    expect(composer).toMatch(/onKeyDown=\{\(e\) => handleComposerKeyDown\(/);
  });
});
