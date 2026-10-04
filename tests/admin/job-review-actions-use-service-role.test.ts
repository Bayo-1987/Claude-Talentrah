/**
 * The admin decision actions that touch job_postings run as the SERVICE ROLE, never as the signed-in user's session.
 *
 * anon and authenticated read job_postings by column (0218) and have no grant on the admin review note. The admin job-review decision
 * writes that note, and the removal action goes through a SECURITY DEFINER function, so both must use the service-role client: a session
 * client would be refused (42501) at the first statement. This runs the real Server Actions with the two Supabase client factories replaced
 * by recorders, and fails if the session client is ever constructed or the service-role client is not the one that writes.
 * No database: the DB-backed proof that the service role still reads and writes every column is tests/rls/job-postings-column-grants.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rec = vi.hoisted(() => ({ sessionClientBuilt: 0, updates: [] as Record<string, unknown>[], rpcs: [] as { name: string; args: unknown }[] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    rec.sessionClientBuilt += 1;
    throw new Error("the signed-in user's client must not be used by an admin decision");
  },
}));
vi.mock("@/lib/supabase/service-role", () => {
  const chain = (result: unknown): unknown =>
    new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : key === "maybeSingle" || key === "single" ? async () => result : () => chain(result)) });
  return {
    createServiceRoleClient: () => ({
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          rec.updates.push(payload);
          return chain({ data: { id: "j1", title: "T", company_name: "C" }, error: null });
        },
        select: () => chain({ data: { title: "T", company_name: "C" }, error: null }),
      }),
      rpc: async (name: string, args: unknown) => {
        rec.rpcs.push({ name, args });
        return { data: [{ ok: true }], error: null };
      },
    }),
  };
});
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ adminId: "admin-1", email: "a@talentrah.test" }) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: vi.fn(async () => {}) }));
vi.mock("@/lib/mentorship/notifications", () => ({ notifyMentorApplicationDecision: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { decideJobReviewAction, decideJobPostingAction } = await import("@/lib/admin/moderation/actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const STATE = { status: "idle" } as never;

beforeEach(() => {
  rec.sessionClientBuilt = 0;
  rec.updates.length = 0;
  rec.rpcs.length = 0;
});

describe("job-review approve and reject write the review note through the service role", () => {
  it.each([
    ["approved", "Looks fine."],
    ["rejected", "The pay range is missing."],
  ])("%s", async (decision, note) => {
    const result = await decideJobReviewAction(STATE, form({ id: "00000000-0000-0000-0000-000000000001", decision, note }));
    expect(result.status).toBe("success");
    expect(rec.sessionClientBuilt).toBe(0);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]).toMatchObject({ admin_review_decision: decision, admin_review_note: note, admin_reviewed_by: "admin-1" });
  });
});

describe("removal goes through the SECURITY DEFINER function on the service role", () => {
  it("calls admin_moderate_job_posting and never builds the session client", async () => {
    const result = await decideJobPostingAction(STATE, form({ id: "00000000-0000-0000-0000-000000000002", action: "remove", reason: "Not a real job." }));
    expect(result.status).toBe("success");
    expect(rec.sessionClientBuilt).toBe(0);
    expect(rec.rpcs.map((r) => r.name)).toEqual(["admin_moderate_job_posting"]);
  });
});
