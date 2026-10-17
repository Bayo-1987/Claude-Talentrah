/**
 * The hourly sweep workflow (.github/workflows/sweep-data-exports-hourly.yml), held to the same rules as the ingest workflow it is modelled on, plus the two the owner added:
 * the secret comes from `env` and is the EXISTING CRON_SECRET (no other secret is named, none is created), and the route is NOT in vercel.json.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const FILE = ".github/workflows/sweep-data-exports-hourly.yml";
const text = readFileSync(FILE, "utf8");
/** Without its comment lines (the header talks about secrets and retries). */
const code = text.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
const wf = parse(text) as {
  on: { schedule: Array<{ cron: string }>; workflow_dispatch: unknown };
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { "timeout-minutes": number; steps: Array<{ env?: Record<string, string>; run?: string }> }>;
};
const job = Object.values(wf.jobs)[0];
const step = job.steps.find((s) => s.run)!;
const route = readFileSync("src/app/api/admin/sweep-data-exports/route.ts", "utf8");
const maxDuration = Number(route.match(/^export const maxDuration = (\d+);/m)?.[1]);
const curlMax = Number(code.match(/--max-time (\d+)/)?.[1]);

describe("sweep-data-exports-hourly.yml", () => {
  it("runs hourly, off the top of the hour, and can be started by hand", () => {
    const [{ cron }] = wf.on.schedule;
    expect(cron).toMatch(/^\d+ \* \* \* \*$/);
    expect(cron.split(" ")[0]).not.toBe("0");
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  it("reads the secret from an env variable, and the script text never interpolates it", () => {
    expect(step.env).toEqual({ CRON_SECRET: "${{ secrets.CRON_SECRET }}" });
    expect(step.run).not.toContain("${{");
    expect(step.run).toContain('"Authorization: Bearer $CRON_SECRET"');
  });

  it("names only the existing CRON_SECRET: no other secret is read, and nothing sets or rotates one", () => {
    expect([...code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])).toEqual(["CRON_SECRET"]);
    expect(code).not.toMatch(/gh secret|secrets:\s*write|set-secret/i);
  });

  it("has no `set -x`, no retry of any kind, and echoes a file (the body), not the request", () => {
    expect(code).not.toMatch(/set\s+-[a-z]*x/);
    expect(code).not.toMatch(/--retry/);
    expect(code).not.toMatch(/nick-fields\/retry|retry-action|wretry/i);
    expect(code).toMatch(/curl -sS /);
    expect(code).toMatch(/-o \/tmp\/sweep-response\.json/);
    expect(code).toMatch(/cat \/tmp\/sweep-response\.json/);
  });

  it("calls the sweep path on the production host", () => {
    expect(code).toContain("https://www.talentrah.com/api/admin/sweep-data-exports");
  });

  it("waits longer than the route can run, and the job limit is above the curl limit", () => {
    expect(Number.isInteger(maxDuration)).toBe(true);
    expect(curlMax).toBeGreaterThanOrEqual(maxDuration + 15);
    expect(job["timeout-minutes"] * 60).toBeGreaterThan(curlMax);
  });

  it("queues rather than overlaps or cancels: its own concurrency group, cancel-in-progress false", () => {
    expect(wf.concurrency).toEqual({ group: "sweep-data-exports-hourly", "cancel-in-progress": false });
  });

  it("turns a non-zero alert count into a failed run", () => {
    expect(code).toMatch(/\.summary\.alerts/);
  });

  it("vercel.json does NOT contain the sweep path (nothing depends on the plan's cron limits)", () => {
    const vercel = readFileSync("vercel.json", "utf8");
    expect(vercel).not.toContain("sweep-data-exports");
    expect(vercel).not.toContain("data-export");
  });
});
