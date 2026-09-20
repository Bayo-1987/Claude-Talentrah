/**
 * send-409 — scripts/check-broken-links.ts (send-384) existed but was never
 * wired into any CI workflow, per its own header comment ("meant to be run
 * by hand or on a schedule... not wired up here — that's a deliberate
 * follow-up"). Pins the two things that would silently regress if the
 * workflow file were ever edited: that it actually runs the checker, and
 * that it stays schedule/dispatch-only rather than gaining a `push` trigger
 * that would run this on every PR against the live production site (the
 * exact load the script's own header says not to add).
 *
 * A plain text scan, not a YAML parser: no YAML-parsing dependency is a
 * committed dependency of this repo (js-yaml is present only transitively,
 * pulled in by another package), so parsing here would depend on something
 * not actually declared for this purpose. tests/seo/robots.test.ts already
 * established the same "text-scan a real file" pattern for a similar
 * static-config regression check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_PATH = join(process.cwd(), ".github/workflows/broken-links.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf-8");

describe("broken-links.yml wires the existing checker into scheduled CI", () => {
  it("actually runs npm run check-broken-links", () => {
    expect(workflow).toMatch(/run:\s*npm run check-broken-links/);
  });

  it("has a schedule trigger", () => {
    expect(workflow).toMatch(/schedule:\n(\s*#.*\n)*\s*-\s*cron:/);
  });

  it("has a workflow_dispatch trigger for manual runs", () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
  });

  it("does NOT run on push — this crawls the live production site, not a merge gate", () => {
    // A bare textual "push:" check would also match this comment block's own
    // prose (which discusses migration-drift.yml's push trigger by name), so
    // this only looks for push as an actual top-level trigger key.
    expect(workflow).not.toMatch(/^\s{2}push:/m);
  });
});
