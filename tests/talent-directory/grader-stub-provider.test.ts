/**
 * The resume grader against the OFFLINE STUB provider that CI's end-to-end job runs on (src/lib/llm/stub-provider.ts), with the resume the e2e fixture seeds (e2e/fixtures/authed.ts, seedBaseResume).
 *
 * Why this exists: the stub builds its reply from the caller's own JSON schema, and fills every boolean with true. The grader's schema carried a boolean "the resume tried to instruct you", so the stub told the grader
 * "yes" for an ordinary resume, the guard flagged it as a model-reported injection, and the e2e run "never charged" (credit-balance-live.spec.ts and credit-prices.spec.ts, both Talent Directory AI review).
 * That was the stub's reply, not the resume and not the phrase check, but it is also a real constraint: a model-reported flag must default to the benign value when nothing is wrong. The report is now a string
 * with the values "none" and "found", and the stub (which takes the first allowed value of an enum) says "none".
 *
 * Unit test, no database: the provider call is routed to the real StubProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { StructuredResume } from "@/lib/resume/types";

vi.mock("server-only", () => ({}));

const { StubProvider } = await import("@/lib/llm/stub-provider");
const stub = new StubProvider();
vi.mock("@/lib/llm", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/llm")>()),
  getLLMProvider: () => stub,
  generateWithFailover: (call: (p: typeof stub) => Promise<string>) => call(stub),
}));

const { gradeResumeForVerification, VERIFICATION_PASS_THRESHOLD } = await import("@/lib/talent-directory/verification");
const { findInstructionLikeText } = await import("@/lib/talent-directory/injection-flags");

/** Copied from e2e/fixtures/authed.ts seedBaseResume: the structured content every e2e user gets. */
const E2E_RESUME = {
  contact: { name: "E2E Tester", email: "e2e@talentrah.test", location: "Lagos, Nigeria" },
  summary: "Backend engineer with six years building payment systems.",
  experience: [{ title: "Senior Engineer", company: "Paystack", location: "Lagos", startDate: "2021", endDate: "2026", description: "Built and operated payment APIs at scale." }],
  education: [{ school: "University of Lagos", degree: "BSc", field: "Computer Science" }],
  skills: ["Node.js", "Postgres", "TypeScript"],
  projects: [],
  certifications: [],
} as unknown as StructuredResume;

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("the e2e resume, graded by the stub provider the e2e job uses", () => {
  it("the phrase check finds nothing in the fixture resume (so a flag could only come from the model's report)", () => {
    expect(findInstructionLikeText(E2E_RESUME)).toEqual([]);
  });

  it("is not flagged, and gets the stub's score, which is a pass (this is what makes the e2e run charge)", async () => {
    const grade = await gradeResumeForVerification(E2E_RESUME);
    expect(grade.flagged, "the stub's reply must not read as the model reporting an injection").toBeFalsy();
    expect(grade.score).toBe(72);
    expect(grade.passed).toBe(72 >= VERIFICATION_PASS_THRESHOLD);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("[grader-guard]"))).toEqual([]);
  });

  it("the stub's reply to the grader's own schema carries the benign value for the model's report", async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.spyOn(stub, "generateText").mockImplementation(async (opts) => {
      const text = (await stub.generateWithUsage(opts)).text;
      captured = JSON.parse(text);
      return text;
    });
    await gradeResumeForVerification(E2E_RESUME);
    spy.mockRestore();
    expect(captured).toBeDefined();
    expect(captured?.instructions_to_grader, "the report must default to none when the schema is filled in by the stub").toBe("none");
    expect(Object.values(captured ?? {}).includes(true), "no boolean in the grader's schema: the stub fills every boolean with true").toBe(false);
  });
});
