/**
 * P6 (JOBS-POLISH-1): inviteOperatorAction on the origin it builds the link from. In production with the site URL unset (or pointing at localhost) it refuses BEFORE any email is sent and before
 * anything is written; with it set the link uses it; in development an unset URL still gives the local default. The helper's own rules are in invite-origin.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ invites: [] as Array<{ email: string; options: { redirectTo?: string } }>, rpcs: [] as string[], audits: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: vi.fn(async () => ({ adminId: "admin-1" })) }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: vi.fn(async () => { calls.audits += 1; }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, options: { redirectTo?: string }) => {
          calls.invites.push({ email, options });
          return { data: { user: { id: "user-1" } }, error: null };
        },
      },
    },
    rpc: async (name: string) => {
      calls.rpcs.push(name);
      return { data: [{ ok: true }], error: null };
    },
  }),
}));

import { inviteOperatorAction } from "@/lib/admin/operators/invite";

const form = () => {
  const f = new FormData();
  f.set("email", "New.Operator@example.test");
  f.set("displayName", "New Operator");
  f.set("roleId", "role-1");
  return f;
};
const run = () => inviteOperatorAction({ status: "idle" }, form());

beforeEach(() => {
  calls.invites.length = 0;
  calls.rpcs.length = 0;
  calls.audits = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("production", () => {
  it("POSITIVE CONTROL: with the site URL set, the link uses it and the invitation is sent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.talentrah.com");
    const out = await run();
    expect(out.status).toBe("success");
    expect(calls.invites).toEqual([{ email: "new.operator@example.test", options: { redirectTo: "https://www.talentrah.com/auth/callback?next=/reset-password" } }]);
  });

  it("with the site URL unset it refuses: no email is sent, nothing is written, and what was typed is kept", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const out = await run();
    expect(out).toMatchObject({ status: "error", message: "Site URL is not configured; the invite was not sent", targetId: "invite" });
    expect(out.values).toMatchObject({ email: "New.Operator@example.test", displayName: "New Operator", roleId: "role-1" });
    expect(calls.invites, "no email").toEqual([]);
    expect(calls.rpcs, "no operator row").toEqual([]);
    expect(calls.audits, "no audit entry for an invite that was not sent").toBe(0);
  });

  it("with the site URL on localhost it refuses the same way", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    const out = await run();
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/the invite was not sent$/);
    expect(calls.invites).toEqual([]);
    expect(calls.rpcs).toEqual([]);
  });
});

describe("development", () => {
  it("with the site URL unset the local default still works", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const out = await run();
    expect(out.status).toBe("success");
    expect(calls.invites[0].options.redirectTo).toBe("http://localhost:3000/auth/callback?next=/reset-password");
  });
});
