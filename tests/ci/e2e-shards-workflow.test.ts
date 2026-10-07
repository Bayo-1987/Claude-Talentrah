/**
 * The Playwright suite runs as three shards in .github/workflows/ci.yml, and branch protection requires one check named exactly "Playwright e2e".
 * If that name is lost (a rename, a matrix suffix) the required check silently goes missing and a PR can read as mergeable without any e2e run.
 * This pins: the aggregator's exact name, that it needs the shards and runs even when one fails, the shard count in both places it appears, and
 * that one failed shard does not cancel the others.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: { shard?: number[] } };
  steps?: { name?: string; run?: string; with?: { name?: string } }[];
};
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const jobs = (parse(workflow) as { jobs: Record<string, Job> }).jobs;
const shard = jobs["e2e-shard"];
const aggregator = jobs["e2e"];
const SHARDS = 3;

describe("ci.yml e2e shards", () => {
  it("keeps a job named exactly 'Playwright e2e' (the required check), and it is not a matrix job", () => {
    expect(aggregator?.name).toBe("Playwright e2e");
    expect(aggregator?.strategy).toBeUndefined();
    const names = Object.values(jobs).map((j) => j.name);
    expect(names.filter((n) => n === "Playwright e2e")).toHaveLength(1);
  });

  it("the aggregator needs the shards and runs even when a shard fails or is skipped, and fails unless they all succeeded", () => {
    expect(aggregator.needs).toBe("e2e-shard");
    expect(aggregator.if).toBe("always()");
    const script = (aggregator.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(script).toMatch(/\[ "\$SHARDS_RESULT" = "success" \]/);
  });

  it(`splits the suite into ${SHARDS} shards: the matrix and the --shard flag agree`, () => {
    expect(shard.strategy?.matrix?.shard).toEqual(Array.from({ length: SHARDS }, (_, i) => i + 1));
    const run = (shard.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(run).toContain(`--shard=\${{ matrix.shard }}/${SHARDS}`);
    expect(shard.name).toContain(`/${SHARDS}`);
  });

  it("one failing shard does not cancel the others", () => {
    expect(shard.strategy?.["fail-fast"]).toBe(false);
  });

  it("each shard writes a blob report next to the list lines, and the aggregator merges them into one report", () => {
    const shardRun = (shard.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(shardRun).toContain("--reporter=list,blob");
    const upload = (shard.steps ?? []).find((s) => s.with?.name?.startsWith("blob-report"));
    expect(upload?.with?.name).toContain("${{ matrix.shard }}");
    const aggRun = (aggregator.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(aggRun).toContain("playwright merge-reports");
    expect(aggRun).toMatch(/--reporter=list,html/);
  });

  it("a failed shard uploads its test-results/ (traces and snapshots), and only when it failed", () => {
    const upload = (shard.steps ?? []).find((s) => s.with?.name?.startsWith("test-results-shard"));
    expect(upload, "no test-results upload step on the shard job").toBeDefined();
    expect(upload?.with?.name).toContain("${{ matrix.shard }}");
    expect((upload as { if?: string }).if).toBe("failure()");
    expect((upload as { with?: { path?: string } }).with?.path).toBe("test-results/");
  });

  it("nothing skips e2e on purpose: no paths filter on the workflow and no `if:` on the shard job (so a skip is always unexpected and the aggregator is red on it)", () => {
    const on = (parse(workflow) as { on: Record<string, unknown> }).on as Record<string, { paths?: unknown; "paths-ignore"?: unknown } | null>;
    for (const trigger of Object.values(on ?? {})) {
      expect(trigger?.paths).toBeUndefined();
      expect(trigger?.["paths-ignore"]).toBeUndefined();
    }
    expect(shard.if).toBeUndefined();
  });

  it("the aggregator is green only on 'success': the comparison is exact, not 'not failure'", () => {
    const script = (aggregator.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(script).toMatch(/\[ "\$SHARDS_RESULT" = "success" \]/);
    expect(script).not.toMatch(/!= *"failure"|!= *"cancelled"|!= *"skipped"/);
  });

  it("each shard starts its own database (no shared state between shards)", () => {
    expect(workflow).toMatch(/e2e-shard:[\s\S]*?uses: \.\/\.github\/actions\/local-supabase/);
  });
});
