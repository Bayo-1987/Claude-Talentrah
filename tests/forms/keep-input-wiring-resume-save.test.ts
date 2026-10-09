/** RESUME-SAVE-1/2: the editor reads the save result, keeps the page and the edit on a refusal or a dropped connection, and shows an alert. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const editor = readFileSync(path.join(__dirname, "../../src/components/resume-builder/resume-editor.tsx"), "utf8").replace(/\s+/g, " ");

describe("resume editor Save", () => {
  it("says Saved only on { ok: true }; a refusal shows an alert and leaves the edit and the unsaved guard alone", () => {
    expect(editor).toContain("result = await saveResumeAction(resumeId, content, title);");
    expect(editor).toMatch(/if \(!result\.ok\) \{ [^}]*setSaveError\(result\.error\); return; \}/);
    expect(editor).toMatch(/setSaveError\(null\); setSaved\(true\); setDirty\(false\);/);
    expect(editor).toContain('<p role="alert"');
  });
  it("a save call that REJECTS (dropped connection) is caught and shown the same way, instead of the error screen", () => {
    expect(editor).toMatch(/catch \{ [^}]*setSaveError\("Couldn't reach the server/);
  });
});
