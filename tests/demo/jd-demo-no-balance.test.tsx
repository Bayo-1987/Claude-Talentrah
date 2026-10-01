/**
 * send-490 — the signed-out homepage demo has no ledger, and PR #615 (send-489) taught the credit-paid
 * actions to return the account's new `balance_after`. This pins that the anonymous path is untouched by that
 * and can never grow a dependency on it:
 *
 *  - ROUTE: /api/public/jd-demo answers an anonymous visitor with its explicitly enumerated preview fields
 *    and NOTHING about credits (no `creditsBalance`, `creditsSpent`, `isFreeTrial`, `isPassCovered`), and it
 *    never reaches the credit gate or `spendCredits` at all. A signed-out visitor has no profile row, so a
 *    `balance_after` read there could only ever throw or invent a number.
 *  - RENDER: the preview component renders from the flat payload alone, with no credit-balance provider in
 *    the tree (there is none outside the signed-in app shell), and nothing in the demo component files so
 *    much as names a balance.
 *  - SIGNED-IN SHAPE: the component normalises `payload.result ?? payload`, so the extra top-level
 *    `creditsBalance` /api/tailoring now sends for a PAID signed-in run is ignored by it, by construction.
 *
 * Mocked at the module boundary (the limiter's real behaviour is tests/demo/anonymous-limit.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { JdDemoResult, type JdDemoResultData } from "@/components/marketing/jd-demo-result";

const spendCredits = vi.fn();
const checkTailoringAllowance = vi.fn();
const commitTailoringAllowance = vi.fn();
const tailorResumeToJob = vi.fn();
const claimAnonymousRun = vi.fn();

vi.mock("@/lib/credits/spend", () => ({
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/tailoring/gate", () => ({
  checkTailoringAllowance: (...a: unknown[]) => checkTailoringAllowance(...a),
  commitTailoringAllowance: (...a: unknown[]) => commitTailoringAllowance(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/tailoring/tailor", () => ({ tailorResumeToJob: (...a: unknown[]) => tailorResumeToJob(...a) }));
vi.mock("@/lib/demo/anonymous-limit", () => ({
  ANON_DEMO_DAILY_CAP: 100,
  VISITOR_COOKIE: "visitor",
  VISITOR_COOKIE_MAX_AGE: 100,
  claimAnonymousRun: (...a: unknown[]) => claimAnonymousRun(...a),
  releaseAnonymousRun: vi.fn(async () => undefined),
  clientIp: () => "203.0.113.9",
  hashIp: () => "hash",
  newVisitorId: () => "00000000-0000-4000-8000-000000000001",
  parseVisitorId: () => null,
}));

const { POST } = await import("@/app/api/public/jd-demo/route");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);

const RESULT = {
  structuredJd: { title: "Backend Engineer", skills: ["node"] },
  gapAnalysis: [{ status: "matched", requirement: "Node.js", evidence: "x" }],
  tailoredResume: { summary: "A summary.", experience: [], education: [], skills: [], projects: [], certifications: [], contact: {} },
  atsScore: 72,
  atsFixes: ["Add a skills section"],
  jdTruncation: null,
  coverLetter: "Must never be shipped to an anonymous visitor.",
  // Anything credit-shaped a future change might let leak from the shared function's return value.
  creditsBalance: 38,
  creditsSpent: 20,
  isFreeTrial: true,
};

async function post() {
  return POST(
    new Request("http://localhost/api/public/jd-demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jdText: JD, includeCoverLetter: false }),
    }),
  );
}

beforeEach(() => {
  for (const f of [spendCredits, checkTailoringAllowance, commitTailoringAllowance, tailorResumeToJob, claimAnonymousRun]) f.mockReset();
  claimAnonymousRun.mockResolvedValue({ allowed: true });
  tailorResumeToJob.mockResolvedValue(RESULT);
});

describe("POST /api/public/jd-demo — the anonymous path has no ledger", () => {
  it("returns the preview, with exactly the enumerated fields and no credit-shaped field", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(
      ["atsFixes", "atsScore", "gapAnalysis", "jdTruncation", "scoredAgainst", "structuredJd", "tailoredResume"],
    );
    expect(json.scoredAgainst).toBe("sample");
    expect(json.atsScore).toBe(72);
    for (const forbidden of ["creditsBalance", "creditsSpent", "isFreeTrial", "isPassCovered", "balance_after", "coverLetter"]) {
      expect(json, `the anonymous response must not carry ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it("never reaches the credit gate or spendCredits (a signed-out visitor has no ledger to read)", async () => {
    await post();
    expect(tailorResumeToJob).toHaveBeenCalledTimes(1);
    expect(spendCredits).not.toHaveBeenCalled();
    expect(checkTailoringAllowance).not.toHaveBeenCalled();
    expect(commitTailoringAllowance).not.toHaveBeenCalled();
  });

  it("asks for no cover letter on the shared function: the demo is not the one-time cover-letter benefit", async () => {
    await post();
    expect(tailorResumeToJob.mock.calls[0][2]).toBe(false);
  });

  it("is not vacuous: a refused run (already used) also answers without credits and without touching the ledger", async () => {
    claimAnonymousRun.mockResolvedValue({ allowed: false, reason: "already_used" });
    const res = await post();
    expect(res.status).toBe(403);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.reason).toBe("already_used");
    expect(json).not.toHaveProperty("creditsBalance");
    expect(tailorResumeToJob).not.toHaveBeenCalled();
    expect(spendCredits).not.toHaveBeenCalled();
  });
});

describe("the preview renders with no balance anywhere", () => {
  const data: JdDemoResultData = {
    structuredJd: RESULT.structuredJd as unknown as JdDemoResultData["structuredJd"],
    gapAnalysis: RESULT.gapAnalysis as unknown as JdDemoResultData["gapAnalysis"],
    tailoredResume: RESULT.tailoredResume as unknown as JdDemoResultData["tailoredResume"],
    atsScore: 72,
    atsFixes: ["Add a skills section"],
    jdTruncation: null,
  };

  it("renders the signed-out preview from the flat payload, with no credit-balance provider in the tree", () => {
    const html = renderToStaticMarkup(<JdDemoResult data={data} isSignedIn={false} />);
    expect(html).toContain("What Farah sent back");
    expect(html).toContain("Scored against a sample resume");
    expect(html).toContain("72");
    expect(html).not.toMatch(/credits?\b.*\b(left|balance|remaining)|balance/i);
  });

  it("the signed-in render of the same component is just as free of any balance", () => {
    const html = renderToStaticMarkup(<JdDemoResult data={data} isSignedIn />);
    expect(html).toContain("Scored against your saved resume");
    expect(html).not.toMatch(/balance/i);
  });

  it("none of the demo's component files names a balance or the provider (so it cannot start reading one)", () => {
    for (const f of ["jd-demo-input.tsx", "jd-demo-result.tsx", "jd-demo-example.tsx"]) {
      const src = readFileSync(`src/components/marketing/${f}`, "utf8");
      for (const word of ["creditsBalance", "balance_after", "credits-balance", "useReportCreditsBalance", "useDisplayedCreditsBalance"]) {
        expect(src, `${f} mentions ${word}`).not.toContain(word);
      }
    }
  });

  it("the input normalises the two response shapes with `payload.result ?? payload`, so a top-level creditsBalance beside `result` is ignored", () => {
    const src = readFileSync("src/components/marketing/jd-demo-input.tsx", "utf8");
    expect(src).toContain("payload.result ?? payload");
    // Executable form of that line, fed the signed-in shape /api/tailoring now returns for a PAID run.
    const payload = { resumeId: "r", result: data, isFreeTrial: false, creditsSpent: 20, creditsBalance: 38 };
    const normalised = ((p: { result?: unknown }) => p.result ?? p)(payload) as JdDemoResultData;
    expect(normalised).toBe(data);
    expect(normalised).not.toHaveProperty("creditsBalance");
  });
});
