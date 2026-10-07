/**
 * Every place in src that claims a person's profile for a resume review or creates a pending review row, frozen as a list (no database).
 *
 * Before 0238 the AI claim was two statements in application code (a conditional UPDATE of profiles.talent_verification_status to 'pending', then an INSERT into talent_verifications). 0238 moved it into
 * claim_ai_talent_verification, which is where the limit lives. A second AI claim path written the old way would not be limited, and nothing else would notice, so this fails when one appears.
 *
 * The one remaining two-step claim is the HUMAN review (runTalentVerificationHumanReview): a queued row with review_type 'human', paid for with credits, not counted by the AI limit. It shares the
 * profile row with the AI claim, so the two cannot both win (tests/talent-directory/ai-verification-attempt-limit.test.ts, 0238-DB-10, races them).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => {
    const rel = join(dir, n);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });
const SRC = walk("src").filter((f) => !f.endsWith("supabase/types.ts"));
const RUNNER = "src/lib/talent-directory/verification-runner.ts";
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const runner = read(RUNNER);
const aiBody = runner.slice(runner.indexOf("export async function runTalentVerification("), runner.indexOf("export async function runTalentVerificationHumanReview("));
const humanBody = runner.slice(runner.indexOf("export async function runTalentVerificationHumanReview("));

describe("who claims a profile for a resume review", () => {
  it("the only code that sets profiles.talent_verification_status to 'pending' is the human-review claim", () => {
    const hits = SRC.filter((f) => /talent_verification_status:\s*"pending"/.test(read(f)));
    expect(hits).toEqual([RUNNER]);
    expect(aiBody).not.toMatch(/talent_verification_status:\s*"pending"/);
    expect((humanBody.match(/talent_verification_status:\s*"pending"/g) ?? []).length).toBe(1);
  });

  it("the only code that inserts a talent_verifications row is the human-review claim, and it writes review_type 'human'", () => {
    const hits = SRC.filter((f) => /from\("talent_verifications"\)\s*\.insert\(/.test(read(f)));
    expect(hits).toEqual([RUNNER]);
    expect(aiBody).not.toMatch(/\.insert\(/);
    expect(humanBody).toMatch(/review_type:\s*"human"/);
  });

  it("the AI runner claims through claim_ai_talent_verification, once, and nowhere else is that function called", () => {
    expect((aiBody.match(/rpc\("claim_ai_talent_verification"/g) ?? []).length).toBe(1);
    expect(humanBody).not.toMatch(/claim_ai_talent_verification/);
    expect(SRC.filter((f) => /claim_ai_talent_verification/.test(read(f)))).toEqual([RUNNER]);
  });

  it("the AI runner resolves a flagged grade through resolve_flagged_talent_verification and nowhere else is that called", () => {
    expect(SRC.filter((f) => /resolve_flagged_talent_verification/.test(read(f)))).toEqual([RUNNER]);
  });
});
