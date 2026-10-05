/**
 * The billing page marks an action "Included" from PASS_COVERAGE (src/lib/passes/pass-coverage.ts). That constant must agree with the
 * code that actually decides coverage, in both directions: every action it calls covered asks `checkPassCoverage`, and every action it
 * calls credits-only does not. Source scan, no database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { PASS_COVERAGE, PASS_COVERAGE_NOTE, coveredByPass, type CreditAction } from "@/lib/passes/pass-coverage";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The body of `export async function <name>` up to the next top-level `export`, so a call in a neighbouring function does not count. */
function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`export (async )?function ${name}\\b`));
  if (start < 0) throw new Error(`function ${name} not found`);
  const rest = source.slice(start + 10);
  const next = rest.search(/\nexport (async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}
const asks = (body: string) => /checkPassCoverage\(/.test(body);

/** Where each action's gate lives: [file, function] (a function of null means the whole file). */
const GATE: Record<CreditAction, [string, string | null]> = {
  tailoringRun: ["src/lib/tailoring/gate.ts", null],
  coverLetterRun: ["src/lib/tailoring/gate.ts", null],
  bulletRewrite: ["src/lib/resume-builder/actions.ts", "rewriteBulletAction"],
  farahChatMessage: ["src/lib/farah/chat-gate.ts", null],
  autoApplySubmission: ["src/lib/auto-apply/actions.ts", null],
  scholarshipEligibilityCheck: ["src/lib/scholarships/actions.ts", "runEligibilityCheckAction"],
  scholarshipSopDraft: ["src/lib/scholarships/actions.ts", "draftSopAction"],
  templateUnlock: ["src/lib/resume-builder/actions.ts", "unlockTemplateAction"],
  talentDirectoryVerification: ["src/lib/talent-directory", null],
  talentDirectoryHumanReview: ["src/lib/talent-directory", null],
  talentDirectoryBoost: ["src/lib/talent-directory", null],
};

function sourceFor(action: CreditAction): string {
  const [file, fn] = GATE[action];
  if (file === "src/lib/talent-directory") {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(join(ROOT, dir))) {
        const p = join(dir, n);
        if (statSync(join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n)) out.push(read(p));
      }
    };
    walk(file);
    return out.join("\n");
  }
  const text = read(file);
  return fn ? functionBody(text, fn) : text;
}

describe("PASS_COVERAGE", () => {
  it("decides every credit-priced action (none missing, none extra)", () => {
    expect(Object.keys(PASS_COVERAGE).sort()).toEqual(Object.keys(CREDIT_COSTS).sort());
  });

  it("covers the seven actions the gates cover, and not the four sold for credits only", () => {
    const covered = (Object.keys(PASS_COVERAGE) as CreditAction[]).filter(coveredByPass).sort();
    expect(covered).toEqual(
      [
        "tailoringRun",
        "coverLetterRun",
        "bulletRewrite",
        "farahChatMessage",
        "autoApplySubmission",
        "scholarshipEligibilityCheck",
        "scholarshipSopDraft",
      ].sort(),
    );
  });

  for (const action of Object.keys(PASS_COVERAGE) as CreditAction[]) {
    it(`${action}: the list says ${PASS_COVERAGE[action]}, and its gate ${PASS_COVERAGE[action] === "pass" ? "asks" : "does not ask"} checkPassCoverage`, () => {
      expect(asks(sourceFor(action))).toBe(coveredByPass(action));
    });
  }

  it("the free-messages note is on Farah messages and nothing else", () => {
    expect(PASS_COVERAGE_NOTE).toEqual({ farahChatMessage: "after your free messages" });
  });
});
