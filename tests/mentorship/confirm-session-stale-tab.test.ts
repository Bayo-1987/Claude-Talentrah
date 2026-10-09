/**
 * Confirming a mentor session from a stale second tab (QA MENTOR-CONFIRM-1, P3, money-adjacent).
 *
 * `mark_mentor_session_confirmed` moves a session awaiting_confirmation -> confirmed in one conditional UPDATE, so of two simultaneous confirms exactly one wins. The loser used to get `false`, and the action
 * THREW "Could not confirm that session.", which Next shows as "This page couldn't load" in place of the whole mentor page. It now RETURNS a state the row shows in place: "already confirmed" when the session
 * is this mentor's and is confirmed (or later), "no longer available" otherwise (cancelled, refunded, or not theirs: the same words, so nothing about another mentor's session is revealed).
 * NOT changed: the RPC and its arguments (the meeting link, the mentor id from the session), the notification (sent only after a real confirm), the revalidation. A database error is returned as a retryable message
 * instead of thrown. Fakes only: no database. Browser proof: QA's e2e/seeker-mentor-dashboard.spec.ts (the two-tab step).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  rpcResult: { data: true as boolean | null, error: null as { message: string } | null },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  sessionRow: null as { status: string; mentor_id: string } | null,
  notified: [] as string[],
}));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ user: { id: "mentor-1" } }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      world.rpcCalls.push({ name, args });
      return world.rpcResult;
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.sessionRow, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/mentorship/notifications", () => ({ notifySessionConfirmed: async (id: string) => void world.notified.push(id) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/paystack/client", () => ({ initializeTransaction: vi.fn(), NGN_CHANNELS: [] }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));

const { confirmMentorSessionAction } = await import("@/lib/mentorship/actions");
const { initialConfirmSessionState } = await import("@/lib/mentorship/confirm-state");

const form = (sessionId: string) => {
  const f = new FormData();
  f.set("sessionId", sessionId);
  return f;
};

beforeEach(() => {
  world.rpcResult = { data: true, error: null };
  world.rpcCalls = [];
  world.sessionRow = null;
  world.notified = [];
  revalidatePath.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the winner is unchanged", () => {
  it("one RPC with the session, the mentor from the session and a meeting link; the notification once; both pages revalidated", async () => {
    const out = await confirmMentorSessionAction(initialConfirmSessionState, form("s-1"));
    expect(out.status).toBe("confirmed");
    expect(world.rpcCalls).toHaveLength(1);
    expect(world.rpcCalls[0].name).toBe("mark_mentor_session_confirmed");
    expect(world.rpcCalls[0].args).toMatchObject({ p_session_id: "s-1", p_mentor_id: "mentor-1" });
    expect(String(world.rpcCalls[0].args.p_meeting_link)).toMatch(/^https:\/\//);
    expect(world.notified).toEqual(["s-1"]);
    expect(revalidatePath).toHaveBeenCalledWith("/mentorship/sessions/mentor");
    expect(revalidatePath).toHaveBeenCalledWith("/mentorship/sessions");
  });
});

describe("the loser of a two-tab confirm is told, not crashed", () => {
  it("the RPC says no and the session is this mentor's and confirmed: 'already confirmed', nothing notified", async () => {
    world.rpcResult = { data: false, error: null };
    world.sessionRow = { status: "confirmed", mentor_id: "mentor-1" };
    const out = await confirmMentorSessionAction(initialConfirmSessionState, form("s-1"));
    expect(out.status).toBe("already_confirmed");
    expect(out.message).toMatch(/already confirmed/i);
    expect(world.notified).toEqual([]);
  });
  it("a completed session of this mentor counts as already confirmed", async () => {
    world.rpcResult = { data: false, error: null };
    world.sessionRow = { status: "completed", mentor_id: "mentor-1" };
    expect((await confirmMentorSessionAction(initialConfirmSessionState, form("s-1"))).status).toBe("already_confirmed");
  });
  it("cancelled for lack of a confirmation: 'no longer available'", async () => {
    world.rpcResult = { data: false, error: null };
    world.sessionRow = { status: "cancelled_mentor_no_confirm", mentor_id: "mentor-1" };
    const out = await confirmMentorSessionAction(initialConfirmSessionState, form("s-1"));
    expect(out.status).toBe("unavailable");
    expect(out.message).toMatch(/no longer available/i);
  });
  it("someone else's session, or one that does not exist: the same 'no longer available', with nothing about it revealed", async () => {
    world.rpcResult = { data: false, error: null };
    world.sessionRow = { status: "confirmed", mentor_id: "another-mentor" };
    const theirs = await confirmMentorSessionAction(initialConfirmSessionState, form("s-2"));
    world.sessionRow = null;
    const missing = await confirmMentorSessionAction(initialConfirmSessionState, form("s-3"));
    expect(theirs).toEqual(missing);
    expect(theirs.status).toBe("unavailable");
    expect(world.notified).toEqual([]);
  });
  it("a database error: a retryable message, not a throw, nothing notified", async () => {
    world.rpcResult = { data: null, error: { message: "connection reset" } };
    const out = await confirmMentorSessionAction(initialConfirmSessionState, form("s-1"));
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/try again/i);
    expect(world.notified).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the page", () => {
  const page = readFileSync(path.join(__dirname, "../../src/app/(app)/mentorship/sessions/mentor/page.tsx"), "utf8").replace(/\s+/g, " ");
  it("each row's Confirm is the client form that shows the state in place; the page has no inline action that throws", () => {
    expect(page).toContain("<ConfirmSessionForm");
    expect(page).not.toContain("async function confirm(");
    expect(page).not.toContain("confirmMentorSessionAction(String(");
  });
});
