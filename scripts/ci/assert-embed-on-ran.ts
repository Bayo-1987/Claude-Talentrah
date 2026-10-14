/**
 * Reads the Playwright JSON report of the "embed widget ON" CI job and fails unless the switched-ON tests REALLY RAN AND PASSED.
 *
 * Why this exists: both widget specs skip themselves when the process does not have EMBED_WIDGET_ENABLED=1 (employer-job-widget's ON test, and qa-embed-long-token entirely). A skip is not a failure
 * to Playwright, so a job that lost the flag by a typo would go green having tested nothing. Here a skipped switched-ON test is a failure, a missing spec file is a failure, and a flaky pass
 * (one that needed a retry) is a failure too. The only test allowed to skip is the one that covers the OFF default ("with the server-side switch OFF"): it skips itself when the flag is on, by design.
 *
 *   npx tsx scripts/ci/assert-embed-on-ran.ts embed-on-results.json
 */
import { readFileSync } from "node:fs";

export interface PlaywrightJsonReport {
  suites?: PlaywrightSuite[];
}
interface PlaywrightSuite {
  title?: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}
interface PlaywrightSpec {
  title: string;
  file?: string;
  tests?: { status?: string; results?: { status?: string }[] }[];
}

const REQUIRED_FILES = ["employer-job-widget.spec.ts", "qa-embed-long-token.spec.ts"] as const;
/** The one test per file that covers the default (switch OFF) and skips itself when the switch is on. */
const MAY_SKIP = /switch OFF/;

function collect(suites: PlaywrightSuite[] | undefined, out: PlaywrightSpec[] = [], file?: string): PlaywrightSpec[] {
  for (const suite of suites ?? []) {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) out.push({ ...spec, file: spec.file ?? f });
    collect(suite.suites, out, f);
  }
  return out;
}

export function checkEmbedOnReport(report: PlaywrightJsonReport): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const specs = collect(report.suites);
  if (specs.length === 0) problems.push("the report contains no tests at all");

  for (const file of REQUIRED_FILES) {
    if (!specs.some((s) => s.file?.endsWith(file))) problems.push(`${file} did not run (not in the report)`);
  }
  for (const spec of specs) {
    const status = spec.tests?.[0]?.status ?? "unknown";
    const where = `${spec.file ?? "?"}: "${spec.title}"`;
    if (status === "expected") continue;
    if (status === "skipped") {
      if (!MAY_SKIP.test(spec.title)) problems.push(`${where} was skipped, so the switched-ON flow was NOT tested (is EMBED_WIDGET_ENABLED=1 set on the Playwright process and the app?)`);
      continue;
    }
    problems.push(`${where} ended as "${status}"${status === "flaky" ? " (it needed a retry; this gate does not accept that)" : ""}`);
  }
  return { ok: problems.length === 0, problems };
}

if (process.argv[1]?.endsWith("assert-embed-on-ran.ts") || process.argv[1]?.endsWith("assert-embed-on-ran.js")) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: assert-embed-on-ran.ts <playwright-json-report>");
    process.exit(2);
  }
  const result = checkEmbedOnReport(JSON.parse(readFileSync(file, "utf8")) as PlaywrightJsonReport);
  if (!result.ok) {
    for (const p of result.problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log("embed widget ON flow: the switched-ON tests ran and passed.");
}
