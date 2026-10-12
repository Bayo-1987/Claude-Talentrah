/**
 * RESUME-SAVE-1 (P3) and RESUME-SAVE-2 (P2). Save used to THROW on any problem, and a throw inside the editor's handler replaced the page with "This page couldn't load" (the edit lost); and when the
 * resume had been deleted elsewhere the update touched zero rows, nothing threw, and the editor claimed "Saved". Now a refusal is RETURNED so the editor keeps the page and the edit and says why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  updateResult: { data: [{ id: "r1" }] as Array<{ id: string }> | null, error: null as null | { message: string } },
  updates: [] as unknown[],
  filters: [] as Array<[string, unknown]>,
  revalidate: vi.fn(),
  completion: vi.fn(async () => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/resume-builder/start-events", () => ({ logResumeBuilderCompletion: h.completion, logResumeBuilderStartEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const b: Record<string, unknown> = {
        update: (u: unknown) => { h.updates.push(u); return b; },
        eq: (c: string, v: unknown) => { h.filters.push([c, v]); return b; },
        select: () => Promise.resolve(h.updateResult),
      };
      return b;
    },
  }),
}));

import { saveResumeAction } from "@/lib/resume-builder/actions";
import { EMPTY_RESUME } from "@/lib/resume/types";

beforeEach(() => {
  h.user = { id: "user-1" };
  h.updateResult = { data: [{ id: "r1" }], error: null };
  h.updates.length = 0;
  h.filters.length = 0;
  h.revalidate.mockClear();
  h.completion.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveResumeAction", () => {
  it("a normal save is ok, scoped to this resume AND this user, and revalidates", async () => {
    expect(await saveResumeAction("r1", EMPTY_RESUME, "My resume")).toEqual({ ok: true });
    expect(h.filters).toEqual([["id", "r1"], ["user_id", "user-1"]]);
    expect(h.revalidate).toHaveBeenCalledWith("/resume-builder");
    expect(h.completion).toHaveBeenCalled();
  });

  it("RESUME-SAVE-1: a resume deleted elsewhere (zero rows) is NOT reported as saved, and says why", async () => {
    h.updateResult = { data: [], error: null };
    const r = await saveResumeAction("r1", EMPTY_RESUME, "t");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/no longer exists|deleted/i);
    expect(h.revalidate).not.toHaveBeenCalled();
    expect(h.completion).not.toHaveBeenCalled();
  });

  it("RESUME-SAVE-2: an ended session is returned as a message, not thrown into the error boundary", async () => {
    h.user = null;
    const r = await saveResumeAction("r1", EMPTY_RESUME, "t");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/signed out|session has ended|sign in/i);
    expect(h.updates).toEqual([]);
  });

  it("a database error is a plain message with the raw text only in the log", async () => {
    h.updateResult = { data: null, error: { message: "permission denied for table resumes" } };
    const r = await saveResumeAction("r1", EMPTY_RESUME, "t");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).not.toContain("permission denied");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});
