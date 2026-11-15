import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const src = files(path.join(ROOT, "src"));

describe("what may start a push", () => {
  it("nothing under src reads employer_applicant_status for a notification: no notification module names that table at all", () => {
    const offenders = src.filter((f) => rel(f).startsWith("src/lib/notifications/") && readFileSync(f, "utf8").includes("employer_applicant_status")).map(rel);
    expect(offenders).toEqual([]);
  });
  it("a change in applications.stage never notifies: the only callers of the event pushes are the application hook, the viewed notice and the match alert", () => {
    const callers = (needle: RegExp) =>
      src
        .filter((f) => needle.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
        .map(rel)
        .sort();
    expect(callers(/\bnotifyNewApplicant\(/)).toEqual(["src/lib/applications/actions.ts", "src/lib/notifications/new-applicant/notify.ts"]);
    expect(callers(/\bpushIfAllowed\(/)).toEqual([
      "src/lib/notifications/employer-resume-view/notify.ts",
      "src/lib/notifications/new-applicant/notify.ts",
      "src/lib/notifications/new-applicant/push-gates.ts",
      "src/lib/notifications/proactive-match-alert/send.ts",
    ]);
    expect(callers(/\bdeliverPushForUser\b/)).toEqual(["src/lib/notifications/new-applicant/push-gates.ts", "src/lib/notifications/push/wiring.ts"]);
  });
});
