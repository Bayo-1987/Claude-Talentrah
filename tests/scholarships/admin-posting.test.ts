import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { upsertScholarships } from "@/lib/scholarships/ingest";
import { computeScholarshipFingerprint } from "@/lib/scholarships/dedup";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

/**
 * The moderation gate around hand-posted listings, against the real database.
 *
 * The gate is the whole feature. A scholarship listing is something a seeker
 * acts on directly — they build an application around the deadline and the
 * award — so `verified` has to mean a human read *this* content, not content
 * that once lived at this fingerprint.
 *
 * Run against the database rather than a mock because every rule here is
 * enforced by something the database owns: the column default supplies
 * `pending`, the unique index on `dedup_fingerprint` supplies the dedup, and
 * `ON CONFLICT DO UPDATE` supplies the collision behaviour. A mocked client
 * would be asserting that this file's own fake behaves like this file expects.
 */

/** Unique per run, so concurrent CI runs cannot collide on the fingerprint. */
const RUN = randomUUID().slice(0, 8);
const created: string[] = [];

function listing(overrides: Partial<NormalizedScholarship> = {}): NormalizedScholarship {
  return {
    provider: `ADMIN-POST-TEST Provider ${RUN}`,
    programName: `Programme ${RUN}`,
    hostInstitution: "Test University",
    degreeLevels: ["msc"],
    fieldTags: ["Engineering"],
    fundingType: "full",
    fundingCovers: ["Tuition", "Stipend"],
    eligibilityNationalities: ["Nigeria"],
    eligibilityPriorDegree: "BSc, second class upper",
    eligibilityAge: "Under 35",
    eligibilityOther: null,
    applicationDeadline: "2026-03-31",
    cycleYear: 2026,
    officialUrl: "https://example.org/scholarship",
    sourceName: "Manual entry",
    deadlineVerifiedAt: null,
    deadlineNote: null,
    reviewNote: null,
    ...overrides,
  };
}

