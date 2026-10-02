/**
 * ACCT-1 PR 1 — the Server Actions behind "Delete account".
 *
 * The database functions decide (tests/rls/account-deletion-flow.test.ts); these tests pin what the ACTIONS are responsible for, with the
 * database and the mail provider faked so every call is visible:
 *
 *   request   the typed phrase is required; the id sent to the database is the SESSION's; what is stored is the sha256 of the token and the
 *             raw token goes only into the emailed link; a blocked person gets the reasons and NO email; the send is checked.
 *   confirm   the id is again the SESSION's, never a value from the form (so a link opened in another person's session cannot act for the
 *             link's owner); every refusal reason reads as a distinct, honest message; and "sign out everywhere" happens only after the
 *             database says the deletion is scheduled.
 *   restore   puts back visibility through the person's own client, and "keep the deletion" signs out.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-A" } as { id: string } | null,
  profile: { email: "ada@example.com", first_name: "Ada", credits_balance: 12 } as Record<string, unknown> | null,
  serviceRpc: vi.fn(),
  userRpc: vi.fn(),
  signOut: vi.fn(),
  send: vi.fn(),
  resend: { emails: { send: undefined as unknown } } as { emails: { send: unknown } } | null,
  redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }), signOut: h.signOut },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.profile, error: null }) }) }) }),
    rpc: h.userRpc,
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: h.serviceRpc }) }));
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => h.resend }));

import {
  confirmAccountDeletionAction,
  keepDeletionAction,
  requestAccountDeletionAction,
  restoreAccountAction,
} from "@/lib/account-deletion/actions";
import { initialConfirmState, initialRequestState } from "@/lib/account-deletion/state";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const sentEmail = () => h.send.mock.calls[0][0] as { to: string; subject: string; text: string; html: string };
const tokenFromEmail = () => /confirm\?token=([0-9a-f]{64})/.exec(sentEmail().text)![1];
const NO_BLOCKERS = { mentorship_sessions: [], mentor_payouts: [], organisations_with_other_members: [], postings_to_close: [], campaigns_to_pause: 0, blocked: false };

beforeEach(() => {
  h.user = { id: "user-A" };
  h.profile = { email: "ada@example.com", first_name: "Ada", credits_balance: 12 };
  h.serviceRpc.mockReset().mockResolvedValue({ data: { ok: true, expires_at: "2026-10-02T13:00:00Z", blockers: NO_BLOCKERS }, error: null });
  h.userRpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.send.mockReset().mockResolvedValue({ data: { id: "m1" }, error: null });
  h.resend = { emails: { send: h.send } };
  h.redirects.length = 0;
});

describe("requestAccountDeletionAction", () => {
  const ask = (confirmation = "delete my account") => requestAccountDeletionAction(initialRequestState, form({ confirmation }));

  it("refuses without the typed phrase: nothing is stored, nothing is sent", async () => {
    const s = await ask("delete");
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/delete my account/i);
    expect(h.serviceRpc).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    h.user = null;
    const s = await ask();
    expect(s.status).toBe("error");
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });

  it("stores the sha256 of the token for the SESSION's user and emails the raw token only inside the link", async () => {
    const s = await ask();
    expect(s.status).toBe("sent");
    const [name, args] = h.serviceRpc.mock.calls[0];
    expect(name).toBe("account_deletion_create_request");
    expect(args.p_user_id).toBe("user-A");
    const token = tokenFromEmail();
    expect(args.p_token_hash).toBe(sha(token));
    expect(JSON.stringify(h.serviceRpc.mock.calls)).not.toContain(token);
    expect(JSON.stringify(s)).not.toContain(token);
    expect(sentEmail().to).toBe("ada@example.com");
  });

  it("the email says what happens: one hour, 30 days, the credits forfeited, and that nothing happens if it was not them", async () => {
    await ask();
    const { text, html, subject } = sentEmail();
    expect(subject).toMatch(/confirm/i);
    for (const body of [text, html]) {
      expect(body).toMatch(/1 hour/i);
      expect(body).toMatch(/30 days/i);
      expect(body).toMatch(/12 credits/i);
      expect(body).toMatch(/forfeit/i);
      expect(body).toMatch(/not you|didn.t ask|ignore/i);
    }
    expect(text).toMatch(/https:\/\/[^ ]+\/settings\/delete-account\/confirm\?token=[0-9a-f]{64}/);
  });

  it("lists the postings that will be closed, by title, when the person is the only member of an organisation", async () => {
    h.serviceRpc.mockResolvedValue({
      data: { ok: true, expires_at: "2026-10-02T13:00:00Z", blockers: { ...NO_BLOCKERS, postings_to_close: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }] } },
      error: null,
    });
    await ask();
    expect(sentEmail().text).toContain("Staff Engineer");
    expect(sentEmail().html).toContain("Staff Engineer");
  });

  it("a blocked person gets the reasons and NO email", async () => {
    const blockers = { ...NO_BLOCKERS, blocked: true, mentorship_sessions: [{ id: "s1", role: "mentor", session_type: "mock_interview", scheduled_start: "2026-10-09T10:00:00Z", status: "confirmed" }] };
    h.serviceRpc.mockResolvedValue({ data: { ok: false, reason: "blocked", blockers }, error: null });
    const s = await ask();
    expect(s.status).toBe("blocked");
    expect(s.blockers?.mentorship_sessions).toHaveLength(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", /too many|try again later|hour/i],
    ["already_scheduled", /already scheduled/i],
  ])("%s reads as its own message and sends nothing", async (reason, pattern) => {
    h.serviceRpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    const s = await ask();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(pattern);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a database error is reported, not swallowed, and nothing is sent", async () => {
    h.serviceRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const s = await ask();
    expect(s.status).toBe("error");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("with no mail provider configured it says so instead of pretending the link was sent", async () => {
    h.resend = null;
    const s = await ask();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/email/i);
  });

  it("a send the provider refuses is an error, not 'sent'", async () => {
    h.send.mockResolvedValue({ data: null, error: { message: "rejected" } });
    const s = await ask();
    expect(s.status).toBe("error");
  });
});

describe("confirmAccountDeletionAction", () => {
  const token = "ab".repeat(32);
  const confirm = (fields: Record<string, string> = { token }) => confirmAccountDeletionAction(initialConfirmState, form(fields));

  it("refuses a malformed token before it reaches the database", async () => {
    const s = await confirm({ token: "nope" });
    expect(s.status).toBe("error");
    expect(s.reason).toBe("invalid");
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    h.user = null;
    const s = await confirm();
    expect(s.reason).toBe("signed_out");
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });

  it("sends the hash and the SESSION's id; an id smuggled in the form is ignored (another person's session cannot confirm for the link's owner)", async () => {
    h.user = { id: "user-B" };
    h.serviceRpc.mockResolvedValue({ data: { ok: false, reason: "invalid" }, error: null });
    await confirm({ token, userId: "user-A", p_user_id: "user-A" });
    const [name, args] = h.serviceRpc.mock.calls[0];
    expect(name).toBe("account_deletion_confirm");
    expect(args).toEqual({ p_user_id: "user-B", p_token_hash: sha(token) });
  });

  it.each([
    ["invalid", /not valid|isn.t valid/i],
    ["used", /already been used/i],
    ["expired", /expired/i],
    ["already_scheduled", /already scheduled/i],
  ])("%s has its own honest message and does NOT sign anyone out", async (reason, pattern) => {
    h.serviceRpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    const s = await confirm();
    expect(s.status).toBe("error");
    expect(s.reason).toBe(reason);
    expect(s.error).toMatch(pattern);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("blocked at the moment of confirming reports the blockers and does not sign out", async () => {
    const blockers = { ...NO_BLOCKERS, blocked: true, mentor_payouts: [{ id: "p1", amount_ngn: 5000, status: "pending" }] };
    h.serviceRpc.mockResolvedValue({ data: { ok: false, reason: "blocked", blockers }, error: null });
    const s = await confirm();
    expect(s.reason).toBe("blocked");
    expect(s.blockers?.mentor_payouts).toHaveLength(1);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("on success signs the person out EVERYWHERE, after the database said so, and returns what happened", async () => {
    const order: string[] = [];
    h.serviceRpc.mockImplementation(async () => {
      order.push("rpc");
      return { data: { ok: true, hard_delete_after: "2026-11-01T12:00:00Z", credits_forfeited: 12, closed_postings: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }] }, error: null };
    });
    h.signOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });
    const s = await confirm();
    expect(order).toEqual(["rpc", "signOut"]);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(s.status).toBe("done");
    expect(s.hardDeleteAfter).toBe("2026-11-01T12:00:00Z");
    expect(s.creditsForfeited).toBe(12);
    expect(s.closedPostings).toEqual([{ id: "p1", title: "Staff Engineer", organization: "Acme" }]);
  });

  it("a failing sign-out does not turn a scheduled deletion into an error", async () => {
    h.serviceRpc.mockResolvedValue({ data: { ok: true, hard_delete_after: "2026-11-01T12:00:00Z", credits_forfeited: 0, closed_postings: [] }, error: null });
    h.signOut.mockResolvedValue({ error: { message: "network" } });
    const s = await confirm();
    expect(s.status).toBe("done");
  });

  it("a database error leaves the person signed in and says so", async () => {
    h.serviceRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const s = await confirm();
    expect(s.status).toBe("error");
    expect(h.signOut).not.toHaveBeenCalled();
  });
});

describe("restoreAccountAction and keepDeletionAction", () => {
  it("restore calls the person's OWN client (auth.uid() decides who), never the service role, then goes to the app", async () => {
    await expect(restoreAccountAction()).rejects.toThrow("NEXT_REDIRECT:/jobs");
    expect(h.userRpc).toHaveBeenCalledWith("account_deletion_restore");
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });

  it("restore reports a closed window instead of pretending", async () => {
    h.userRpc.mockResolvedValue({ data: { ok: false, reason: "window_closed" }, error: null });
    await expect(restoreAccountAction()).rejects.toThrow(/NEXT_REDIRECT:\/settings\/account-deletion\?error=window_closed/);
  });

  it("restore with no session sends the person to sign in", async () => {
    h.user = null;
    await expect(restoreAccountAction()).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    expect(h.userRpc).not.toHaveBeenCalled();
  });

  it("keeping the deletion signs out and goes to the home page, changing nothing", async () => {
    await expect(keepDeletionAction()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(h.signOut).toHaveBeenCalled();
    expect(h.userRpc).not.toHaveBeenCalled();
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });
});
