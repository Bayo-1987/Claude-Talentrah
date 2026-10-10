/** Job posting form: the "Closes" select is controlled by ExpiryField's own state, so React 19's post-action form reset put the DOM select back on its first option while the state kept the choice (and the next submit sent the first option). It is remounted each time the action settles, like the other selects. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(path.join(__dirname, "../../src/components/employer/job-posting-form.tsx"), "utf8").replace(/\s+/g, " ");

describe("job posting form: Closes select", () => {
  it("receives the settled counter from the form and keys ONLY the <select> by it, so the field's own choice state survives the remount", () => {
    expect(form).toContain("<ExpiryField current={initial?.expiresAt ?? null} defaultDays={defaultExpiryDays} settled={settled} />");
    expect(form).toMatch(/function ExpiryField\(\{ current, defaultDays, settled \}: \{ current: string \| null; defaultDays\?: number; settled: number \}\)/);
    expect(form).toMatch(/<select key=\{`expiresIn-\$\{settled\}`\} id="expiresIn" name="expiresIn" value=\{choice\}/);
  });
});
