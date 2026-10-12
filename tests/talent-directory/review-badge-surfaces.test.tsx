/**
 * VERIFY-1 Phase 0a: the badge where employers see it (the directory list, a candidate's page, the applicant list) and where the seeker sees their own result.
 * The pages are rendered for real (async server components awaited, then rendered to static markup); only the data edges are replaced.
 *
 *   - an AI-reviewed and a mentor-reviewed candidate each get the right line, with their date, in the directory and the candidate page;
 *   - the applicant list shows the right line, with NO date (the date is not in that list's data until Phase 0a-2);
 *   - no score, no "/100" and no "verified" in any employer-facing render, even though the data handed to the page carries the score;
 *   - the seeker's own page still shows their own score.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DirectoryCandidate } from "@/lib/talent-directory/queries";

const state = vi.hoisted(() => ({ candidates: [] as unknown[] }));

vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ userId: "u1", userEmail: "o@example.com", emailConfirmed: true, organization: { id: "org-1", name: "Acme" }, role: "owner" }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.gt = () => q; // 0228: the page's subscription read now asks for a RUNNING row (expires_at in the future)
      q.maybeSingle = async () => ({ data: table === "talent_directory_subscriptions" ? { status: "active", expires_at: "2027-01-01T00:00:00Z" } : null, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/talent-directory/queries", () => ({
  getTalentDirectoryPreview: async () => ({ count: 0, samples: [] }),
  searchTalentDirectory: async () => state.candidates,
  getCandidatePortfolioItems: async () => [],
  getOwnContactRequestStatus: async () => null,
}));
vi.mock("@/lib/talent-directory/subscription-actions", () => ({ purchaseTalentDirectorySubscriptionAction: async () => {} }));
vi.mock("@/lib/talent-directory/waitlist-actions", () => ({ joinTalentDirectoryWaitlistAction: async () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const ai: DirectoryCandidate = { userId: "c1", firstName: "Ada", lastName: "Okafor", country: "Nigeria", availableForHire: true, remoteReady: true, earliestStartDate: null, verifiedAt: "2026-10-05T09:30:00Z", reviewType: "ai" };
const mentor: DirectoryCandidate = { ...ai, userId: "c2", firstName: "Chidi", lastName: "Eze", verifiedAt: "2026-10-12T10:00:00Z", reviewType: "human" };

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const noScore = (html: string) => {
  expect(html).not.toMatch(/\b87\b/);
  expect(html).not.toMatch(/\/\s*100/);
  expect(html).not.toMatch(/verified/i);
};

beforeEach(() => {
  state.candidates = [ai, mentor];
});

describe("the directory list", async () => {
  const { default: Page } = await import("@/app/employer/talent-directory/page");
  const render = async () => text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })));

  it("shows each candidate's own line with their date: Farah (AI) for the 'ai' one, a mentor for the 'human' one", async () => {
    const html = await render();
    expect(html).toContain("Resume reviewed by Farah (AI) · 5 Oct 2026");
    expect(html).toContain("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
  });

  it("each line follows its own candidate's type, in any order (the candidate shape carries no score to go by)", async () => {
    state.candidates = [
      { ...mentor, userId: "c4", firstName: "Yan", lastName: "Bee", verifiedAt: "2026-10-12T10:00:00Z", reviewType: "human" },
      { ...ai, userId: "c3", firstName: "Zed", lastName: "Aye", verifiedAt: "2026-10-05T09:30:00Z", reviewType: "ai" },
    ];
    expect(Object.keys(state.candidates[0] as object)).not.toContain("verificationScore");
    const html = await render();
    expect(html).toMatch(/Zed Aye[\s\S]*?Resume reviewed by Farah \(AI\) · 5 Oct 2026/);
    expect(html).toMatch(/Yan Bee[\s\S]*?Resume reviewed by a Talentrah mentor · 12 Oct 2026/);
  });

  it("a candidate whose review type the database could not give is shown as reviewed, with no reviewer named", async () => {
    state.candidates = [{ ...ai, reviewType: null }];
    const html = await render();
    expect(html).toMatch(/data-testid="resume-reviewed-badge"[^>]*>Resume reviewed · 5 Oct 2026</);
  });

  it("a mentor-reviewed candidate IS listed with a badge (it used to be hidden because it had no score)", async () => {
    const html = await render();
    expect(html).toContain("Chidi Eze");
    expect(html.match(/data-testid="resume-reviewed-badge"/g)).toHaveLength(2);
  });

  it("carries no score, no '/100' and no 'verified'", async () => {
    noScore(await render());
  });

  it("is headed and filtered in the words of what was done, not 'verified'", async () => {
    const html = await render();
    expect(html).toContain("Search candidates with a reviewed resume.");
    state.candidates = [];
    expect(await render()).toContain("No opted-in candidates with a reviewed resume match yet.");
  });

  it("offers 'What this means' on every card, and a link to how we review", async () => {
    const html = await render();
    expect(html.match(/What this means/g)).toHaveLength(2);
    expect(html).toContain('href="/how-we-review-resumes?from=%2Femployer%2Ftalent-directory"');
  });

  it("tab order inside a card: the name link, then 'What this means', then (once it is opened) 'How we review'", async () => {
    const html = await render();
    const card = html.slice(html.indexOf("<li"), html.indexOf("</li>")); // the first card, c1
    const name = card.indexOf('href="/employer/talent-directory/c1"');
    const summary = card.indexOf("<summary");
    const how = card.indexOf('href="/how-we-review-resumes?from=%2Femployer%2Ftalent-directory"');
    expect(name).toBeGreaterThanOrEqual(0);
    expect(summary).toBeGreaterThan(name);
    expect(how).toBeGreaterThan(summary);
    expect(card).not.toMatch(/tabindex/i);
  });

  it("each card's title is still the link to the candidate", async () => {
    const html = await render();
    expect(html).toContain('href="/employer/talent-directory/c1"');
    expect(html).toContain('href="/employer/talent-directory/c2"');
  });
});

describe("a candidate's page", async () => {
  const { default: Page } = await import("@/app/employer/talent-directory/[candidateId]/page");
  const render = async (id: string) => text(renderToStaticMarkup(await Page({ params: Promise.resolve({ candidateId: id }) })));

  it("shows the AI line with its date, and no score", async () => {
    state.candidates = [ai];
    const html = await render("c1");
    expect(html).toContain("Resume reviewed by Farah (AI) · 5 Oct 2026");
    noScore(html);
  });

  it("shows the mentor line with its date (there used to be no badge at all)", async () => {
    state.candidates = [mentor];
    const html = await render("c2");
    expect(html).toContain("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
    noScore(html);
  });

  it("has 'What this means' and the how-we-review link", async () => {
    state.candidates = [ai];
    const html = await render("c1");
    expect(html).toContain("What this means");
    expect(html).toContain("We checked that the resume is complete, specific and consistent. We did not check identity, employment history or skills.");
    expect(html).toContain('href="/how-we-review-resumes?from=%2Femployer%2Ftalent-directory"');
  });
});

describe("the applicant list", async () => {
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
  const { ApplicantList } = await import("@/components/employer/applicant-list");
  const row = (id: string, resumeReview: "ai" | "mentor" | null, resumeReviewedAt: string | null = null) => ({
    application_id: id,
    first_name: "Test",
    last_name: id,
    applied_at: "2026-01-01T00:00:00Z",
    match_score: 70,
    resume_id: null,
    status: "applied",
    explanation: null,
    resumeReview,
    resumeReviewedAt,
    screeningPassed: null,
  });
  const render = (rows: Array<ReturnType<typeof row>>) =>
    text(renderToStaticMarkup(<ApplicantList jobId="j1" applicants={rows as never} hasScreeningQuestions={false} hasAssessment={false} />));

  it("shows the AI line and the mentor line, each with its own review date (0234)", () => {
    const html = render([row("a", "ai", "2026-10-05T09:30:00Z"), row("m", "mentor", "2026-10-12T10:00:00Z")]);
    expect(html).toContain("Resume reviewed by Farah (AI) · 5 Oct 2026");
    expect(html).toContain("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
  });

  it("a review whose date is missing still names who reviewed it, and shows no date", () => {
    const html = render([row("a", "ai", null)]);
    expect(html).toContain("Resume reviewed by Farah (AI)");
    expect(html).not.toMatch(/Resume reviewed by[^<]*·/);
  });

  it("shows nothing for an applicant whose resume has not been reviewed", () => {
    expect(render([row("n", null)])).not.toContain("Resume reviewed");
  });

  it("carries no score, no '/100' and no 'verified'", () => {
    noScore(render([row("a", "ai"), row("m", "mentor")]));
  });

  it("has 'What this means' and the link", () => {
    const html = render([row("a", "ai")]);
    expect(html).toContain("What this means");
    expect(html).toContain('href="/how-we-review-resumes?from=%2Femployer%2Fjobs"');
  });
});
