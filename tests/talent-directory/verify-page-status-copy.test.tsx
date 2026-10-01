/**
 * send-495 / S19 — the Get Verified page itself, rendered: the status line a person reads under the intro must
 * match the score beside it. Ties tests/talent-directory/verification-headline.test.ts's table to the page, so a
 * future edit that stops using the headline function fails here.
 *
 * Everything the page fetches is mocked; the child panels are stubbed out (they are forms with Server Actions and
 * have nothing to say about the status line).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ current: { status: "unverified", score: null as number | null } }));
const { stub } = vi.hoisted(() => ({ stub: () => () => null }));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/talent-directory/queries", () => ({
  getOwnVerificationState: async () => ({
    ...state.current,
    verifiedAt: null,
    optIn: false,
    availableForHire: false,
    remoteReady: false,
    earliestStartDate: null,
    boostedUntil: null,
  }),
  getVerificationHistory: async () => [],
  getOwnPortfolioItems: async () => [],
  getIncomingContactRequests: async () => [],
}));
vi.mock("@/app/(app)/talent-directory/verify/verification-panel", () => ({ VerificationPanel: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/human-review-form", () => ({ HumanReviewForm: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/opt-in-toggle", () => ({ OptInToggle: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/boost-panel", () => ({ BoostPanel: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/availability-form", () => ({ AvailabilityForm: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/portfolio-manager", () => ({ PortfolioManager: stub() }));
vi.mock("@/app/(app)/talent-directory/verify/incoming-contact-requests", () => ({ IncomingContactRequests: stub() }));

import TalentDirectoryVerifyPage from "@/app/(app)/talent-directory/verify/page";

async function statusLine(status: string, score: number | null): Promise<{ status: string; score: string }> {
  state.current = { status, score };
  const html = renderToStaticMarkup(await TalentDirectoryVerifyPage());
  const text = (re: RegExp) => (html.match(re)?.[1] ?? "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  return {
    status: text(/<p[^>]*data-testid="verification-status"[^>]*>([^<]*)<\/p>/),
    score: text(/Last score: (\d+\/100)/),
  };
}

beforeEach(() => {
  state.current = { status: "unverified", score: null };
});

describe("the status line under the intro matches the score band", () => {
  for (const [status, score, line] of [
    ["rejected", 69, "Not verified yet — here's what to fix"],
    ["verified", 70, "Verified — a few things to tighten"],
    ["verified", 84, "Verified — a few things to tighten"],
    ["verified", 85, "Verified — your resume holds up"],
  ] as const) {
    it(`${status} at ${score}: "${line}", next to "Last score: ${score}/100"`, async () => {
      const got = await statusLine(status, score);
      expect(got.status).toBe(line);
      expect(got.score).toBe(`${score}/100`);
    });
  }

  it("a state with no score keeps its existing line and shows no score", async () => {
    const got = await statusLine("unverified", null);
    expect(got.status).toBe("You haven't requested verification yet.");
    expect(got.score).toBe("");
  });
});
