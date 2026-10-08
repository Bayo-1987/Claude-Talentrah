/**
 * updateScholarshipAction (src/lib/scholarships/admin-edit-action.ts) against the REAL database (service role), with the admin gate and the audit writer replaced by spies:
 * the gate is `requirePermission("scholarships")` (a redirect for anyone else, tested elsewhere), the audit writer is spied so the attribution can be read.
 *
 * Owner row, 8 Oct 2026: editing a pending listing changes its fields, keeps it pending and creates no second row; editing a published listing returns it to pending and writes
 * an audit row against the operator; a rule approval would refuse is refused AT SAVE with the same message; nothing else is touched.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { NOTE_NEEDS_STAMP_MESSAGE } from "@/lib/scholarships/public-deadline-note";

const h = vi.hoisted(() => ({ audit: vi.fn(), redirect: vi.fn(), revalidate: vi.fn(), permission: vi.fn() }));
const OPERATOR = { adminId: "00000000-0000-4000-8000-0000000000aa", email: "op@talentrah.test", displayName: "Ada Operator", permissions: ["scholarships"], sessionId: null };
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: async (p: string) => (h.permission(p), OPERATOR) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: h.audit }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirect(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { updateScholarshipAction } from "@/lib/scholarships/admin-edit-action";

const tag = randomUUID().slice(0, 8);
const ids: string[] = [];
async function seed(k: string, over: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `EDITACT ${k} ${tag}`,
      program_name: `EDITACT Programme ${k} ${tag}`,
      official_url: `https://example.org/editact-${k}-${tag}`,
      funding_type: "full",
      degree_levels: ["msc"],
      host_institution: "Original host",
      eligibility_other: "Original note",
      dedup_fingerprint: randomUUID(),
      ...over,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture ${k}: ${error?.message}`);
  ids.push(data.id);
  return data.id;
}
const row = async (id: string) => (await admin.from("scholarships").select("*").eq("id", id).single()).data!;
function fill(f: FormData, values: Record<string, string | string[]>): FormData {
  for (const [k, v] of Object.entries(values)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}
/** A form carrying a stored row's own values, then the overrides. */
async function formOf(id: string, over: Record<string, string | string[]> = {}): Promise<FormData> {
  const r = await row(id);
  return fill(new FormData(), {
    provider: r.provider,
    programName: r.program_name,
    hostInstitution: r.host_institution ?? "",
    degreeLevels: r.degree_levels as string[],
    fieldTags: (r.field_tags ?? []).join(", "),
    fundingType: r.funding_type,
    fundingCovers: (r.funding_covers ?? []).join(", "),
    eligibilityNationalities: (r.eligibility_nationalities ?? []).join(", "),
    eligibilityPriorDegree: r.eligibility_prior_degree ?? "",
    eligibilityAge: r.eligibility_age ?? "",
    eligibilityOther: r.eligibility_other ?? "",
    applicationDeadline: r.application_deadline ?? "",
    cycleYear: r.cycle_year ? String(r.cycle_year) : "",
    officialUrl: r.official_url,
    sourceName: r.source_name ?? "Manual entry",
    deadlineNote: r.deadline_note ?? "",
    reviewNote: "",
    ...over,
  });
}

beforeEach(() => {
  h.audit.mockReset();
  h.redirect.mockReset();
  h.revalidate.mockReset();
  h.permission.mockReset();
});
afterAll(async () => {
  if (ids.length) {
    const { error } = await admin.from("scholarships").delete().in("id", ids);
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  }
});

const run = (id: string, form: FormData) => updateScholarshipAction(id, { status: "idle" }, form);

