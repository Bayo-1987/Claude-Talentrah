/**
 * What the two employer actions hand back with an error (QA ONBOARD-KEEP-1, CAC-KEEP-1). The form uses the returned values as its fields' defaults, so an error that returns none empties the form.
 *
 *   createOrganizationAction: every refusal BEFORE a company exists returns the typed name, domain and description. The one error AFTER the company exists ("Organisation created, but verification didn't
 *     complete") returns none, on purpose: the company is there, and a form primed to be sent again would create a second one.
 *   submitCacVerificationAction: both errors return the typed RC number and business name; a success returns none.
 * Supabase, the membership check and the cache are faked; the actions are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "founder@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" } as Record<string, unknown>,
  taken: null as null | { id: string; name: string },
  insertOrg: { data: { id: "org1" }, error: null } as { data: unknown; error: null | { message: string } },
  insertMember: { error: null } as { error: null | { message: string } },
  verifyError: null as null | { message: string; code?: string },
  updateError: null as null | { message: string },
}));

function chain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => res(result()) : () => c) });
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/embed/revalidate", () => ({ revalidateEmbed: vi.fn() }));
vi.mock("@/lib/employer/claim", () => ({ getClaimCandidates: async () => [] }));
vi.mock("@/lib/employer/membership", () => ({ requireEmployer: async () => ({ organization: { id: "org1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      if (table === "organizations") return { insert: () => chain(() => h.insertOrg), update: () => chain(() => ({ error: h.updateError })) };
      return { insert: () => chain(() => h.insertMember) };
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => chain(() => ({ data: h.taken, error: null })),
      update: () => chain(() => ({ error: h.verifyError })),
      delete: () => chain(() => ({ error: null })),
    }),
  }),
}));

import { createOrganizationAction, submitCacVerificationAction } from "@/lib/employer/actions";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const TYPED = { name: "  Acme  Ltd ", domain: "acme.example", description: "We make things.\nTwo sentences." };

beforeEach(() => {
  h.user = { id: "u1", email: "founder@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" };
  h.taken = null;
  h.insertOrg = { data: { id: "org1" }, error: null };
  h.insertMember = { error: null };
  h.verifyError = null;
  h.updateError = null;
});

describe("createOrganizationAction: the typed values come back with every refusal before a company exists", () => {
  it("name missing", async () => {
    const out = await createOrganizationAction(null, fd({ ...TYPED, name: "" }));
    expect(out).toEqual({ error: "Company name is required.", values: { name: "", domain: "acme.example", description: TYPED.description } });
  });
  it("the domain already belongs to a verified company", async () => {
    h.taken = { id: "o9", name: "Acme Holdings" };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/is already registered on acme\.example/);
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("the insert is refused", async () => {
    h.insertOrg = { data: null, error: { message: "permission denied" } };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/Couldn't create the organisation/);
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("the owner link is refused", async () => {
    h.insertMember = { error: { message: "nope" } };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/Couldn't set you up as the owner/);
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("someone else verified the domain while the form was open (the company is rolled back)", async () => {
    h.verifyError = { message: "duplicate key", code: "23505" };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/registered your company while you were filling this in/);
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("the values are exactly as typed: not trimmed, newlines kept", async () => {
    const out = await createOrganizationAction(null, fd({ ...TYPED, name: "" }));
    expect(out && "error" in out && out.values?.description).toBe("We make things.\nTwo sentences.");
  });
});

describe("createOrganizationAction: no values once the company exists", () => {
  it("'created, but verification didn't complete' hands none back, so the form is not primed to create it twice", async () => {
    h.verifyError = { message: "boom" };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/Organisation created, but verification didn't complete/);
    expect(out && "error" in out && out.values).toBeUndefined();
  });
});

describe("submitCacVerificationAction", () => {
  it("a blank RC number hands the typed business name (and the blank number) back", async () => {
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "", cacBusinessName: "Acme Nigeria Ltd" }));
    expect(out).toEqual({ error: "Both the RC number and the registered business name are required.", values: { cacNumber: "", cacBusinessName: "Acme Nigeria Ltd" } });
  });
  it("a blank business name hands the typed RC number back", async () => {
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "RC1234567", cacBusinessName: "  " }));
    expect(out && "error" in out && out.values).toEqual({ cacNumber: "RC1234567", cacBusinessName: "  " });
  });
  it("a refused write hands both back", async () => {
    h.updateError = { message: "permission denied" };
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" }));
    expect(out && "error" in out && out.error).toMatch(/Couldn't submit for verification/);
    expect(out && "error" in out && out.values).toEqual({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" });
  });
  it("a success hands none back", async () => {
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" }));
    expect(out).toEqual({ ok: true });
  });
});
