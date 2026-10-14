/**
 * createOrganizationAction's two refusals during onboarding ("Couldn't create the organisation", "Couldn't set you up as the owner") must not show the database's own message to the person.
 * The message is logged server-side with the ids, the typed values still come back, and the rollback still runs. The one error after the company exists keeps returning no values.
 * Supabase and the cache are faked; the action is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "founder@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" } as Record<string, unknown>,
  insertOrg: { data: { id: "org1" }, error: null } as { data: unknown; error: null | { message: string } },
  insertMember: { error: null } as { error: null | { message: string } },
  verifyError: null as null | { message: string; code?: string },
  deletes: [] as { table: string }[],
  deleteError: null as null | { message: string },
}));

function chain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => res(result()) : () => c) });
  return c;
}

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/embed/revalidate", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/embed/revalidate")>()), revalidateEmbed: vi.fn() }));
vi.mock("@/lib/employer/claim", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/employer/claim")>()), getClaimCandidates: async () => [] }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      if (table === "organizations") return { insert: () => chain(() => h.insertOrg) };
      return { insert: () => chain(() => h.insertMember) };
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => chain(() => ({ data: null, error: null })),
      update: () => chain(() => ({ error: h.verifyError })),
      delete: () => {
        h.deletes.push({ table });
        return chain(() => ({ error: h.deleteError }));
      },
    }),
  }),
}));

import { createOrganizationAction } from "@/lib/employer/actions";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const TYPED = { name: "Acme Ltd", domain: "acme.example", description: "We make things." };
const DB_TEXT_INSERT = 'new row violates row-level security policy for table "organizations" (code 42501)';
const DB_TEXT_MEMBER = 'insert or update on table "organization_members" violates foreign key constraint';

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.user = { id: "u1", email: "founder@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" };
  h.insertOrg = { data: { id: "org1" }, error: null };
  h.insertMember = { error: null };
  h.verifyError = null;
  h.deletes = [];
  h.deleteError = null;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

describe("the organisation insert is refused", () => {
  it("returns a plain sentence with the opening phrase and none of the database text, and keeps what was typed", async () => {
    h.insertOrg = { data: null, error: { message: DB_TEXT_INSERT } };
    const out = await createOrganizationAction(null, fd(TYPED));
    const error = out && "error" in out ? out.error : "";
    expect(error).toMatch(/^Couldn't create the organisation\./);
    expect(error).toContain("Please try again");
    expect(error).not.toContain("row-level security");
    expect(error).not.toContain("42501");
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("logs the database message with the user id, and never the typed values", async () => {
    h.insertOrg = { data: null, error: { message: DB_TEXT_INSERT } };
    await createOrganizationAction(null, fd(TYPED));
    expect(logged()).toContain(DB_TEXT_INSERT);
    expect(logged()).toContain("u1");
    expect(logged()).not.toContain("Acme");
    expect(logged()).not.toContain("acme.example");
  });
  it("a refusal with no error object still returns the plain sentence", async () => {
    h.insertOrg = { data: null, error: null };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/^Couldn't create the organisation\./);
  });
});

describe("the owner link is refused", () => {
  beforeEach(() => {
    h.insertMember = { error: { message: DB_TEXT_MEMBER } };
  });
  it("returns a plain sentence with the opening phrase and none of the database text, and keeps what was typed", async () => {
    const out = await createOrganizationAction(null, fd(TYPED));
    const error = out && "error" in out ? out.error : "";
    expect(error).toMatch(/^Couldn't set you up as the owner\./);
    expect(error).toContain("Please try again");
    expect(error).not.toContain("foreign key");
    expect(error).not.toContain("organization_members");
    expect(out && "error" in out && out.values).toEqual(TYPED);
  });
  it("logs the database message with the organisation id and the user id, and never the typed values", async () => {
    await createOrganizationAction(null, fd(TYPED));
    expect(logged()).toContain(DB_TEXT_MEMBER);
    expect(logged()).toContain("org1");
    expect(logged()).toContain("u1");
    expect(logged()).not.toContain("Acme");
    expect(logged()).not.toContain("acme.example");
  });
  it("still rolls the organisation back", async () => {
    await createOrganizationAction(null, fd(TYPED));
    expect(h.deletes).toEqual([{ table: "organizations" }]);
  });
  it("when the rollback itself fails, the message promises nothing about the company, and the failure is logged with the organisation id", async () => {
    h.deleteError = { message: "rollback refused" };
    const out = await createOrganizationAction(null, fd(TYPED));
    const error = out && "error" in out ? out.error : "";
    expect(error).toMatch(/^Couldn't set you up as the owner\. Please try again\.$/);
    expect(error).not.toMatch(/not kept|nothing was saved|removed|deleted/i);
    expect(out && "error" in out && out.values).toEqual(TYPED);
    expect(logged()).toContain("orphan cleanup failed for org org1");
    expect(logged()).toContain("rollback refused");
  });
});

describe("the error after the company exists", () => {
  it("'created, but verification didn't complete' still returns no values", async () => {
    h.verifyError = { message: "boom" };
    const out = await createOrganizationAction(null, fd(TYPED));
    expect(out && "error" in out && out.error).toMatch(/Organisation created, but verification didn't complete/);
    expect(out && "error" in out && out.values).toBeUndefined();
    expect(h.deletes).toEqual([]);
  });
});
