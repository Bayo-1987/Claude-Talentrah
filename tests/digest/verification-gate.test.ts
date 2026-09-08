/**
 * The digest must clear the same public-listing gate every other surface
 * clears — and unlike the feed, search and sitemap, nothing does that for it
 * for free.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `loadCandidates` reads `match_scores` joined to `job_postings` through the
 * SERVICE ROLE client, which bypasses RLS entirely. The `job postings are
 * publicly readable` policy (0027, 0107) is what hides an unverified
 * organisation's postings on every other surface; it never runs here. A
 * posting whose organisation verified, got scored, then later un-verified
 * (a domain change re-runs verification in both directions —
 * `saveCompanyProfileAction`) could still land in a real weekly email. This
 * is exactly the bug class 0109 already fixed for `promoted_jobs`.
 *
 * ── WHY THIS IS A UNIT TEST, NOT AN INTEGRATION ONE ───────────────────────
 *
 * Matches this feature's own standing rule (see flag-gate.test.ts): the
 * digest is never self-tested against a real database or a real mailer. This
 * drives `sendJobMatchDigest` end to end with a recording fake for the
 * service-role client, so the assertion is against the ACTUAL query wiring —
 * not just the pure `filterListablePostings` helper (covered separately
 * below) — while still touching nothing real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentEmails = vi.hoisted(() => [] as { text: string }[]);

vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: vi.fn(async () => true),
}));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: {
      send: async (payload: { text: string }) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
}));

/**
 * `organizations` and `applications` are keyed by realistic query results —
 * i.e. what Postgres would actually hand back for the filters the code
 * applies — NOT by "everything the fixtures contain". `organizations` below
 * only returns the verified org, because the real query filters
 * `.eq("verified", true)`. Reverting the fix under test does not change what
 * the fake returns for a table; it changes whether `loadCandidates` still
 * queries `organizations` and `filterListablePostings` at all.
 */
const fixtures = vi.hoisted(() => ({
  recipients: [
    {
      user_id: "seeker-1",
      unsubscribe_token: "tok-1",
      digest_last_sent_at: null,
      profiles: { email: "seeker@example.test", first_name: "Ada" },
    },
  ],
  // Five scored postings for the one recipient:
  //  A, B — internal, VERIFIED org (org-verified)      -> should appear
  //  C    — internal, UNVERIFIED org (org-unverified)  -> must NOT appear
  //  D    — internal, VERIFIED org, but unlisted        -> must NOT appear
  //  E    — external (no organisation)                  -> should appear
  matchScores: [
    {
      score: 90,
      job_posting_id: "job-a",
      job_postings: {
        id: "job-a",
        title: "Backend Engineer",
        company_name: "Verified Foods Ltd",
        location: "Lagos",
        posted_at: "2026-09-05T00:00:00.000Z",
        status: "open",
        organization_id: "org-verified",
        unlisted_at: null,
      },
    },
    {
      score: 85,
      job_posting_id: "job-b",
      job_postings: {
        id: "job-b",
        title: "Product Designer",
        company_name: "Verified Foods Ltd",
        location: "Lagos",
        posted_at: "2026-09-05T00:00:00.000Z",
        status: "open",
        organization_id: "org-verified",
        unlisted_at: null,
      },
    },
    {
      score: 95,
      job_posting_id: "job-c",
      job_postings: {
        id: "job-c",
        title: "Unverified Sneaky Role",
        company_name: "Unverified Traders Inc",
        location: "Abuja",
        posted_at: "2026-09-05T00:00:00.000Z",
        status: "open",
        organization_id: "org-unverified",
        unlisted_at: null,
      },
    },
    {
      score: 88,
      job_posting_id: "job-d",
      job_postings: {
        id: "job-d",
        title: "Unlisted Draft Role",
        company_name: "Verified Foods Ltd",
        location: "Lagos",
        posted_at: "2026-09-05T00:00:00.000Z",
        status: "open",
        organization_id: "org-verified",
        unlisted_at: "2026-09-01T00:00:00.000Z",
      },
    },
    {
      score: 80,
      job_posting_id: "job-e",
      job_postings: {
        id: "job-e",
        title: "External Analyst Role",
        company_name: "Some External Co",
        location: "Remote",
        posted_at: "2026-09-05T00:00:00.000Z",
        status: "open",
        organization_id: null,
        unlisted_at: null,
      },
    },
  ],
  // What `.from("organizations").select("id").in(...).eq("verified", true)`
  // actually returns: only the verified org.
  verifiedOrganizations: [{ id: "org-verified" }],
  applications: [] as { job_posting_id: string }[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      let isUpdate = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        gte: () => chain,
        in: () => chain,
        limit: () => chain,
        update: () => {
          isUpdate = true;
          return chain;
        },
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        if (isUpdate) return Promise.resolve({ error: null }).then(resolve);
        const data =
          table === "email_preferences"
            ? fixtures.recipients
            : table === "match_scores"
              ? fixtures.matchScores
              : table === "organizations"
                ? fixtures.verifiedOrganizations
                : table === "applications"
                  ? fixtures.applications
                  : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { filterListablePostings, sendJobMatchDigest, type RawScoredPosting } from "@/lib/digest/send";

beforeEach(() => {
  sentEmails.length = 0;
  fixtures.applications = [];
});

describe("a currently-unverified organisation's posting", () => {
  it("does NOT appear in the digest, even with a match_scores row and the highest score", async () => {
    const summary = await sendJobMatchDigest();

    expect(summary.sent).toBe(1);
    expect(sentEmails).toHaveLength(1);
    const [email] = sentEmails;
    expect(email.text).not.toContain("Unverified Sneaky Role");
    expect(email.text).not.toContain("Unverified Traders Inc");
  });
});

describe("an unlisted posting from an otherwise-verified organisation", () => {
  it("does NOT appear in the digest — a digest is a proactive listing surface", async () => {
    await sendJobMatchDigest();
    const [email] = sentEmails;
    expect(email.text).not.toContain("Unlisted Draft Role");
  });
});

describe("verified and external postings", () => {
  it("still appear normally", async () => {
    await sendJobMatchDigest();
    const [email] = sentEmails;
    expect(email.text).toContain("Backend Engineer");
    expect(email.text).toContain("Product Designer");
    expect(email.text).toContain("External Analyst Role");
  });
});

describe("filterListablePostings — the pure gate, no database involved", () => {
  const posting = (overrides: Partial<RawScoredPosting>): RawScoredPosting => ({
    jobId: "job-x",
    title: "Some Role",
    companyName: "Some Co",
    location: null,
    score: 80,
    postedAt: "2026-09-05T00:00:00.000Z",
    organizationId: null,
    unlistedAt: null,
    ...overrides,
  });

  it("keeps a verified organisation's posting", () => {
    const result = filterListablePostings(
      [posting({ organizationId: "org-1" })],
      new Set(["org-1"]),
    );
    expect(result).toHaveLength(1);
  });

  it("drops an unverified organisation's posting", () => {
    const result = filterListablePostings(
      [posting({ organizationId: "org-2" })],
      new Set(["org-1"]),
    );
    expect(result).toHaveLength(0);
  });

  it("keeps an external posting (no organisation to verify)", () => {
    const result = filterListablePostings([posting({ organizationId: null })], new Set());
    expect(result).toHaveLength(1);
  });

  it("drops an unlisted posting even from a verified organisation", () => {
    const result = filterListablePostings(
      [posting({ organizationId: "org-1", unlistedAt: "2026-09-01T00:00:00.000Z" })],
      new Set(["org-1"]),
    );
    expect(result).toHaveLength(0);
  });
});
