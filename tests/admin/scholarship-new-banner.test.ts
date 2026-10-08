/** /admin/scholarships/new: the save result is announced and scrolled into view (the form is long; the banner sits at the top of it, off screen when the operator presses Save at the bottom). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "../../src/app/admin/(protected)/scholarships/new/admin-scholarship-form.tsx"), "utf8").replace(/\s+/g, " ");

describe("admin New listing: save banner", () => {
  it("is one banner element above the first field, announced (alert for an error, status for a success)", () => {
    expect(src).toContain('role={state.status === "error" ? "alert" : "status"}');
    expect(src.indexOf("bannerRef")).toBeGreaterThan(-1);
    expect(src.indexOf('ref={bannerRef}')).toBeLessThan(src.indexOf('label="Provider"'));
  });
  it("scrolls it into view whenever a save finishes (success or error), not on first render", () => {
    expect(src).toContain("bannerRef.current?.scrollIntoView(");
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(state\.status === "idle"\) return;/);
  });
});
