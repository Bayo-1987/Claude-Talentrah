/**
 * The dependency-audit gate with ONE time-boxed exception (issue #687).
 *
 * WHY THIS EXISTS. `npm audit --audit-level=high` went red on main on 2026-10-03 because of GHSA-vfj7-8cjw-p6xm (braces <= 3.0.3,
 * a stack-exhaustion DoS) reached through a lint-time dev dependency chain (braces <- micromatch <- fast-glob <-
 * @next/eslint-plugin-next <- eslint-config-next). The advisory has no patched version, so there was nothing to fix and the gate
 * stayed red on every PR, which is how a gate stops meaning anything. The decision (#687): carve out exactly that advisory id,
 * until 2026-11-03, for the full tree only; the production tree (`--omit=dev`) gets no exceptions at all. Renewed on 2026-10-21 to 2026-12-01
 * (still no patched braces; see #687): the dates below are the renewed ones.
 *
 * WHAT THESE TESTS PIN, against `npm audit --json` fixtures (the braces chain is a real capture from main 9b83b30):
 *  - only the excepted advisory      -> pass
 *  - it plus any other high          -> fail   (the exception is the advisory id, never the package)
 *  - it plus another critical        -> fail
 *  - after the expiry date           -> fail, and the message names #687 and says to check for a patched braces
 *  - strict mode (the production run) -> fail even though the advisory id matches
 *  - an audit that could not run (registry error, not JSON) -> fail closed, never a pass
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AUDIT_EXCEPTIONS } from "../../scripts/audit-exceptions";
import { evaluateAudit, parseAuditReport } from "../../scripts/check-dependency-audit";

const FIX = path.join(__dirname, "../fixtures/npm-audit");
const load = (name: string) => parseAuditReport(readFileSync(path.join(FIX, name), "utf8"));
const BEFORE_EXPIRY = new Date("2026-10-03T12:00:00Z");

describe("the exception itself is pinned (a value nobody can change by accident)", () => {
  it("is exactly one advisory id, the date 2026-12-01, issue #687", () => {
    expect(AUDIT_EXCEPTIONS).toEqual([
      expect.objectContaining({ advisory: "GHSA-vfj7-8cjw-p6xm", expires: "2026-12-01", issue: 687 }),
    ]);
  });
});

describe("the expiry date has one home", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it("no file under .github/ repeats the expiry read from scripts/audit-exceptions.ts, and the audit job's comments carry no date at all", () => {
    const expiry = AUDIT_EXCEPTIONS[0].expires;
    expect(expiry, "the search below is only meaningful for a YYYY-MM-DD string").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const root = path.join(__dirname, "../../.github");
    const files = walk(root);
    expect(files.length, "the walk found the .github files").toBeGreaterThan(5);
    const repeating = files.filter((f) => readFileSync(f, "utf8").includes(expiry)).map((f) => path.relative(root, f));
    expect(repeating, `a copy of ${expiry} outside scripts/audit-exceptions.ts goes stale at the next renewal`).toEqual([]);
    // A copy of a PREVIOUS expiry is the same fault, and the search above cannot see it: the audit job's text must hold no date.
    const ci = readFileSync(path.join(root, "workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("dependency-audit:"), ci.indexOf("\n  checks:"));
    expect(job.length, "the audit job was found in ci.yml").toBeGreaterThan(500);
    expect(job).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
  });
});

describe("full tree (dev dependencies included), with the exception", () => {
  it("passes when the only high findings are the excepted advisory (the real braces chain)", () => {
    const r = evaluateAudit(load("braces-chain-only.json"), { now: BEFORE_EXPIRY });
    expect(r.ok, r.messages.join("\n")).toBe(true);
    expect(r.messages.join("\n")).toMatch(/GHSA-vfj7-8cjw-p6xm/);
    expect(r.messages.join("\n")).toMatch(/2026-12-01/);
    expect(r.messages.join("\n")).toMatch(/#687/);
  });

  it("ignores a moderate finding next to it, as `--audit-level=high` always did", () => {
    expect(evaluateAudit(load("braces-chain-plus-moderate.json"), { now: BEFORE_EXPIRY }).ok).toBe(true);
  });

  it("passes a clean report", () => {
    expect(evaluateAudit(load("clean.json"), { now: BEFORE_EXPIRY }).ok).toBe(true);
  });

  it("FAILS when the excepted advisory is accompanied by any other high finding", () => {
    const r = evaluateAudit(load("braces-chain-plus-other-high.json"), { now: BEFORE_EXPIRY });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/example-parser/);
    expect(r.messages.join("\n")).toMatch(/GHSA-aaaa-bbbb-cccc/);
  });

  it("FAILS on another critical finding", () => {
    const r = evaluateAudit(load("braces-chain-plus-other-critical.json"), { now: BEFORE_EXPIRY });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/example-crypto/);
  });

  it("is scoped to the advisory id, not the package: a second advisory on braces itself still fails", () => {
    const r = evaluateAudit(load("braces-two-advisories.json"), { now: BEFORE_EXPIRY });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/GHSA-gggg-hhhh-iiii/);
  });

  describe("expiry", () => {
    it("still passes on the last day (2026-12-01, UTC, to the last second)", () => {
      expect(evaluateAudit(load("braces-chain-only.json"), { now: new Date("2026-12-01T23:59:59Z") }).ok).toBe(true);
    });

    it("FAILS from 2026-12-02T00:00:00Z, and the message names #687 and says to check for a patched braces", () => {
      const r = evaluateAudit(load("braces-chain-only.json"), { now: new Date("2026-12-02T00:00:00Z") });
      expect(r.ok).toBe(false);
      const text = r.messages.join("\n");
      expect(text).toMatch(/#687/);
      expect(text).toMatch(/expired/i);
      expect(text).toMatch(/patched braces/i);
      expect(text).toMatch(/GHSA-vfj7-8cjw-p6xm/);
    });

    it("a clean report is not penalised by the exception having expired", () => {
      expect(evaluateAudit(load("clean.json"), { now: new Date("2027-01-01T00:00:00Z") }).ok).toBe(true);
    });
  });
});

describe("strict mode: the production tree (`--omit=dev`), no exceptions at all", () => {
  it("FAILS a production-only high even though its advisory id matches the exception", () => {
    const r = evaluateAudit(load("braces-chain-only.json"), { now: BEFORE_EXPIRY, strict: true });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/braces/);
    expect(r.messages.join("\n")).not.toMatch(/exception/i);
  });

  it("passes a clean production report", () => {
    expect(evaluateAudit(load("clean.json"), { now: BEFORE_EXPIRY, strict: true }).ok).toBe(true);
  });

  it("FAILS another critical too", () => {
    expect(evaluateAudit(load("braces-chain-plus-other-critical.json"), { now: BEFORE_EXPIRY, strict: true }).ok).toBe(false);
  });
});

describe("an audit that did not run is a failure, never a pass", () => {
  it("a registry error report", () => {
    const r = evaluateAudit(load("registry-error.json"), { now: BEFORE_EXPIRY });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/could not run|did not run/i);
  });

  it("output that is not JSON", () => {
    expect(() => parseAuditReport("npm ERR! network request failed")).toThrow(/not valid JSON/i);
  });

  it("JSON with no vulnerabilities map", () => {
    expect(() => parseAuditReport(JSON.stringify({ hello: "world" }))).toThrow(/not an npm audit/i);
  });

  it("a high node whose advisory cannot be found is failed as unexplained, not excepted", () => {
    const report = load("braces-chain-only.json");
    // Break the chain: micromatch now names a package that is not in the report, so nothing explains its severity.
    report.vulnerabilities!.micromatch.via = ["no-such-package"];
    const r = evaluateAudit(report, { now: BEFORE_EXPIRY });
    expect(r.ok).toBe(false);
    expect(r.messages.join("\n")).toMatch(/micromatch/);
  });
});

describe("the command line (real process, so the exit code is what CI sees)", () => {
  const script = path.join(__dirname, "../../scripts/check-dependency-audit.ts");
  const run = (fixture: string, ...extra: string[]) =>
    spawnSync("npx", ["tsx", script, path.join(FIX, fixture), "--now=2026-10-03T12:00:00Z", ...extra], { encoding: "utf8" });

  it("exits 0 for the braces chain with the exception, 1 in strict mode", () => {
    expect(run("braces-chain-only.json").status).toBe(0);
    const strict = run("braces-chain-only.json", "--strict");
    expect(strict.status).toBe(1);
    expect(strict.stderr + strict.stdout).toMatch(/braces/);
  });

  it("exits 1 for an extra high and for a registry error", () => {
    expect(run("braces-chain-plus-other-high.json").status).toBe(1);
    expect(run("registry-error.json").status).toBe(1);
  });

  it("exits 1, naming #687, once expired", () => {
    const r = spawnSync("npx", ["tsx", script, path.join(FIX, "braces-chain-only.json"), "--now=2026-12-02T00:00:00Z"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/#687/);
  });
});

describe("the workflow actually uses it (a gate nobody calls is not a gate)", () => {
  const ci = readFileSync(path.join(__dirname, "../../.github/workflows/ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("dependency-audit:"), ci.indexOf("\n  checks:"));

  it("runs the full-tree check through the script, and the production tree strictly with --omit=dev", () => {
    expect(job).toMatch(/check-dependency-audit/);
    expect(job).toMatch(/npm audit --omit=dev --json/);
    expect(job).toMatch(/--strict/);
  });

  it("no longer runs the bare `npm audit --audit-level=high` gate that cannot carry an exception", () => {
    expect(job).not.toMatch(/run:\s*npm audit --audit-level=high\s*$/m);
  });

  it("links issue #687 from the workflow comment", () => {
    expect(job).toMatch(/#687/);
  });

  it("is wired as an npm script", () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    expect(pkg.scripts["check-dependency-audit"]).toMatch(/tsx scripts\/check-dependency-audit\.ts/);
  });
});

