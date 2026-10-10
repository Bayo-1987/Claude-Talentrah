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
 * with no path ALLOW-list; only docs/tests/e2e-only PRs are skipped (see preview-skip.test.ts).
 */
import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW_PATH = join(process.cwd(), ".github/workflows/lighthouse-budget.yml");
const workflow = readFileSync(WORKFLOW_PATH, "utf-8");

// send-443/PR #532 pulled the resolve_urls step's curl call out of this YAML
// into its own tested script (.github/scripts/resolve-sitemap-job-url.sh,
// covered separately by .github/scripts/test-resolve-sitemap-job-url.sh) —
// the curl-header assertion below now checks the script, not this file.
const RESOLVER_SCRIPT_PATH = join(process.cwd(), ".github/scripts/resolve-sitemap-job-url.sh");
const resolverScript = readFileSync(RESOLVER_SCRIPT_PATH, "utf-8");

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

  it("REGRESSION (send-443): calls the extracted, unit-tested resolver script, and self-tests it on every run — not an inline curl script that can only ever be exercised for real inside a full CI run", () => {
    expect(workflow).toMatch(/\.github\/scripts\/resolve-sitemap-job-url\.sh/);
    expect(workflow).toMatch(/\.github\/scripts\/test-resolve-sitemap-job-url\.sh/);
  });

  it("pins the exact @lhci/cli version inside the npx call, not in package.json", () => {
    expect(workflow).toMatch(/@lhci\/cli@\d+\.\d+\.\d+/);
  });

  it("REGRESSION: @lhci/cli is NOT a committed dependency — it broke the Dependency audit job (npm audit --audit-level=high) the one time it was, via its own bundled lighthouse/puppeteer-core pulling in extract-zip and tmp at high-severity-advisory versions", () => {
    expect(packageJson.dependencies?.["@lhci/cli"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@lhci/cli"]).toBeUndefined();
  });

  it("triggers on every pull_request except docs/tests/e2e-only ones (paths-ignore, never an allow-list `paths:`)", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    // An allow-list (`paths:`) would silently skip any new directory; the ignore-list can only ever skip what it names,
    // and it is pinned equal to the Vercel skip rule in tests/ci/preview-skip.test.ts.
    expect(workflow).not.toMatch(/^\s+paths:/m);
    expect(workflow).toMatch(/^\s+paths-ignore:/m);
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
    // The curl call carries the header directly — now inside the extracted
    // resolver script (send-443/PR #532), not this YAML. No -f: it would
    // swallow both the body and the status code on a real failure, which is
    // exactly what made this step's first real failure a bare "exit 1" with
    // no diagnostic text at all.
    expect(resolverScript).toMatch(/curl -sS[^\n]*\n\s*-H "x-vercel-protection-bypass: \$\{VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(resolverScript).not.toMatch(/curl -fsS/);
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

/*
 * The landing page is resolved at run time (from the preview's own sitemap), with a static fallback.
 *
 * Why. The PR job audited a hardcoded `/jobs/remote`. That page returns 404 whenever fewer than LANDING_PAGE_MIN_ENTRIES remote jobs
 * exist (it is gated on a live count), and a PR preview reads the preview database, which can hold fewer than that. The sitemap lists
 * `/jobs/remote` only when the page itself would render, so the sitemap is the source of truth the page-count gate already shares.
 * The resolver therefore reports `landing_url`: the preview's `/jobs/remote` when its own sitemap lists it, otherwise a static public page.
 */
describe("the landing page is resolved at run time, with a static fallback", () => {
  const PREVIEW = "https://example-preview.vercel.app";
  const JOB = "https://www.talentrah.com/jobs/9ae0f6be-8063-4227-95f6-ab21ccb13993";

  function resolve(sitemapLocs: string[]): { status: number; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "lh-resolve-"));
    try {
      const body = `<urlset>${sitemapLocs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
      writeFileSync(join(dir, "body.xml"), body);
      writeFileSync(join(dir, "curl"), `#!/usr/bin/env bash\ncat "${join(dir, "body.xml")}"\nprintf '\\n200'\n`);
      chmodSync(join(dir, "curl"), 0o755);
      const r = spawnSync("bash", ["-e", RESOLVER_SCRIPT_PATH, PREVIEW], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf-8" });
      return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("the PR job does not hardcode /jobs/remote; it audits the resolved landing_url", () => {
    expect(workflow).not.toMatch(/--collect\.url="[^"]*\/jobs\/remote"/);
    expect(workflow).toMatch(/--collect\.url="\$\{\{\s*steps\.resolve_urls\.outputs\.landing_url\s*\}\}"/);
  });

  it("the preview's sitemap lists /jobs/remote: that page (on the PREVIEW's host, not the host the sitemap prints) is the landing page", () => {
    const r = resolve([`https://www.talentrah.com/jobs/remote`, JOB]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`landing_url=${PREVIEW}/jobs/remote\n`);
    expect(r.out).toContain(`job_url=${PREVIEW}/jobs/9ae0f6be-8063-4227-95f6-ab21ccb13993\n`);
  });

  it("the job detail URL is built from the PREVIEW's host too: a sitemap that prints the production origin still yields a preview-host job URL", () => {
    const r = resolve([JOB, "https://www.talentrah.com/jobs/remote"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`job_url=${PREVIEW}/jobs/9ae0f6be-8063-4227-95f6-ab21ccb13993\n`);
    expect(r.out).not.toContain("job_url=https://www.talentrah.com");
  });

  it("the sitemap does not list /jobs/remote (too few remote jobs, so the page would 404): the static /about page is audited instead", () => {
    const r = resolve([JOB, "https://www.talentrah.com/about"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`landing_url=${PREVIEW}/about\n`);
  });

  it("a sub-page such as /jobs/remote/nigeria does not count as the /jobs/remote page being listed", () => {
    const r = resolve([JOB, "https://www.talentrah.com/jobs/remote/nigeria"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`landing_url=${PREVIEW}/about\n`);
  });

  it("the job detail URL is still required: a sitemap with no /jobs/<uuid> fails loudly, exactly as before", () => {
    const r = resolve(["https://www.talentrah.com/jobs/remote"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::error::No /jobs/<uuid> URL found");
  });
});

/*
 * The production run: the real /jobs/remote, informational.
 *
 * A PR preview cannot answer "is the real public job-search page within budget?" (its data is a test fixture), production can.
 * It is a scheduled workflow, so it is never a PR check and cannot gate a merge. At most once a day, never per PR. It needs no new secret:
 * production has no Deployment Protection, so there is no bypass header.
 */
describe("lighthouse-production.yml: an informational, scheduled run against production", () => {
  const prodPath = join(process.cwd(), ".github/workflows/lighthouse-production.yml");
  const prod = existsSync(prodPath) ? readFileSync(prodPath, "utf-8") : "";
  const code = prod.replace(/^\s*#.*$/gm, ""); // the checks below read the workflow's own lines, not its comments

  it("exists", () => {
    expect(existsSync(prodPath)).toBe(true);
  });

  it("runs on a schedule of at most once a day and by hand; never on a pull request or a push", () => {
    expect(code).toMatch(/^\s+schedule:/m);
    const crons = [...code.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(crons).toHaveLength(1);
    // minute hour * * *: both fields are single numbers, so it fires once a day
    expect(crons[0]).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    expect(code).toMatch(/^\s+workflow_dispatch:/m);
    expect(code).not.toMatch(/^\s+(pull_request|push|pull_request_target):/m);
  });

  it("uses no secret at all (no bypass header, no token): production needs none", () => {
    expect(code, "the workflow file must exist, or this check proves nothing").not.toBe("");
    expect(code).not.toMatch(/secrets\./);
    expect(code).not.toMatch(/x-vercel-protection-bypass/);
  });

  it("audits production's real pages: the homepage, /jobs/remote itself (a 404 there is the signal), a job detail from its sitemap, and /mentorship", () => {
    expect(code).toMatch(/https:\/\/www\.talentrah\.com/);
    expect(code).toMatch(/--collect\.url="[^"]*\/jobs\/remote"/);
    expect(code).toMatch(/--collect\.url="[^"]*\/mentorship"/);
    expect(code).toMatch(/\.github\/scripts\/resolve-sitemap-job-url\.sh/);
    expect(code).toMatch(/steps\.resolve_urls\.outputs\.job_url/);
  });

  it("runs the same pinned Lighthouse CI version as the PR job, from the same budgets file, and is not a committed dependency", () => {
    const pr = workflow.match(/@lhci\/cli@(\d+\.\d+\.\d+)/)?.[1];
    expect(pr).toBeDefined();
    expect(code).toContain(`@lhci/cli@${pr} autorun`);
  });

  it("does not wait for a Vercel preview or touch the PR job's gating (a separate file; the PR job is unchanged in how it triggers)", () => {
    expect(code, "the workflow file must exist, or this check proves nothing").not.toBe("");
    expect(code).not.toMatch(/wait-for-vercel-preview/);
  });
});

/*
 * The PR job audits a Vercel PREVIEW, and a preview can never satisfy the SEO category: Vercel serves previews with noindex (Lighthouse's `is-crawlable` fails, "Page is blocked from indexing") and answers
 * /robots.txt with its own response (`robots-txt` fails), so every page scores about 0.5 to 0.6 whatever the app does. First seen on the first run of this workflow that got past the 404 (PR #857, 8 Oct): performance,
 * accessibility and best-practices passed on all four pages and only SEO failed, on all four. So the PR job reads a preview budgets file with the same three thresholds and NO SEO assertion; the full file, SEO
 * included, is still what production is held to (lighthouse-production.yml, scheduled), where SEO is meaningful.
 */
const PREVIEW_CONFIG_PATH = join(process.cwd(), ".lighthouserc.preview.json");
const previewConfig = existsSync(PREVIEW_CONFIG_PATH)
  ? (JSON.parse(readFileSync(PREVIEW_CONFIG_PATH, "utf-8")) as { ci: { collect?: unknown; upload?: unknown; assert: { assertions: Record<string, [string, { minScore: number }]> } } })
  : null;
const productionWorkflow = readFileSync(join(process.cwd(), ".github/workflows/lighthouse-production.yml"), "utf-8");

describe("the preview job's budgets: the same three thresholds, and no SEO assertion (a preview is noindex)", () => {
  it("has a preview budgets file", () => {
    expect(existsSync(PREVIEW_CONFIG_PATH), ".lighthouserc.preview.json is missing").toBe(true);
  });
  it("asserts performance, accessibility and best-practices with EXACTLY the production file's thresholds, as hard errors", () => {
    for (const category of ["categories:performance", "categories:accessibility", "categories:best-practices"]) {
      expect(previewConfig?.ci.assert.assertions[category], category).toEqual(config.ci.assert.assertions[category]);
      expect(previewConfig?.ci.assert.assertions[category][0]).toBe("error");
    }
  });
  it("asserts nothing else: no SEO category, and no other assertion that a preview cannot meet", () => {
    expect(Object.keys(previewConfig?.ci.assert.assertions ?? {}).sort()).toEqual(["categories:accessibility", "categories:best-practices", "categories:performance"]);
  });
  it("collects and uploads exactly as the production file does (only the assertions differ)", () => {
    const full = config.ci as unknown as { collect?: unknown; upload?: unknown };
    expect(previewConfig?.ci.collect).toEqual(full.collect);
    expect(previewConfig?.ci.upload).toEqual(full.upload);
  });
  it("the PR job passes the preview file to lhci", () => {
    expect(workflow).toMatch(/autorun[\s\S]*--config=\.lighthouserc\.preview\.json/);
  });
  it("the production workflow does NOT: it is held to the full file, SEO included", () => {
    expect(productionWorkflow).not.toMatch(/--config/);
    expect(productionWorkflow).not.toMatch(/lighthouserc\.preview/);
  });
});