async function rowFor(fingerprint: string) {
  const { data, error } = await admin
    .from("scholarships")
    .select("id, moderation_status, application_deadline, official_url, moderation_note, moderated_at")
    .eq("dedup_fingerprint", fingerprint)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function countFor(fingerprint: string): Promise<number> {
  const { count, error } = await admin
    .from("scholarships")
    .select("id", { count: "exact", head: true })
    .eq("dedup_fingerprint", fingerprint);
  if (error) throw error;
  return count ?? 0;
}

/** Records the row so cleanup can find it even if a later assertion throws. */
async function track(fingerprint: string) {
  const row = await rowFor(fingerprint);
  if (row && !created.includes(row.id)) created.push(row.id);
  return row;
}

beforeAll(async () => {
  // Nothing to set up, but fail loudly here rather than inside the first
  // assertion if the service role key is the placeholder.
  const { error } = await admin.from("scholarships").select("id").limit(1);
  if (error) throw new Error(`cannot reach scholarships: ${error.message}`);
});

afterAll(async () => {
  if (created.length === 0) return;
  // Checked, not fire-and-forget: a refused delete RESOLVES with an error
  // rather than throwing, so an unchecked cleanup reports success whatever
  // happened and the rows pile up silently.
  const { error } = await admin.from("scholarships").delete().in("id", created);
  if (error) {
    console.warn(`[cleanup] ${created.length} test scholarships left behind: ${error.message}`);
  }
});

describe("a manually posted listing lands pending", () => {
  it("takes the column default, whatever the caller wanted", async () => {
    const one = listing({ programName: `Pending Case ${RUN}` });
    const fingerprint = computeScholarshipFingerprint(
      one.provider,
      one.programName,
      one.cycleYear,
    );

    const result = await upsertScholarships([one]);
    expect(result.error).toBeNull();
    expect(result.upserted).toBe(1);

    const row = await track(fingerprint);
    expect(row?.moderation_status).toBe("pending");
  });

  it("the writer never names the column at all", async () => {
    /*
     * The stronger statement, and the reason the row above is pending: it is
     * not that the writer sets "pending", it is that it does not write the
     * column, so the only value it can take on insert is the default. A test
     * that only checked the resulting value would still pass if someone added
     * `moderation_status: input.status` — this one would not.
     */
    const { scholarshipRow } = await import("@/lib/scholarships/ingest");
    const row = scholarshipRow(listing(), "fp", new Date().toISOString());
    expect(Object.keys(row)).not.toContain("moderation_status");
  });
});

describe("a fingerprint collision upserts, it does not duplicate", () => {
  it("posting the same provider + programme + cycle twice leaves one row", async () => {
    const first = listing({ programName: `Collision Case ${RUN}` });
    const fingerprint = computeScholarshipFingerprint(
      first.provider,
      first.programName,
      first.cycleYear,
    );

    await upsertScholarships([first]);
    await track(fingerprint);
    expect(await countFor(fingerprint)).toBe(1);

    // Same identity, different content — the update path.
    await upsertScholarships([{ ...first, officialUrl: "https://example.org/moved" }]);

    expect(await countFor(fingerprint)).toBe(1);
    const row = await rowFor(fingerprint);
    expect(row?.official_url).toBe("https://example.org/moved");
  });

  it("a different cycle year is a different listing, not a duplicate", async () => {
    /*
     * The cycle year is deliberately part of the identity: the same programme
     * reopening for a new intake is a new listing, not last year's row edited.
     * Worth pinning because "dedup" invites the opposite assumption.
     */
    const base = listing({ programName: `Cycle Case ${RUN}` });
    const next = { ...base, cycleYear: 2027 };

    await upsertScholarships([base, next]);
    const fpA = computeScholarshipFingerprint(base.provider, base.programName, 2026);
    const fpB = computeScholarshipFingerprint(base.provider, base.programName, 2027);
    await track(fpA);
    await track(fpB);

    expect(fpA).not.toBe(fpB);
    expect(await countFor(fpA)).toBe(1);
    expect(await countFor(fpB)).toBe(1);
  });

  it("the same listing twice in ONE batch collapses instead of erroring", async () => {
    // ON CONFLICT DO UPDATE cannot touch the same row twice in one command;
    // without the within-batch collapse this is a Postgres error, not a dedup.
    const one = listing({ programName: `Batch Case ${RUN}` });
    const result = await upsertScholarships([one, { ...one, hostInstitution: "Second copy" }]);

    expect(result.error).toBeNull();
    const fingerprint = computeScholarshipFingerprint(one.provider, one.programName, one.cycleYear);
    await track(fingerprint);
    expect(await countFor(fingerprint)).toBe(1);
  });
});

describe("re-posting a VERIFIED listing", () => {
  /** Posts a listing and publishes it, the state every case below starts from. */
  async function publish(programName: string, over: Partial<NormalizedScholarship> = {}) {
    const one = listing({ programName, ...over });
    const fingerprint = computeScholarshipFingerprint(
      one.provider,
      one.programName,
      one.cycleYear,
    );
    await upsertScholarships([one]);
    const row = await track(fingerprint);
    const { error } = await admin
      .from("scholarships")
      .update({
        moderation_status: "verified",
        moderated_at: new Date().toISOString(),
        moderation_note: "Reviewer checked this.",
      })
      .eq("id", row!.id);
    if (error) throw error;
    return { one, fingerprint };
  }

  it("identical content is a no-op — it STAYS verified", async () => {
    /*
     * The case that has to keep working, or the nightly re-ingest empties the
     * catalog into the review queue every single night.
     */
    const { one, fingerprint } = await publish(`Unchanged Case ${RUN}`);

    const result = await upsertScholarships([one]);
    expect(result.error).toBeNull();
    expect(result.returnedToReview).toEqual([]);

    const row = await rowFor(fingerprint);
    expect(row?.moderation_status).toBe("verified");
    // And the reviewer's own note survives an unchanged pass.
    expect(row?.moderation_note).toBe("Reviewer checked this.");
  });

  it("a changed DEADLINE sends it back to pending", async () => {
    // The field a seeker acts on most directly — a wrong one costs them the
    // application, which is the argument for re-review over convenience.
    const { one, fingerprint } = await publish(`Deadline Case ${RUN}`);

    const result = await upsertScholarships([{ ...one, applicationDeadline: "2026-09-30" }]);
    expect(result.returnedToReview).toEqual([fingerprint]);

    const row = await rowFor(fingerprint);
    expect(row?.moderation_status).toBe("pending");
    expect(row?.application_deadline).toBe("2026-09-30");
    expect(row?.moderated_at).toBeNull();
    expect(row?.moderation_note).toContain("application_deadline");
  });

  it("a changed URL sends it back too, and says which field moved", async () => {
    const { one, fingerprint } = await publish(`Url Case ${RUN}`);

    await upsertScholarships([{ ...one, officialUrl: "https://example.org/elsewhere" }]);

    const row = await rowFor(fingerprint);
    expect(row?.moderation_status).toBe("pending");
    expect(row?.moderation_note).toContain("official_url");
  });

  it("a changed eligibility text sends it back", async () => {
    const { one, fingerprint } = await publish(`Eligibility Case ${RUN}`);

    await upsertScholarships([{ ...one, eligibilityOther: "Now restricted to civil servants." }]);

    const row = await rowFor(fingerprint);
    expect(row?.moderation_status).toBe("pending");
    expect(row?.moderation_note).toContain("eligibility_other");
  });

  it("a REJECTED listing is not resurrected by a content change", async () => {
    /*
     * Deliberately narrow. Someone decided to reject this; an edit is not an
     * appeal, and quietly moving it back to pending would put a rejected
     * listing in front of a reviewer as though it were new.
     */
    const one = listing({ programName: `Rejected Case ${RUN}` });
    const fingerprint = computeScholarshipFingerprint(
      one.provider,
      one.programName,
      one.cycleYear,
    );
    await upsertScholarships([one]);
    const row = await track(fingerprint);
    await admin
      .from("scholarships")
      .update({ moderation_status: "rejected" })
      .eq("id", row!.id);

    const result = await upsertScholarships([{ ...one, applicationDeadline: "2027-01-15" }]);
    expect(result.returnedToReview).toEqual([]);

    const after = await rowFor(fingerprint);
    expect(after?.moderation_status).toBe("rejected");
  });

  it("re-verifying is still possible — this adds no new gate", async () => {
    // The whole design rests on this: sending a listing back costs one
    // re-approval by the same operator, not a new permission or a new step.
    const { one, fingerprint } = await publish(`Reverify Case ${RUN}`);
    await upsertScholarships([{ ...one, applicationDeadline: "2026-11-01" }]);
    expect((await rowFor(fingerprint))?.moderation_status).toBe("pending");

    const { setModerationStatus } = await import("@/lib/scholarships/ingest");
    const row = await rowFor(fingerprint);
    await setModerationStatus(row!.id, "verified", "Re-checked after the deadline moved.");

    expect((await rowFor(fingerprint))?.moderation_status).toBe("verified");
  });
});
