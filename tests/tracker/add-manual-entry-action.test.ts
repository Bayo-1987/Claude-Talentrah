/**
 * send-494 / S14 — addManualEntryAction trusted the `stage` field of its FormData.
 *
 * `String(formData.get("stage") ?? "saved") as Enums<"application_stage">` is a cast, not a check: any value a
 * client sends went straight into the INSERT, and the result of the INSERT was never read, so a value the
 * database rejected looked exactly like a success. A Server Action is a public POST endpoint; the <select> is
 * a courtesy, not a control. Validated here against the one stage list (TRACKER_STAGES).
 *
 * Owner decision, 2026-10-01: a manually added entry MAY be "Hired" (it is backfilled history), and when it is
 * it does NOT send the hired-moment email or redirect to the referral banner: that flow belongs to
 * `updateStageAction`, where the user has just *moved* an application to Hired. Hired stays terminal afterwards
 * (0037, which fires on UPDATE only and is not affected by this).
 *
 * Everything is mocked, no database, same convention as update-stage-action.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const idle = { status: "idle" } as const;
import { TRACKER_STAGES } from "@/lib/tracker/stages";

const hiredEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/notifications/hired-moment/send", () => ({ sendHiredMomentEmail: hiredEmail }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "applications") state.inserts.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));

import { addManualEntryAction } from "@/lib/applications/tracker-actions";

function form(over: Record<string, string | null> = {}): FormData {
  const f = new FormData();
  const fields: Record<string, string | null> = { companyName: "Moniepoint", title: "Illustrator", ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}

beforeEach(() => {
  state.inserts.length = 0;
  state.insertError = null;
  hiredEmail.mockClear();
  redirect.mockClear();
  revalidatePath.mockClear();
});

describe("a forged stage is refused on the server", () => {
  for (const forged of ["bogus", "HIRED", " hired", "hired ", "all", "", "null", "undefined", "saved'; drop table applications;--"]) {
    it(`rejects stage ${JSON.stringify(forged)} and writes nothing`, async () => {
      const result = await addManualEntryAction(idle, form({ stage: forged }));
      expect(result.status).toBe("error");
      expect(result.message).toMatch(/stage/i);
      expect(state.inserts, "a row was inserted with a forged stage").toEqual([]);
    });
  }
});

describe("every real stage is accepted, from the one list", () => {
  for (const { key } of TRACKER_STAGES) {
    it(`inserts stage ${key}`, async () => {
      await addManualEntryAction(idle, form({ stage: key }));
      expect(state.inserts).toHaveLength(1);
      expect(state.inserts[0].stage).toBe(key);
      expect(state.inserts[0].source).toBe("manual");
      expect(state.inserts[0].job_posting_id).toBeNull();
      // saved has not been applied to yet; every other stage has.
      if (key === "saved") expect(state.inserts[0].applied_at).toBeNull();
      else expect(state.inserts[0].applied_at).toEqual(expect.any(String));
    });
  }

  it("falls back to saved when the field is absent (the form always sends one; a hand-made POST may not)", async () => {
    await addManualEntryAction(idle, form({ stage: null }));
    expect(state.inserts[0].stage).toBe("saved");
  });
});

describe("a manually added Hired entry is backfilled history, not a celebration", () => {
  it("sends no hired-moment email and does not redirect to the referral banner", async () => {
    await addManualEntryAction(idle, form({ stage: "hired" }));
    expect(state.inserts[0].stage).toBe("hired");
    expect(hiredEmail).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/tracker");
  });
});

describe("a database refusal is not reported as success", () => {
  it("returns an error (never throws into the error boundary) when the insert fails, without the raw database text, and does not revalidate as if it had landed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.insertError = { message: "violates check constraint" };
    const result = await addManualEntryAction(idle, form({ stage: "applied" }));
    expect(result.status).toBe("error");
    expect(result.message).toBe("Could not add that job. Nothing was saved; please try again.");
    expect(result.message).not.toContain("check constraint");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("violates check constraint"));
    expect(revalidatePath).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("a refused submission is a message in place and keeps what was typed (TRACKER-ADD-1)", () => {
  it("a blank company returns the message and every typed value, and writes nothing", async () => {
    const result = await addManualEntryAction(idle, form({ stage: "applied", companyName: "   ", title: "Engineer", location: "Lagos", url: "https://x.test/j", notes: "n" }));
    expect(result).toMatchObject({ status: "error", message: "Company and title are required." });
    expect(result.values).toMatchObject({ companyName: "   ", title: "Engineer", location: "Lagos", url: "https://x.test/j", notes: "n", stage: "applied" });
    expect(state.inserts).toEqual([]);
  });
  it("a saved entry says so and returns no values (the form starts clean)", async () => {
    const result = await addManualEntryAction(idle, form({ stage: "applied" }));
    expect(result).toEqual({ status: "success", message: "Added to your tracker." });
  });
});
