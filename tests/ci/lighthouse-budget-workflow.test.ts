/**
 * send-410 — a text-scan regression test for the Lighthouse budget
 * workflow, same convention as tests/ci/broken-links-workflow.test.ts
 * (send-409): no YAML-parsing dependency is a committed dependency of this
 * repo, so a plain text scan of a real, static config file is preferred
 * over parsing it.
 *
 * Pins the two things that would silently regress if this file were ever
 * edited: that it actually runs the Lighthouse CI assertion step against a
 * real Vercel preview (not a local build), and that it runs on every PR
 * with no path filtering, per this ticket's own explicit decision.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_PATH = join(process.cwd(), ".github/workflows/lighthouse-budget.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf-8");

const CONFIG_PATH = join(process.cwd(), ".lighthouserc.json");
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as {
  ci: { assert: { assertions: Record<string, [string, { minScore: number }]> } };
};

describe("lighthouse-budget.yml wires Lighthouse CI against the real Vercel preview", () => {
  it("waits for the Vercel preview deployment rather than building locally", () => {
    expect(workflow).toMatch(/uses:\s*patrickedqvist\/wait-for-vercel-preview/);
  });

  it("actually runs lhci autorun, not just collect", () => {
    expect(workflow).toMatch(/@lhci\/cli autorun/);
  });

  it("resolves the job detail URL at runtime from the preview's own sitemap, never a hardcoded job id", () => {
    expect(workflow).toMatch(/sitemap\.xml/);
    // A hardcoded UUID job id would be exactly the kind of thing that
    // silently rots when that posting closes — assert none is present.
    expect(workflow).not.toMatch(/\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("triggers on every pull_request, with no path filtering", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).not.toMatch(/paths:/);
  });
});

describe(".lighthouserc.json's budgets are real numbers with real thresholds, not placeholders", () => {
  it("asserts all four categories as hard errors, not warnings", () => {
    for (const category of [
      "categories:performance",
      "categories:accessibility",
      "categories:best-practices",
      "categories:seo",
    ]) {
      const assertion = config.ci.assert.assertions[category];
      expect(assertion, `missing assertion for ${category}`).toBeDefined();
      expect(assertion[0]).toBe("error");
    }
  });

  it("REGRESSION: no threshold sits above the real measured baseline for its worst page (would fail CI immediately on merge)", () => {
    // The real baseline measured 2026-09-19 against production (mobile,
    // simulated throttling) — see lighthouse-budget.yml's own header for
    // the full per-page table and the cited cause of every score below 100.
    const worstMeasured = {
      "categories:performance": 0.91,
      "categories:accessibility": 0.96,
      "categories:best-practices": 0.92,
      "categories:seo": 0.92,
    };
    for (const [category, worst] of Object.entries(worstMeasured)) {
      const threshold = config.ci.assert.assertions[category][1].minScore;
      expect(threshold, `${category}'s threshold (${threshold}) exceeds the real worst-page baseline (${worst})`).toBeLessThanOrEqual(
        worst,
      );
    }
  });
});
