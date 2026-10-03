/**
 * #594 (migration 0217) — the database refuses a verified listing whose deadline note has no verified stamp, and any note over 600 characters.
 * Own fixture rows (never production data), one per case, all cleaned up. Service role, because the point is what the DATABASE refuses whoever writes.
 * First run is CI (no database on the authoring machine).
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

const tag = randomUUID().slice(0, 8);
const ids: string[] = [];
const STAMP = new Date().toISOString();

async function insert(over: Record<string, unknown>) {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `NOTE-RULES-TEST ${tag}`,
      program_name: `NOTE-RULES-TEST ${randomUUID().slice(0, 6)}`,
      degree_levels: ["msc"],
      field_tags: [],
      funding_type: "full",
      funding_covers: [],
      eligibility_nationalities: [],
      official_url: "https://example.test/note-rules",
      dedup_fingerprint: `note-rules-${randomUUID()}`,
      ...over,
    } as never)
    .select("id")
    .single();
  if (data) ids.push(data.id);
  return { id: data?.id as string | undefined, error };
}

afterAll(async () => {
  if (ids.length) {
    const { error } = await admin.from("scholarships").delete().in("id", ids);
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  }
});

describe("scholarships_verified_note_needs_stamp", () => {
  it("rejects a verified listing with a note and no verified stamp", async () => {
    const { error } = await insert({ moderation_status: "verified", deadline_note: "A note.", deadline_verified_at: null });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("scholarships_verified_note_needs_stamp");
  });

  it("rejects promoting a pending listing that has a note and no stamp", async () => {
    const { id } = await insert({ moderation_status: "pending", deadline_note: "A note.", deadline_verified_at: null });
    expect(id).toBeTruthy();
    const { error } = await admin.from("scholarships").update({ moderation_status: "verified" } as never).eq("id", id!);
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("scholarships_verified_note_needs_stamp");
  });

  it("allows a verified listing with a note AND a stamp, a pending one with a note and no stamp, and a verified one with no note", async () => {
    expect((await insert({ moderation_status: "verified", deadline_note: "Varies by partner.", deadline_verified_at: STAMP })).error).toBeNull();
    expect((await insert({ moderation_status: "pending", deadline_note: "A note.", deadline_verified_at: null })).error).toBeNull();
    expect((await insert({ moderation_status: "verified", deadline_note: null, deadline_verified_at: null })).error).toBeNull();
  });

  it("lets the expiry sweep's own write through (rejected + a moderation note)", async () => {
    const { id } = await insert({ moderation_status: "verified", deadline_note: "Varies.", deadline_verified_at: STAMP, application_deadline: "2020-01-01" });
    const { error } = await admin.from("scholarships").update({ moderation_status: "rejected", moderation_note: "Cycle deadline passed." } as never).eq("id", id!);
    expect(error).toBeNull();
  });
});

describe("scholarships_deadline_note_max_600", () => {
  it("rejects 601 characters and allows exactly 600", async () => {
    const tooLong = await insert({ moderation_status: "pending", deadline_note: "x".repeat(601) });
    expect(tooLong.error?.code).toBe("23514");
    expect(tooLong.error?.message).toContain("scholarships_deadline_note_max_600");
    expect((await insert({ moderation_status: "pending", deadline_note: "x".repeat(600) })).error).toBeNull();
  });
});
