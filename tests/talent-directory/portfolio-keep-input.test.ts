/**
 * Work samples on /talent-directory/verify (QA SAMPLE-KEEP-1, P3): a refused sample (a blank title) wiped the description and the link the person had typed, because React 19 resets a `<form action>` and
 * the action returned only a message. The action now hands the three typed fields back with every error (src/lib/forms/keep-input.ts) and the form uses them as defaults; a success hands none, so the
 * next sample starts clean. Fakes only: no database is touched. Browser proof: QA's e2e/seeker-talent-directory-candidate.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ insertError: null as { message: string } | null, inserts: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/employer/membership", () => ({ requireEmployer: vi.fn() }));
vi.mock("@/lib/talent-directory/verification-runner", () => ({ runTalentVerification: vi.fn(), runTalentVerificationHumanReview: vi.fn() }));
vi.mock("@/lib/talent-directory/boost-runner", () => ({ runTalentDirectoryBoostPurchase: vi.fn() }));
vi.mock("@/lib/talent-directory/contact-runner", () => ({ runTalentDirectoryContactRequest: vi.fn(), runTalentDirectoryContactResponse: vi.fn() }));

const { addPortfolioItemAction } = await import("@/lib/talent-directory/actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
type Result = { status: string; message: string; values?: Record<string, string> };

beforeEach(() => {
  state.insertError = null;
  state.inserts = [];
});

describe("addPortfolioItemAction hands the typed fields back with every error", () => {
  it("a blank title: refused, nothing inserted, and the description and link come back as typed", async () => {
    const out = (await addPortfolioItemAction(null, form({ title: "   ", description: "typed with a blank title", url: "https://example.test/three" }))) as Result;
    expect(out.status).toBe("error");
    expect(out.message).toBe("A title is required.");
    expect(state.inserts).toEqual([]);
    expect(out.values).toEqual({ title: "   ", description: "typed with a blank title", url: "https://example.test/three" });
  });
  it("a database error: the same three fields come back", async () => {
    state.insertError = { message: "boom" };
    const out = (await addPortfolioItemAction(null, form({ title: "Redesigned onboarding", description: "d", url: "https://e.test" }))) as Result;
    expect(out.status).toBe("error");
    expect(out.values).toEqual({ title: "Redesigned onboarding", description: "d", url: "https://e.test" });
  });
  it("a success hands back none, so the next sample starts clean", async () => {
    const out = (await addPortfolioItemAction(null, form({ title: "Redesigned onboarding", description: "d", url: "https://e.test" }))) as Result;
    expect(out).toMatchObject({ status: "success", message: "Added." });
    expect(out.values).toBeUndefined();
    expect(state.inserts).toHaveLength(1);
  });
});

describe("the form", () => {
  const source = readFileSync(path.join(__dirname, "../../src/app/(app)/talent-directory/verify/portfolio-manager.tsx"), "utf8").replace(/\s+/g, " ");
  it("the title, link and description take the returned values as their defaults", () => {
    for (const f of ["title", "url", "description"]) expect(source, f).toContain(`inputValue(state.values, "${f}")`);
  });
});
