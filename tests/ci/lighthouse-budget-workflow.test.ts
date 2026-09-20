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

const PACKAGE_JSON_PATH = join(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("lighthouse-budget.yml wires Lighthouse CI against the real Vercel preview", () => {
  it("waits for the Vercel preview deployment rather than building locally", () => {
    expect(workflow).toMatch(/uses:\s*patrickedqvist\/wait-for-vercel-preview/);
  });

  it("actually runs lhci autorun, not just collect", () => {
    expect(workflow).toMatch(/@lhci\/cli(@[\w.-]+)? autorun/);
  });

  it("resolves the job detail URL at runtime from the preview's own sitemap, never a hardcoded job id", () => {
    expect(workflow).toMatch(/sitemap\.xml/);
    // A hardcoded UUID job id would be exactly the kind of thing that
    // silently rots when that posting closes — assert none is present.
    expect(workflow).not.toMatch(/\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("pins the exact @lhci/cli version inside the npx call, not in package.json", () => {
    expect(workflow).toMatch(/@lhci\/cli@\d+\.\d+\.\d+/);
  });

  it("REGRESSION: @lhci/cli is NOT a committed dependency — it broke the Dependency audit job (npm audit --audit-level=high) the one time it was, via its own bundled lighthouse/puppeteer-core pulling in extract-zip and tmp at high-severity-advisory versions", () => {
    expect(packageJson.dependencies?.["@lhci/cli"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@lhci/cli"]).toBeUndefined();
  });

  it("triggers on every pull_request, with no path filtering", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).not.toMatch(/paths:/);
  });

  it("REGRESSION (send-425): sends the Vercel protection-bypass header at all three call sites — wait-for-vercel-preview's own polling, the sitemap curl, and the lhci autorun call — without it, Deployment Protection 401s every request to the preview until wait-for-vercel-preview's own timeout", () => {
    // The secret must be sourced from GitHub Actions secrets, never hardcoded.
    expect(workflow).toMatch(/VERCEL_AUTOMATION_BYPASS_SECRET:\s*\$\{\{\s*secrets\.VERCEL_AUTOMATION_BYPASS_SECRET\s*\}\}/);
    // wait-for-vercel-preview polls the URL itself before any later step
    // runs — its own vercel_protection_bypass_header input (confirmed via
    // that action's own action.yml/source to map straight to this header)
    // is the one that actually matters: this step 401s and times out first
    // if the header is missing here, even with it present everywhere else.
    expect(workflow).toMatch(/vercel_protection_bypass_header:\s*\$\{\{\s*secrets\.VERCEL_AUTOMATION_BYPASS_SECRET\s*\}\}/);
    // The resolve_urls step's curl call carries the header directly. No -f:
    // it would swallow both the body and the status code on a real failure,
    // which is exactly what made this step's first real failure a bare
    // "exit 1" with no diagnostic text at all.
    expect(workflow).toMatch(/curl -sS[^\n]*\n\s*-H "x-vercel-protection-bypass: \$VERCEL_AUTOMATION_BYPASS_SECRET"/);
    expect(workflow).not.toMatch(/curl -fsS/);
    // The autorun call applies it via Lighthouse's own settings object (no
    // --extraHeaders/--collect.extraHeaders flag exists on @lhci/cli — the
    // camelCase settings key nested under --collect.settings is correct).
    expect(workflow).toMatch(/--collect\.settings\.extraHeaders="\{\\"x-vercel-protection-bypass\\":\\"\$VERCEL_AUTOMATION_BYPASS_SECRET\\"\}"/);
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
