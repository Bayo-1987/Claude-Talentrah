/**
 * #594 — the admin side of the two database rules (migration 0217): a deadline note is at most 600 characters, and a verified listing may carry one only
 * with a verified-deadline stamp. An operator must meet each of these as a clear sentence, never a raw database error, and see the limit while typing.
 *
 *   schema      a note over 600 characters is refused with a message, at 600 it passes;
 *   counter     the form shows a live count against 600 (the pure function and the rendered starting state);
 *   approve     decideScholarshipAction turns the stamp rule's violation into "A deadline note needs a verified-deadline date…";
 *   save        createScholarshipAction turns either constraint's violation into a field message, not "the error is in the server log".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/admin/permissions", () => ({ requirePermission: async () => ({ adminId: "admin-1" }) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: async () => {} }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: h.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { program_name: "Example" } }) }) }) }) }),
}));
vi.mock("@/lib/scholarships/ingest", () => ({ upsertScholarships: h.upsert, setModerationStatus: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { manualScholarshipSchema } from "@/lib/scholarships/schemas";
import { DEADLINE_NOTE_MAX_LENGTH, noteCounter } from "@/lib/scholarships/public-deadline-note";
import { decideScholarshipAction } from "@/lib/admin/moderation/actions";
import { createScholarshipAction } from "@/lib/scholarships/admin-actions";
import { AdminScholarshipForm } from "@/app/admin/(protected)/scholarships/new/admin-scholarship-form";

const valid = {
  provider: "Example Foundation",
  programName: "Example Scholarship",
  degreeLevels: ["msc"],
  fundingType: "full",
  officialUrl: "https://example.test/apply",
};
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const violation = (constraint: string) => ({ code: "23514", message: `new row for relation "scholarships" violates check constraint "${constraint}"` });

beforeEach(() => {
  h.rpc.mockReset();
  h.upsert.mockReset();
});

describe("the limit", () => {
  it("is 600, one constant", () => {
    expect(DEADLINE_NOTE_MAX_LENGTH).toBe(600);
  });

  it("the schema refuses 601 characters with a clear message and accepts exactly 600", () => {
    const over = manualScholarshipSchema.safeParse({ ...valid, deadlineNote: "x".repeat(601) });
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.flatten().fieldErrors.deadlineNote?.[0]).toMatch(/600 characters or fewer/);
    expect(manualScholarshipSchema.safeParse({ ...valid, deadlineNote: "x".repeat(600) }).success).toBe(true);
  });
});

describe("the live counter", () => {
  it("counts against 600, and says how many are over", () => {
    expect(noteCounter(0)).toEqual({ text: "0 / 600", over: false });
    expect(noteCounter(412)).toEqual({ text: "412 / 600", over: false });
    expect(noteCounter(600)).toEqual({ text: "600 / 600", over: false });
    expect(noteCounter(613)).toEqual({ text: "613 / 600 (13 over)", over: true });
  });

  it("the form shows it at its starting state, next to the deadline note field", () => {
    const html = renderToStaticMarkup(<AdminScholarshipForm />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(html).toContain("0 / 600");
  });
});

describe("approving a listing the database refuses", () => {
  it("a note without a verified deadline reads as a sentence, never a raw database error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: violation("scholarships_verified_note_needs_stamp") });
    const s = await decideScholarshipAction({ status: "idle", message: "" } as never, form({ id: "s1", decision: "verified" }));
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/A deadline note needs a verified-deadline date/);
    expect(s.message).toMatch(/remove the note/i);
    expect(s.message).not.toMatch(/23514|violates|constraint|scholarships_/);
    expect(s.targetId).toBe("s1");
  });

  it("any other database error keeps the generic message", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const s = await decideScholarshipAction({ status: "idle", message: "" } as never, form({ id: "s1", decision: "verified" }));
    expect(s.message).toBe("Something went wrong on our end.");
  });
});

describe("saving a listing the database refuses", () => {
  const state = { status: "idle", pending: [], unlocked: true } as never;

  it.each([
    ["scholarships_deadline_note_max_600", /600 characters or fewer/],
    ["scholarships_verified_note_needs_stamp", /needs a verified-deadline date/],
  ])("%s becomes a field message on the deadline note", async (constraint, pattern) => {
    h.upsert.mockResolvedValue({ error: violation(constraint).message, returnedToReview: [] });
    const s = await createScholarshipAction(state, form({ provider: "P", programName: "N", degreeLevels: "msc", fundingType: "full", officialUrl: "https://example.test/x", deadlineNote: "A note." }));
    expect(s.status).toBe("error");
    expect(s.fieldErrors?.deadlineNote?.[0]).toMatch(pattern);
    expect(s.error).not.toMatch(/server log/);
  });
});
