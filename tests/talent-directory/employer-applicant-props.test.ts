/**
 * What the employer applicants PAGE hands to the client list: no verification status and no score, ever.
 *
 * The page used to pass every applicant's raw `talent_verification_status` and `talent_verification_score` to a client component. The list only DISPLAYED a "Verified" line, but props travel
 * in the page payload, so a rejected attempt (status "rejected", score 0, including one flagged by the grader's injection guard) was readable in the browser by the employer. #753
 * (VERIFY-1 0a-1) closed that: the page now turns the pair into "which review, if any" on the server (`resumeReview`) and the score goes no further. Since 0234 (VERIFY-1 0a-2) the database no longer returns a score at all, returns a status of 'verified' or null, and
 * returns the review type and date itself; the page works the method out from the type, and this test's fixture is that function's output. This is the regression pin for it, at
 * the boundary that matters: the props of the real page, rendered with a fake database that holds applicants in every verification state. tests/talent-directory/review-badge-surfaces.test.tsx
 * covers what the list RENDERS; this covers what the page SENDS.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/* The page itself, rendered with a fake database: what it hands to the client component. */
const REVIEWED_AT = "2026-10-04T09:30:00Z";
/*
 * The rows `employer_job_applicants` returns since 0234 (VERIFY-1 0a-2): NO score column at all; `talent_verification_status` is 'verified' or null (never pending, rejected or unverified);
 * `talent_verified_at` is the review date; `talent_review_type` is 'ai', 'human' or null (a type only for a verified row). The last row is a non-verified row that nevertheless carries a type:
 * the status decides, so it must show nothing. (The database returns a null date for a non-verified row; the page passes the date through, so the fixture does the same.)
 */
const APPLICANTS = [
  { status: "verified", type: "ai", at: REVIEWED_AT }, // reviewed by Farah
  { status: "verified", type: "human", at: REVIEWED_AT }, // reviewed by a mentor
  { status: "verified", type: null, at: REVIEWED_AT }, // verified, but the type is not known
  { status: null, type: null, at: null }, // not reviewed
  { status: null, type: "ai", at: null }, // not verified, but it holds a type: the status decides
].map((v, i) => ({
  application_id: `a${i}`,
  first_name: `First${i}`,
  last_name: `Last${i}`,
  applied_at: "2026-10-01T10:00:00Z",
  match_score: 70,
  resume_id: `r${i}`,
  status: "applied",
  matched_skills: ["sql"],
  missing_skills: [],
  seniority_alignment: "aligned",
  talent_verification_status: v.status,
  talent_verified_at: v.at,
  talent_review_type: v.type,
  screening_passed: null,
}));

/** A query-builder stand-in: every method returns the same builder, `maybeSingle()` answers with `single`, and awaiting the builder itself answers with `plain`. */
function chain(single: unknown, plain: unknown = single) {
  const p: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(plain);
      if (prop === "maybeSingle" || prop === "single") return async () => single;
      return () => p;
    },
  });
  return p;
}
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/employer/membership", () => ({ requireEmployer: async () => ({ organization: { id: "org-1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: (_cols?: string, opts?: { head?: boolean }) => (opts?.head ? chain({ count: 0 }) : chain({ data: { id: "job-1", title: table } })),
    }),
    rpc: async () => ({ data: APPLICANTS, error: null }),
  }),
}));
const ApplicantListStub = () => null;
vi.mock("@/components/employer/applicant-list", () => ({ ApplicantList: ApplicantListStub }));

function findAll(node: unknown, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, type, out));
  else if (node && typeof node === "object" && "props" in (node as object)) {
    const el = node as ReactElement<{ children?: unknown }>;
    if (el.type === type) out.push(el);
    findAll(el.props?.children, type, out);
  }
  return out;
}

describe("the applicants page: the props it hands to the client list carry no status and no score", () => {
  type Row = Record<string, unknown>;
  async function propsFromPage() {
    const { default: Page } = await import("@/app/employer/jobs/[id]/applicants/page");
    const tree = await Page({ params: Promise.resolve({ id: "job-1" }), searchParams: Promise.resolve({}) });
    const lists = findAll(tree, ApplicantListStub);
    expect(lists, "the page renders the applicant list once").toHaveLength(1);
    return lists[0].props as { applicants: Row[] };
  }

  it("no applicant row has a verification status or a score field at all (not even an empty one)", async () => {
    const { applicants } = await propsFromPage();
    expect(applicants).toHaveLength(5);
    for (const row of applicants) {
      expect(Object.keys(row).filter((k) => /verif|score/i.test(k) && k !== "match_score"), "a verification or score field reached the client").toEqual([]);
    }
  });

  it("the method comes from the review type: 'ai' gives ai, 'human' gives mentor, a verified row with no type gives unknown", async () => {
    const { applicants } = await propsFromPage();
    expect(applicants.slice(0, 3).map((a) => a.resumeReview)).toEqual(["ai", "mentor", "unknown"]);
  });

  it("a row that is not verified shows no review, whatever else it holds (a review type included)", async () => {
    const { applicants } = await propsFromPage();
    expect(applicants.slice(3).map((a) => a.resumeReview)).toEqual([null, null]);
  });

  it("the review date goes only with a verified row: the three verified rows carry it, the two others have none", async () => {
    const { applicants } = await propsFromPage();
    expect(applicants.map((a) => a.resumeReviewedAt)).toEqual([REVIEWED_AT, REVIEWED_AT, REVIEWED_AT, null, null]);
  });

  it("the serialised props (what the browser receives) contain no raw status word, no verification or score field, and no review type", async () => {
    const serialised = JSON.stringify(await propsFromPage());
    expect(serialised).not.toMatch(/rejected|pending|claimed|unverified|"verified"/);
    expect(serialised).not.toMatch(/"talent_|"talentVerification|"talentReview/);
    expect(serialised).not.toMatch(/"score"|verificationScore/i);
    expect(serialised).not.toContain('"human"'); // the raw type stays on the server: the client gets "mentor", "ai" or "unknown" through resumeReview
  });
});
