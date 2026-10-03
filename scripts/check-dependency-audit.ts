/**
 * `npm audit` with one time-boxed, advisory-scoped exception (issue #687). Reads `npm audit --json`; no dependency.
 *
 *   npm audit --json > audit.json || true
 *   tsx scripts/check-dependency-audit.ts audit.json            # full tree: exceptions from scripts/audit-exceptions.ts apply
 *   npm audit --omit=dev --json | tsx scripts/check-dependency-audit.ts --strict   # production tree: NO exceptions
 *
 * Exit 0 = pass, 1 = fail. An audit that could not run (registry error, not JSON, not an npm audit report) FAILS: a missing answer is
 * never read as "clean". `--now=<ISO>` exists for the tests; CI never passes it.
 *
 * HOW A FINDING IS EXPLAINED. npm reports a vulnerable package either with its own advisory (a `via` object carrying the advisory URL) or
 * only because it depends on a vulnerable package (a `via` string naming it). So the chain braces <- micromatch <- fast-glob <- ... is
 * five entries but ONE advisory. A high/critical entry passes only if every high/critical advisory reachable from it, following the
 * strings down, is an unexpired exception; an entry whose advisory cannot be found is failed as unexplained, not passed.
 */
import { readFileSync } from "node:fs";
import { AUDIT_EXCEPTIONS, type AuditException } from "./audit-exceptions";

type Severity = "info" | "low" | "moderate" | "high" | "critical";
interface Advisory {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: Severity;
}
type Via = string | Advisory;
interface VulnerabilityEntry {
  name: string;
  severity: Severity;
  via: Via[];
}
export interface AuditReport {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, VulnerabilityEntry>;
  error?: { code?: string; summary?: string; detail?: string };
}

const BLOCKING: ReadonlySet<Severity> = new Set(["high", "critical"]);
const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

export function parseAuditReport(text: string): AuditReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the audit output is not valid JSON (did `npm audit --json` fail before printing a report?)");
  }
  if (parsed === null || typeof parsed !== "object") throw new Error("the audit output is not an npm audit report");
  const report = parsed as AuditReport;
  if (report.error) return report;
  if (!report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    throw new Error("the audit output is not an npm audit report (no `vulnerabilities` map)");
  }
  return report;
}

/** Last instant an exception applies: the end of its `expires` day, UTC. */
function expiryInstant(e: AuditException): number {
  return Date.parse(`${e.expires}T00:00:00Z`) + 24 * 60 * 60 * 1000;
}

interface Collected {
  advisories: Advisory[];
  unexplained: string[];
}

/** Every advisory object reachable from `name`, following `via` strings; names that cannot be resolved are reported. */
function collect(report: AuditReport, name: string, seen: Set<string>, out: Collected): void {
  if (seen.has(name)) return;
  seen.add(name);
  const entry = report.vulnerabilities?.[name];
  if (!entry) {
    out.unexplained.push(name);
    return;
  }
  for (const via of entry.via) {
    if (typeof via === "string") collect(report, via, seen, out);
    else out.advisories.push(via);
  }
}

export interface EvaluateOptions {
  now?: Date;
  /** Production tree: no exceptions at all. */
  strict?: boolean;
  exceptions?: readonly AuditException[];
}
export interface EvaluateResult {
  ok: boolean;
  messages: string[];
}

export function evaluateAudit(report: AuditReport, options: EvaluateOptions = {}): EvaluateResult {
  const now = (options.now ?? new Date()).getTime();
  const exceptions = options.strict ? [] : (options.exceptions ?? AUDIT_EXCEPTIONS);

  if (report.error) {
    return {
      ok: false,
      messages: [
        `The audit could not run, so nothing was checked: ${report.error.code ?? "error"} ${report.error.summary ?? ""}`.trim(),
        "This is NOT a finding and NOT a pass. Re-run the job; do not read a green PR as evidence the tree was audited.",
      ],
    };
  }

  const failures: string[] = [];
  const excepted: string[] = [];
  const expired = new Set<AuditException>();

  for (const [pkg, entry] of Object.entries(report.vulnerabilities ?? {})) {
    if (!BLOCKING.has(entry.severity)) continue;

    const found: Collected = { advisories: [], unexplained: [] };
    collect(report, pkg, new Set(), found);
    const blocking = found.advisories.filter((a) => a.severity === undefined || BLOCKING.has(a.severity));

    if (blocking.length === 0 || found.unexplained.length > 0) {
      failures.push(
        `${pkg} (${entry.severity}): no advisory explains this severity` +
          (found.unexplained.length ? ` (via ${found.unexplained.join(", ")}, which the report does not list)` : "") +
          "; failing rather than assuming it is covered.",
      );
      continue;
    }

    const unaccounted: string[] = [];
    for (const adv of blocking) {
      const id = adv.url?.match(GHSA)?.[0];
      const exception = id ? exceptions.find((e) => e.advisory.toLowerCase() === id.toLowerCase()) : undefined;
      if (!exception) {
        unaccounted.push(`${id ?? "an advisory with no id"} (${adv.title ?? "untitled"})${adv.name ? ` in ${adv.name}` : ""}`);
      } else if (now >= expiryInstant(exception)) {
        expired.add(exception);
        unaccounted.push(`${exception.advisory} (${adv.title ?? "untitled"}), whose exception expired on ${exception.expires}`);
      }
    }

    if (unaccounted.length > 0) failures.push(`${pkg} (${entry.severity}): ${unaccounted.join("; ")}`);
    else excepted.push(pkg);
  }

  const messages: string[] = [];
  for (const e of expired) {
    messages.push(
      `The audit exception for ${e.advisory} expired on ${e.expires} (issue #${e.issue}). Check whether a patched braces has shipped ` +
        `(npm view braces version; https://github.com/advisories/${e.advisory}), then remove or renew the entry in scripts/audit-exceptions.ts on purpose.`,
    );
  }
  messages.push(...failures);

  if (failures.length === 0) {
    if (excepted.length > 0) {
      const active = exceptions.filter((e) => now < expiryInstant(e));
      messages.push(
        `high findings in ${excepted.join(", ")} are covered by ` +
          active.map((e) => `${e.advisory} (excepted until ${e.expires}, see #${e.issue})`).join(", ") +
          ". Any other high or critical finding fails.",
      );
    } else {
      messages.push(options.strict ? "no high or critical findings (production tree, no exceptions)." : "no high or critical findings.");
    }
  }
  return { ok: failures.length === 0, messages };
}

function main(argv: string[]): number {
  const strict = argv.includes("--strict");
  const nowArg = argv.find((a) => a.startsWith("--now="));
  const file = argv.find((a) => !a.startsWith("--"));
  const now = nowArg ? new Date(nowArg.slice("--now=".length)) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error(`--now is not a date: ${nowArg}`);
    return 1;
  }

  let text: string;
  try {
    text = readFileSync(file ?? 0, "utf8");
  } catch (e) {
    console.error(`could not read the audit report (${file ?? "stdin"}): ${(e as Error).message}`);
    return 1;
  }

  let report: AuditReport;
  try {
    report = parseAuditReport(text);
  } catch (e) {
    console.error(`The audit could not run, so nothing was checked: ${(e as Error).message}`);
    return 1;
  }

  const result = evaluateAudit(report, { now, strict });
  for (const line of result.messages) (result.ok ? console.log : console.error)(line);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && /check-dependency-audit\.ts$/.test(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
