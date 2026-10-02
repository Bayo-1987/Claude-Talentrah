/**
 * ACCT-1 PR 1 — a person whose account is scheduled for deletion lands on the "restore it, or keep the deletion?" prompt, not silently back in.
 *
 * `requireUser()` is the gate under every protected page (and `requireEmployer()` calls it), so the redirect lives there: a signed-in user whose
 * profile carries `deletion_requested_at` is sent to /settings/account-deletion, except on the page that IS that prompt (and the confirm page),
 * which ask for `{ allowPendingDeletion: true }`. Everyone else is untouched. This is the experience layer only: the hiding and the mail stop
 * are enforced in the database (tests/rls/account-deletion-hide.test.ts), so a direct API call by a pending user does not bypass them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", email: "ada@example.com" } as { id: string; email: string } | null,
  profile: { id: "u1", email: "ada@example.com", deletion_requested_at: null } as Record<string, unknown> | null,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.profile }) }) }) }),
  }),
}));

import { PENDING_DELETION_PATH, requireUser } from "@/lib/auth/require-user";

beforeEach(() => {
  h.user = { id: "u1", email: "ada@example.com" };
  h.profile = { id: "u1", email: "ada@example.com", deletion_requested_at: null };
});

describe("requireUser and accounts scheduled for deletion", () => {
  it("the prompt lives at /settings/account-deletion", () => {
    expect(PENDING_DELETION_PATH).toBe("/settings/account-deletion");
  });

  it("a normal signed-in user gets their session", async () => {
    const s = await requireUser();
    expect(s.user.id).toBe("u1");
  });

  it("a user scheduled for deletion is redirected to the prompt", async () => {
    h.profile = { ...h.profile, deletion_requested_at: "2026-10-02T12:00:00Z" };
    await expect(requireUser()).rejects.toThrow(`NEXT_REDIRECT:${PENDING_DELETION_PATH}`);
  });

  it("the prompt itself (and the confirm page) can ask to see a pending user", async () => {
    h.profile = { ...h.profile, deletion_requested_at: "2026-10-02T12:00:00Z" };
    const s = await requireUser({ allowPendingDeletion: true });
    expect(s.profile.deletion_requested_at).toBe("2026-10-02T12:00:00Z");
  });

  it("signed out still goes to /login, pending or not", async () => {
    h.user = null;
    await expect(requireUser()).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    await expect(requireUser({ allowPendingDeletion: true })).rejects.toThrow(/NEXT_REDIRECT:\/login/);
  });

  it("a restored account (flag cleared) is a normal account again", async () => {
    h.profile = { ...h.profile, deletion_requested_at: null };
    await expect(requireUser()).resolves.toBeTruthy();
  });
});
