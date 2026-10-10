/**
 * FLAGS-1: an operator whose permission was revoked mid-session used to be bounced to /admin and told nothing.
 * requirePermission now leaves ?denied=<permission>, and the dashboard names the area. A still-permitted
 * operator, a hand-typed or stale link, and an unknown key all see nothing extra.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminIdentity, AdminPermission } from "@/lib/admin/session";

const state = vi.hoisted(() => ({ identity: null as AdminIdentity | null }));
vi.mock("@/lib/admin/session", () => ({ getAdminIdentity: vi.fn(async () => state.identity) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

import { requirePermission } from "@/lib/admin/require-admin";
import { PERMISSION_AREA_LABELS, deniedAreaLabel } from "@/lib/admin/permission-labels";
import AdminHomePage from "@/app/admin/(protected)/page";

const identity = (permissions: AdminPermission[]): AdminIdentity => ({
  sessionId: "s1", adminId: "a1", email: "op@talentrah.test", displayName: "Op",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), role: "standard", roleId: "r1", roleName: "Role", permissions,
});
const home = async (denied: string | string[] | undefined) =>
  renderToStaticMarkup(await AdminHomePage({ searchParams: Promise.resolve({ denied }) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the refusal says which area", () => {
  it("requirePermission sends a refused operator to /admin naming the permission", async () => {
    state.identity = identity(["blog"]);
    await expect(requirePermission("finance")).rejects.toThrow("NEXT_REDIRECT:/admin?denied=finance");
  });
  it("a permitted operator is not redirected", async () => {
    state.identity = identity(["finance"]);
    await expect(requirePermission("finance")).resolves.toMatchObject({ email: "op@talentrah.test" });
  });
});

describe("the dashboard", () => {
  it("revoked: shows 'You no longer have access to Finance' as an alert", async () => {
    state.identity = identity(["blog"]);
    const html = await home("finance");
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("You no longer have access to Finance.");
  });
  it("a still-permitted operator following the same link sees no message", async () => {
    state.identity = identity(["blog", "finance"]);
    expect(await home("finance")).not.toContain('role="alert"');
  });
  it("no ?denied: the page is unchanged", async () => {
    state.identity = identity(["blog"]);
    const html = await home(undefined);
    expect(html).not.toContain('role="alert"');
    expect(text(html)).toContain("Signed in as Op.");
  });
  it("an unknown or hostile value shows nothing and is never echoed", async () => {
    state.identity = identity(["blog"]);
    for (const v of ["nope", "<script>x</script>", "constructor", "__proto__", ["finance", "blog"]]) {
      const html = await home(v as string);
      expect(html, String(v)).not.toContain('role="alert"');
      expect(html, String(v)).not.toContain("<script>x");
    }
  });
});

describe("every permission has an area name", () => {
  it("deniedAreaLabel resolves each key it knows", () => {
    for (const [k, label] of Object.entries(PERMISSION_AREA_LABELS)) expect(deniedAreaLabel(k, [])).toBe(label);
  });
});
