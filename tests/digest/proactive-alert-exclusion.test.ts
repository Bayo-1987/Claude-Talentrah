/**
 * send-138's double-notification guard: a job send-138's own proactive alert
 * already surfaced for a user must not ALSO show up in that user's next
 * weekly digest — Farah already told them directly, which is a stronger
 * version of the same fact the digest's own "already acted on" exclusion
 * already applies to a saved/applied job (see digest/send.ts's own comment
 * on `loadCandidates`).
 *
 * Mocked exactly like verification-gate.test.ts: a real `sendJobMatchDigest`
 * run against a recording fake for the service-role client, so the assertion
 * is against the ACTUAL query wiring (loadCandidates now reading
 * `proactive_match_alerts` too), not just reasoned about.
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

const fixtures = vi.hoisted(() => ({
  recipients: [
    {
      user_id: "seeker-1",
      unsubscribe_token: "tok-1",
      digest_last_sent_at: null,
      profiles: { email: "seeker@example.test", first_name: "Ada" },
    },
  ],
  // Three scored postings, all otherwise perfectly eligible for the digest —
  // TWO unrelated ones (B, C) besides the excluded one (A) so the digest's
  // own MIN_JOBS=2 silence floor is cleared either way, and a passing test
  // actually proves the exclusion rather than being consistent with "nothing
  // sent because too few jobs qualified" too:
  //  A — already surfaced by send-138's proactive alert -> must NOT appear
  //  B, C — never surfaced by anything -> should appear normally
  matchScores: [
    {
      score: 92,
      job_posting_id: "job-already-alerted",
      job_postings: {
        id: "job-already-alerted",
        title: "Already Alerted Role",
        company_name: "Some Co",
        location: "Lagos",
        posted_at: "2026-09-10T00:00:00.000Z",
        status: "open",
        organization_id: null,
        unlisted_at: null,
      },
    },
    {
      score: 90,
      job_posting_id: "job-never-surfaced",
      job_postings: {
        id: "job-never-surfaced",
        title: "Never Surfaced Role",
        company_name: "Another Co",
        location: "Abuja",
        posted_at: "2026-09-10T00:00:00.000Z",
        status: "open",
        organization_id: null,
        unlisted_at: null,
      },
    },
    {
      score: 88,
      job_posting_id: "job-also-fine",
      job_postings: {
        id: "job-also-fine",
        title: "Also Fine Role",
        company_name: "Third Co",
        location: "Kano",
        posted_at: "2026-09-10T00:00:00.000Z",
        status: "open",
        organization_id: null,
        unlisted_at: null,
      },
    },
  ],
  applications: [] as { job_posting_id: string }[],
  proactiveAlerts: [{ job_posting_id: "job-already-alerted" }],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        gte: () => chain,
        in: () => chain,
        limit: () => chain,
        update: () => chain,
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        const data =
          table === "email_preferences"
            ? fixtures.recipients
            : table === "match_scores"
              ? fixtures.matchScores
              : table === "organizations"
                ? [] // no orgs to verify — both postings are external in this fixture
                : table === "applications"
                  ? fixtures.applications
                  : table === "proactive_match_alerts"
                    ? fixtures.proactiveAlerts
                    : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { sendJobMatchDigest } from "@/lib/digest/send";

beforeEach(() => {
  sentEmails.length = 0;
});

describe("a job already surfaced by send-138's proactive alert", () => {
  it("does NOT also appear in the same user's weekly digest", async () => {
    const summary = await sendJobMatchDigest();

    // The other two fixture postings alone clear selectDigestJobs' own
    // MIN_JOBS=2 floor, so a real send is guaranteed regardless of whether
    // the exclusion works — this test is decisive rather than merely
    // consistent with "nothing sent because too few jobs qualified".
    expect(summary.sent).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).not.toContain("Already Alerted Role");
  });

  it("jobs never surfaced by anything still appear normally", async () => {
    await sendJobMatchDigest();
    expect(sentEmails[0].text).toContain("Never Surfaced Role");
    expect(sentEmails[0].text).toContain("Also Fine Role");
  });
});