describe("editing a PENDING listing", () => {
  it("changes the fields, keeps it pending, creates no second row, leaves the fingerprint, and audits the operator", async () => {
    const id = await seed("p1");
    const before = await row(id);
    await expect(run(id, await formOf(id, { hostInstitution: "Edited host", eligibilityOther: "Edited note" }))).rejects.toThrow("NEXT_REDIRECT");
    const after = await row(id);
    expect(after.host_institution).toBe("Edited host");
    expect(after.eligibility_other).toBe("Edited note");
    expect(after.moderation_status).toBe("pending");
    expect(after.dedup_fingerprint).toBe(before.dedup_fingerprint);
    expect(after.last_checked_at).toBe(before.last_checked_at);
    const { count } = await admin.from("scholarships").select("id", { count: "exact", head: true }).eq("provider", before.provider);
    expect(count).toBe(1);
    expect(h.permission).toHaveBeenCalledWith("scholarships");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ identity: OPERATOR, action: "scholarship.edited", targetTable: "scholarships", targetId: id }));
    expect(h.audit.mock.calls[0][0].detail).toMatchObject({ changed: ["host_institution", "eligibility_other"], returned_to_review: false });
    expect(h.redirect).toHaveBeenCalledWith("/admin/scholarships");
  });
});

describe("editing a PUBLISHED listing", () => {
  it("returns it to pending with a reason and the operator's name, and audits it as returned to review", async () => {
    const id = await seed("v1", { moderation_status: "verified", moderated_at: new Date().toISOString() });
    await expect(run(id, await formOf(id, { hostInstitution: "Edited host" }))).rejects.toThrow("NEXT_REDIRECT");
    const after = await row(id);
    expect(after.moderation_status).toBe("pending");
    expect(after.moderated_at).toBeNull();
    expect(after.moderation_note).toBe("Returned for review: host_institution edited by Ada Operator.");
    expect(h.audit.mock.calls[0][0].detail).toMatchObject({ returned_to_review: true });
    expect(h.revalidate).toHaveBeenCalledWith("/scholarships");
  });
  it("saved with nothing changed it stays published and is not taken off the site", async () => {
    const id = await seed("v2", { moderation_status: "verified", moderated_at: new Date().toISOString() });
    await expect(run(id, await formOf(id))).rejects.toThrow("NEXT_REDIRECT");
    expect((await row(id)).moderation_status).toBe("verified");
  });
});

describe("what is refused", () => {
  it("a deadline note on a listing with no verified deadline is refused AT SAVE with approval's message, and nothing changes", async () => {
    const id = await seed("n1");
    const result = await run(id, await formOf(id, { deadlineNote: "Varies by partner institution" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.deadlineNote?.[0]).toBe(NOTE_NEEDS_STAMP_MESSAGE);
    expect((await row(id)).deadline_note).toBeNull();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.redirect).not.toHaveBeenCalled();
  });
  it("an ingested listing WITH a verified deadline may carry a note", async () => {
    const id = await seed("n2", { deadline_verified_at: new Date().toISOString() });
    await expect(run(id, await formOf(id, { deadlineNote: "Varies by partner institution" }))).rejects.toThrow("NEXT_REDIRECT");
    expect((await row(id)).deadline_note).toBe("Varies by partner institution");
  });
  it("invalid fields are returned as field errors and nothing is written", async () => {
    const id = await seed("i1");
    const result = await run(id, await formOf(id, { provider: "", degreeLevels: [] }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.provider).toBeDefined();
    expect(result.fieldErrors?.degreeLevels).toBeDefined();
    expect((await row(id)).host_institution).toBe("Original host");
  });
  it("a rejected listing cannot be edited", async () => {
    const id = await seed("r1", { moderation_status: "rejected" });
    const result = await run(id, await formOf(id, { hostInstitution: "Edited host" }));
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/can.t be edited/);
    expect((await row(id)).host_institution).toBe("Original host");
  });
  it("an unknown id is an error, not a new row", async () => {
    const result = await run(randomUUID(), fill(new FormData(), { provider: "Nobody", programName: "Nothing", degreeLevels: ["msc"], fundingType: "full", officialUrl: "https://example.org/x" }));
    expect(result.status).toBe("error");
  });
});

describe("other listings are untouched", () => {
  it("editing one listing leaves an ingested pending listing exactly as it was", async () => {
    const ingested = await seed("o1", { deadline_note: "Varies by partner institution", deadline_verified_at: new Date().toISOString() });
    const edited = await seed("o2");
    const before = JSON.stringify(await row(ingested));
    await expect(run(edited, await formOf(edited, { hostInstitution: "Edited host" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(JSON.stringify(await row(ingested))).toBe(before);
  });
});
