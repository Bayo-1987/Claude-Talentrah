/**
 * #704 — the approval guard. A pending listing whose public text carries reviewer commentary is refused at approval, with a message naming the field and the
 * phrase, BEFORE the approval function is called; a clean listing is approved with exactly the arguments it always had.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_COMMENTARY_ROW } from "../support/scholarship-commentary-fixture";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  audit: vi.fn(),
  row: { value: null as Record<string, unknown> | null, error: null as { message: string } | null },
  selected: [] as string[],
}));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async () => ({ adminId: "admin-1", email: "ops@example.test" }) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: (...a: unknown[]) => h.audit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/mentorship/notifications", () => ({ notifyMentorApplicationDecision: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: h.rpc,
    from: () => ({
      select: (cols: string) => {
        h.selected.push(cols);
        return { eq: () => ({ maybeSingle: async () => ({ data: h.row.value, error: h.row.error }) }) };
      },
    }),
  }),
}));

import { decideScholarshipAction } from "@/lib/admin/moderation/actions";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const idle = { status: "idle", message: "" } as never;
const clean = { program_name: "Example Scholarship", provider: "Example Foundation", deadline_note: "Varies by partner institution.", eligibility_other: "Open to all." };

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: [{ ok: true, reason: "ok" }], error: null });
  h.audit.mockReset();
  h.row.value = clean;
  h.row.error = null;
  h.selected.length = 0;
});

describe("approving", () => {
  it("refuses a listing with reviewer commentary, names the field and the phrase, and never calls the approval function", async () => {
    h.row.value = { ...clean, ...EXAMPLE_COMMENTARY_ROW };
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified", note: "ok" }));
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/eligibility_age|Eligibility age/i);
    expect(s.message).toMatch(/not machine-verified/i);
    expect(s.message).toMatch(/review note|moderation note/i);
    expect(s.targetId).toBe("s1");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("names every offending field, not only the first", async () => {
    h.row.value = { ...clean, ...EXAMPLE_COMMENTARY_ROW };
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    for (const phrase of ["a human should", "not independently confirmed", "not machine-verified", "needs a human to confirm", "see moderation_note"]) {
      expect((s.message ?? "").toLowerCase()).toContain(phrase);
    }
  });

  it("approves a clean listing with exactly the arguments it always had", async () => {
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified", note: "  Checked the funder's page.  " }));
    expect(s.status).toBe("success");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("admin_moderate_scholarship", { p_actor: "admin-1", p_id: "s1", p_status: "verified", p_note: "Checked the funder's page." });
    expect(h.audit.mock.calls[0][0]).toMatchObject({ action: "scholarship.approved", targetTable: "scholarships", targetId: "s1" });
  });

  it("fails closed: if the row cannot be read, nothing is approved and the operator is told", async () => {
    h.row.value = null;
    h.row.error = { message: "boom" };
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    expect(s.status).toBe("error");
    expect(s.message).not.toMatch(/boom/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the listing is gone by the time it is read (zero rows, no error): nothing is approved", async () => {
    h.row.value = null;
    h.row.error = null;
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/nothing was approved/i);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("fails closed when the read returns an error alongside no data: same outcome, and no database text reaches the operator", async () => {
    h.row.value = null;
    h.row.error = { message: 'permission denied for table "scholarships"' };
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/nothing was approved/i);
    expect(s.message).not.toMatch(/permission denied|scholarships"/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("selects only public text columns for the check, never the moderation note", async () => {
    await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    expect(h.selected.join(",")).not.toMatch(/moderation_note/);
    expect(h.selected.join(",")).toMatch(/eligibility_age/);
  });
});

describe("rejecting is untouched", () => {
  it("a rejection does not read the row for the check and keeps its arguments", async () => {
    h.row.value = { ...clean, ...EXAMPLE_COMMENTARY_ROW };
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "rejected", note: "Wrong programme." }));
    expect(s.status).toBe("success");
    expect(h.rpc).toHaveBeenCalledWith("admin_moderate_scholarship", { p_actor: "admin-1", p_id: "s1", p_status: "rejected", p_note: "Wrong programme." });
  });
});

describe("a row that is not pending cannot be approved, with or without commentary (a withdrawn listing stays out)", () => {
  it("the approval function's not_pending answer keeps today's message", async () => {
    h.rpc.mockResolvedValue({ data: [{ ok: false, reason: "not_pending" }], error: null });
    const s = await decideScholarshipAction(idle, form({ id: "s1", decision: "verified" }));
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/Already decided by someone else/);
  });
});
