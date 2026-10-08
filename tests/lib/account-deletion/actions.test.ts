/**
 * ACCT-1 PR 1 — the Server Actions behind "Delete account".
 *
 * The database functions decide (tests/rls/account-deletion-flow.test.ts); these tests pin what the ACTIONS are responsible for, with the
 * database, the card provider and the mail provider faked so every call is visible:
 *
 *   request   the typed phrase is required; the id sent to the database is the SESSION's; what is stored is the sha256 of the token and the
 *             raw token goes only into the emailed link; a blocked person gets the reasons and NO email; the send is checked.
 *   confirm   the id is again the SESSION's, never a value from the form; every refusal reason reads as a distinct, honest message;
 *             THE CARD COMES FIRST: a stored card authorisation is cancelled at the payment provider before anything is scheduled, and if that
 *             fails nothing is scheduled; "sign out everywhere" happens only after the database says the deletion is scheduled, and its
 *             failure changes nothing (the proxy gate catches every later request).
 *   partial    the card is cancelled FIRST, so if the provider succeeds and the database transaction then fails, the person is left with a cancelled card
 *             and no deletion: renewal is switched off in its own small write and they are told so plainly, never left with a Pass that lapses unexplained.
 *   gate flag  confirm sets `app_metadata.deletion_pending` (what the proxy gate reads without a database query) and restore clears it, alongside the
 *             database flag, which stays the source of truth. A failed write is loud (FAIL_OPEN), never a failed deletion.
 *   emails    the deletion's own emails (confirm link, "scheduled", "restored") go through the lifecycle sender, which is the only way past
 *             the deleted-pending mail guard.
 *   restore   puts back visibility through the person's own client, and "keep the deletion" signs out.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-A", email: "ada@example.com" } as { id: string; email: string } | null,
  profile: { email: "ada@example.com", first_name: "Ada", credits_balance: 12 } as Record<string, unknown> | null,
  serviceRpc: vi.fn(),
  userRpc: vi.fn(),
  signOut: vi.fn(),
  lifecycle: vi.fn(),
  deactivate: vi.fn(),
  updateUser: vi.fn(),
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
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: h.serviceRpc, auth: { admin: { updateUserById: h.updateUser } } }),
}));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), sendDeletionLifecycleEmail: h.lifecycle }));
vi.mock("@/lib/paystack/client", () => ({
  deactivateAuthorization: h.deactivate,
  PaystackDeclineError: class extends Error {
    readonly kind = "decline" as const;
  },
}));

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
const lastLifecycle = () => h.lifecycle.mock.calls.at(-1) as [string, { to: string; subject: string; text: string; html: string }];
const tokenFromEmail = () => /confirm\?token=([0-9a-f]{64})/.exec(lastLifecycle()[1].text)![1];
const NO_BLOCKERS = { mentorship_sessions: [], mentor_payouts: [], organisations_with_other_members: [], postings_to_close: [], campaigns_to_pause: 0, ad_wallet_balance_ngn: 0, blocked: false };
const OK_CONFIRM = { ok: true, hard_delete_after: "2026-11-01T12:00:00Z", credits_forfeited: 12, closed_postings: [], ad_wallet_balance_ngn: 0 };

/** The service client answers by function name, so each test says only what it cares about. */
function serviceAnswers(over: Partial<Record<string, unknown>> = {}) {
  const answers: Record<string, unknown> = {
    account_deletion_create_request: { ok: true, expires_at: "2026-10-02T13:00:00Z", blockers: NO_BLOCKERS },
    account_deletion_confirm_precheck: { ok: true, authorizations: [] },
    account_deletion_confirm: OK_CONFIRM,
    account_deletion_stop_renewals: { ok: true, passes: 1, subscriptions: 0 },
    ...over,
  };
  h.serviceRpc.mockImplementation(async (name: string) => {
    const a = answers[name];
    if (a instanceof Error) return { data: null, error: { message: a.message } };
    return { data: a, error: null };
  });
}

beforeEach(() => {
  h.user = { id: "user-A", email: "ada@example.com" };
  h.profile = { email: "ada@example.com", first_name: "Ada", credits_balance: 12 };
  h.serviceRpc.mockReset();
  serviceAnswers();
  h.userRpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.lifecycle.mockReset().mockResolvedValue({ data: { id: "m1" }, error: null });
  h.deactivate.mockReset().mockResolvedValue({ status: true });
  h.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  h.redirects.length = 0;
});

describe("requestAccountDeletionAction", () => {
  const ask = (confirmation = "delete my account") => requestAccountDeletionAction(initialRequestState, form({ confirmation }));

  it("refuses without the typed phrase: nothing is stored, nothing is sent", async () => {
    const s = await ask("delete");
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/delete my account/i);
    expect(h.serviceRpc).not.toHaveBeenCalled();
    expect(h.lifecycle).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    h.user = null;
    const s = await ask();
    expect(s.status).toBe("error");
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });

  it("stores the sha256 of the token for the SESSION's user and emails the raw token only inside the link, as the 'deletion_confirm' lifecycle email", async () => {
    const s = await ask();
    expect(s.status).toBe("sent");
    const [name, args] = h.serviceRpc.mock.calls[0];
    expect(name).toBe("account_deletion_create_request");
    expect(args.p_user_id).toBe("user-A");
    const token = tokenFromEmail();
    expect(args.p_token_hash).toBe(sha(token));
    expect(JSON.stringify(h.serviceRpc.mock.calls)).not.toContain(token);
    expect(JSON.stringify(s)).not.toContain(token);
    expect(lastLifecycle()[0]).toBe("deletion_confirm");
    expect(lastLifecycle()[1].to).toBe("ada@example.com");
  });

  it("the email says what happens: one hour, 30 days, the credits forfeited, and that nothing happens if it was not them", async () => {
    await ask();
    const { text, html, subject } = lastLifecycle()[1];
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

  it("for the only member of an organisation the email lists the REAL postings by title, says they are closed now and removed 30 days after closing, and gives the ad balance", async () => {
    serviceAnswers({
      account_deletion_create_request: {
        ok: true,
        expires_at: "2026-10-02T13:00:00Z",
        blockers: { ...NO_BLOCKERS, ad_wallet_balance_ngn: 4500, postings_to_close: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }, { id: "p2", title: "Product Designer", organization: "Acme" }] },
      },
    });
    await ask();
    for (const body of [lastLifecycle()[1].text, lastLifecycle()[1].html]) {
      expect(body).toContain("Staff Engineer");
      expect(body).toContain("Product Designer");
      expect(body).toContain("These postings will be closed now and permanently removed 30 days after closing.");
      expect(body).toMatch(/Restoring your account won.t reopen them/);
      expect(body).toMatch(/4,500/);
    }
  });

  it("a blocked person gets the reasons and NO email", async () => {
    const blockers = { ...NO_BLOCKERS, blocked: true, mentorship_sessions: [{ id: "s1", role: "mentor", session_type: "mock_interview", scheduled_start: "2026-10-09T10:00:00Z", status: "confirmed" }] };
    serviceAnswers({ account_deletion_create_request: { ok: false, reason: "blocked", blockers } });
    const s = await ask();
    expect(s.status).toBe("blocked");
    expect(s.blockers?.mentorship_sessions).toHaveLength(1);
    expect(h.lifecycle).not.toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", /too many|try again later|hour/i],
    ["already_scheduled", /already scheduled/i],
  ])("%s reads as its own message and sends nothing", async (reason, pattern) => {
    serviceAnswers({ account_deletion_create_request: { ok: false, reason } });
    const s = await ask();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(pattern);
    expect(h.lifecycle).not.toHaveBeenCalled();
  });

  it("a database error is reported, not swallowed, and nothing is sent", async () => {
    serviceAnswers({ account_deletion_create_request: new Error("boom") });
    const s = await ask();
    expect(s.status).toBe("error");
    expect(h.lifecycle).not.toHaveBeenCalled();
  });

  it("a send the provider refuses is an error, not 'sent'", async () => {
    h.lifecycle.mockResolvedValue({ data: null, error: { message: "rejected" } });
    const s = await ask();
    expect(s.status).toBe("error");
  });

  it("with no mail provider configured it says so instead of pretending the link was sent", async () => {
    h.lifecycle.mockResolvedValue({ data: null, error: { message: "RESEND_API_KEY is not set", name: "not_configured" } });
    const s = await ask();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/email/i);
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

  it("sends the hash and the SESSION's id to the precheck AND the confirm; an id smuggled in the form is ignored", async () => {
    h.user = { id: "user-B", email: "bo@example.com" };
    await confirm({ token, userId: "user-A", p_user_id: "user-A" });
    const names = h.serviceRpc.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["account_deletion_confirm_precheck", "account_deletion_confirm"]);
    for (const [, args] of h.serviceRpc.mock.calls) expect(args).toEqual({ p_user_id: "user-B", p_token_hash: sha(token) });
  });

  it.each([
    ["invalid", /not valid|isn.t valid/i],
    ["used", /already been used/i],
    ["superseded", /newer confirmation email/i],
    ["expired", /expired/i],
    ["already_scheduled", /already scheduled/i],
  ])("%s has its own honest message (from the precheck) and does NOT sign anyone out or touch the card", async (reason, pattern) => {
    serviceAnswers({ account_deletion_confirm_precheck: { ok: false, reason } });
    const s = await confirm();
    expect(s.status).toBe("error");
    expect(s.reason).toBe(reason);
    expect(s.error).toMatch(pattern);
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.deactivate).not.toHaveBeenCalled();
    expect(h.serviceRpc.mock.calls.map((c) => c[0])).toEqual(["account_deletion_confirm_precheck"]);
  });

  it("a reason that appears only at the confirm (the link was used in the instant between) reads the same way", async () => {
    serviceAnswers({ account_deletion_confirm: { ok: false, reason: "used" } });
    const s = await confirm();
    expect(s.reason).toBe("used");
    expect(s.error).toMatch(/already been used/i);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("blocked reports the blockers and does not sign out", async () => {
    const blockers = { ...NO_BLOCKERS, blocked: true, mentor_payouts: [{ id: "p1", amount_ngn: 5000, status: "pending" }] };
    serviceAnswers({ account_deletion_confirm_precheck: { ok: false, reason: "blocked", blockers } });
    const s = await confirm();
    expect(s.reason).toBe("blocked");
    expect(s.blockers?.mentor_payouts).toHaveLength(1);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  describe("the card comes first", () => {
    const auths = [
      { source: "pass", id: "up1", authorization_code: "AUTH_pass_1" },
      { source: "talent_directory", id: "td1", authorization_code: "AUTH_td_1" },
    ];

    it("each stored authorisation is cancelled at the payment provider BEFORE the deletion is scheduled", async () => {
      const order: string[] = [];
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths } });
      h.deactivate.mockImplementation(async (code: string) => (order.push(`deactivate:${code}`), { status: true }));
      h.serviceRpc.mockImplementation(async (name: string) => {
        order.push(name);
        return { data: name === "account_deletion_confirm_precheck" ? { ok: true, authorizations: auths } : OK_CONFIRM, error: null };
      });
      const s = await confirm();
      expect(s.status).toBe("done");
      expect(order).toEqual(["account_deletion_confirm_precheck", "deactivate:AUTH_pass_1", "deactivate:AUTH_td_1", "account_deletion_confirm"]);
    });

    it("the same card on a Pass and a subscription is cancelled once", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: [auths[0], { ...auths[1], authorization_code: "AUTH_pass_1" }] } });
      await confirm();
      expect(h.deactivate).toHaveBeenCalledTimes(1);
    });

    it("no stored card, no provider call", async () => {
      await confirm();
      expect(h.deactivate).not.toHaveBeenCalled();
    });

    it("if the provider cancellation FAILS, nothing is scheduled, nobody is signed out, and the person is told why", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths } });
      h.deactivate.mockRejectedValue(new Error("Paystack unavailable"));
      const s = await confirm();
      expect(s.status).toBe("error");
      expect(s.reason).toBe("card");
      expect(s.error).toMatch(/payment provider/i);
      expect(s.error).toMatch(/nothing has been scheduled/i);
      expect(h.serviceRpc.mock.calls.map((c) => c[0])).not.toContain("account_deletion_confirm");
      expect(h.signOut).not.toHaveBeenCalled();
      expect(h.lifecycle).not.toHaveBeenCalled();
    });

    it("stops at the FIRST failure: later cards are not touched once one cannot be cancelled", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths } });
      h.deactivate.mockRejectedValueOnce(new Error("down"));
      await confirm();
      expect(h.deactivate).toHaveBeenCalledTimes(1);
    });

    it("a card Paystack answers 404 + its error envelope for (unknown or already deactivated) counts as cancelled", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: [auths[0]] } });
      h.deactivate.mockRejectedValue(Object.assign(new Error("any words"), { kind: "decline", status: 404, type: "api_error", code: "resource_not_found" }));
      const s = await confirm();
      expect(s.status).toBe("done");
    });

    it("the same friendly words WITHOUT the documented status and envelope block the deletion (the message is never read)", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: [auths[0]] } });
      h.deactivate.mockRejectedValue(Object.assign(new Error("Authorization is already deactivated"), { kind: "decline" }));
      const s = await confirm();
      expect(s.status).toBe("error");
      expect(s.reason).toBe("card");
      expect(h.serviceRpc.mock.calls.map((c) => c[0])).not.toContain("account_deletion_confirm");
    });

    it("a provider refusal that is not the documented not-found blocks the deletion too", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: [auths[0]] } });
      h.deactivate.mockRejectedValue(Object.assign(new Error("Invalid key"), { kind: "decline", status: 401, type: "validation_error", code: "invalid_key" }));
      const s = await confirm();
      expect(s.status).toBe("error");
      expect(s.reason).toBe("card");
    });
  });

  describe("the card was cancelled but the deletion could not be scheduled", () => {
    const auths = [{ source: "pass", id: "up1", authorization_code: "AUTH_pass_1" }];
    const stops = () => h.serviceRpc.mock.calls.filter((c) => c[0] === "account_deletion_stop_renewals");

    it("a database error at the confirm switches renewal off in its own write and says so, plainly", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths }, account_deletion_confirm: new Error("connection reset") });
      const s = await confirm();
      expect(h.deactivate).toHaveBeenCalledTimes(1);
      expect(stops()).toEqual([["account_deletion_stop_renewals", { p_user_id: "user-A" }]]);
      expect(s.status).toBe("error");
      expect(s.reason).toBe("renewal_off");
      expect(s.error).toMatch(/renewal is (now )?off/i);
      expect(s.error).toMatch(/not scheduled|wasn.t scheduled|hasn.t been scheduled/i);
      expect(s.error).toMatch(/try again/i);
      expect(h.signOut).not.toHaveBeenCalled();
      expect(h.updateUser).not.toHaveBeenCalled();
      expect(h.lifecycle).not.toHaveBeenCalled();
    });

    it("a refusal from the confirm (the link expired in the instant between) does the same", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths }, account_deletion_confirm: { ok: false, reason: "expired" } });
      const s = await confirm();
      expect(stops()).toHaveLength(1);
      expect(s.reason).toBe("renewal_off");
    });

    it("if switching renewal off fails too, the person is told renewal may still lapse, and to contact us", async () => {
      h.serviceRpc.mockImplementation(async (name: string) => {
        if (name === "account_deletion_confirm_precheck") return { data: { ok: true, authorizations: auths }, error: null };
        if (name === "account_deletion_confirm") return { data: null, error: { message: "down" } };
        return { data: null, error: { message: "still down" } };
      });
      const s = await confirm();
      expect(s.reason).toBe("renewal_off");
      expect(s.error).toMatch(/contact us/i);
      expect(s.error).toMatch(/may (still )?(fail|lapse)/i);
    });

    it("a link used in the instant between (another click scheduled the deletion) does NOT touch renewal", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths }, account_deletion_confirm: { ok: false, reason: "used" } });
      const s = await confirm();
      expect(stops()).toHaveLength(0);
      expect(s.reason).toBe("used");
    });

    it("no card was cancelled (none stored), so a failed confirm is an ordinary failure and renewal is not touched", async () => {
      serviceAnswers({ account_deletion_confirm: new Error("boom") });
      const s = await confirm();
      expect(stops()).toHaveLength(0);
      expect(s.reason).toBe("failed");
    });
  });

  describe("a misclassification can never let a renewal charge: the stored code is cleared in every outcome that matters", () => {
    const auths = [{ source: "pass", id: "up1", authorization_code: "AUTH_pass_1" }];
    const names = () => h.serviceRpc.mock.calls.map((c) => c[0]);

    it.each([
      ["Paystack deactivated the card", () => h.deactivate.mockResolvedValue({ httpStatus: 200, status: true })],
      ["Paystack's documented not-found (read as already deactivated, even if it were really a wrong path)", () => h.deactivate.mockRejectedValue(Object.assign(new Error("x"), { kind: "decline", status: 404, type: "api_error", code: "resource_not_found" }))],
    ])("%s: the deletion is scheduled through account_deletion_confirm, which clears the stored codes", async (_n, arrange) => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths } });
      arrange();
      const s = await confirm();
      expect(s.status).toBe("done");
      expect(names()).toContain("account_deletion_confirm");
    });

    it("the card was cancelled but the deletion was not scheduled: renewal and the stored code are cleared by account_deletion_stop_renewals", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths }, account_deletion_confirm: new Error("down") });
      await confirm();
      expect(names()).toContain("account_deletion_stop_renewals");
    });

    it("a refusal that blocks the deletion leaves the person ACTIVE with their renewal as it was (nothing was cancelled, nothing is scheduled)", async () => {
      serviceAnswers({ account_deletion_confirm_precheck: { ok: true, authorizations: auths } });
      h.deactivate.mockRejectedValue(new Error("unavailable"));
      const s = await confirm();
      expect(s.reason).toBe("card");
      expect(names()).not.toContain("account_deletion_confirm");
      expect(names()).not.toContain("account_deletion_stop_renewals");
    });
  });

  describe("the gate flag the proxy reads", () => {
    it("confirm sets it with the service role, AFTER the database says scheduled and BEFORE the global sign-out", async () => {
      const order: string[] = [];
      const base = h.serviceRpc.getMockImplementation()!;
      h.serviceRpc.mockImplementation(async (n: string, a: unknown) => (order.push(n), base(n, a)));
      h.updateUser.mockImplementation(async () => (order.push("flag:set"), { data: {}, error: null }));
      h.signOut.mockImplementation(async () => (order.push("signOut"), { error: null }));
      await confirm();
      expect(order).toEqual(["account_deletion_confirm_precheck", "account_deletion_confirm", "flag:set", "signOut"]);
      expect(h.updateUser).toHaveBeenCalledWith("user-A", { app_metadata: { deletion_pending: true } });
    });

    it("a failed write of the flag is logged FAIL_OPEN, counted, and does not fail the deletion", async () => {
      h.updateUser.mockResolvedValue({ data: null, error: { message: "auth admin down" } });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const s = await confirm();
      expect(s.status).toBe("done");
      expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
      expect(error.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/\[pending-deletion\] FAIL_OPEN kind=flag_not_set count=\d+/);
      error.mockRestore();
    });

    it("a refused or failed confirm never sets it", async () => {
      serviceAnswers({ account_deletion_confirm: { ok: false, reason: "used" } });
      await confirm();
      expect(h.updateUser).not.toHaveBeenCalled();
    });
  });

  it("on success signs the person out EVERYWHERE, after the database said so, and returns what happened", async () => {
    const order: string[] = [];
    serviceAnswers({ account_deletion_confirm: { ...OK_CONFIRM, closed_postings: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }], ad_wallet_balance_ngn: 4500 } });
    const base = h.serviceRpc.getMockImplementation()!;
    h.serviceRpc.mockImplementation(async (n: string, a: unknown) => (order.push(n), base(n, a)));
    h.signOut.mockImplementation(async () => (order.push("signOut"), { error: null }));
    const s = await confirm();
    expect(order).toEqual(["account_deletion_confirm_precheck", "account_deletion_confirm", "signOut"]);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(s.status).toBe("done");
    expect(s.hardDeleteAfter).toBe("2026-11-01T12:00:00Z");
    expect(s.creditsForfeited).toBe(12);
    expect(s.closedPostings).toEqual([{ id: "p1", title: "Staff Engineer", organization: "Acme" }]);
    expect(s.adWalletBalanceNgn).toBe(4500);
  });

  it("emails 'your deletion is scheduled, here is how to restore' through the LIFECYCLE sender, with the date, the credits, the postings and the wallet", async () => {
    serviceAnswers({ account_deletion_confirm: { ...OK_CONFIRM, closed_postings: [{ id: "p1", title: "Staff Engineer", organization: "Acme" }], ad_wallet_balance_ngn: 4500 } });
    await confirm();
    const [template, payload] = lastLifecycle();
    expect(template).toBe("deletion_scheduled");
    expect(payload.to).toBe("ada@example.com");
    for (const body of [payload.text, payload.html]) {
      expect(body).toMatch(/1 Nov 2026/);
      expect(body).toMatch(/sign in/i);
      expect(body).toMatch(/restore/i);
      expect(body).toContain("Staff Engineer");
      expect(body).toContain("These postings will be closed now and permanently removed 30 days after closing.");
      expect(body).toMatch(/4,500/);
      expect(body).toMatch(/12 credits/);
    }
  });

  it("a failing sign-out does not turn a scheduled deletion into an error (the gate on every request is what holds the other sessions)", async () => {
    h.signOut.mockResolvedValue({ error: { message: "network" } });
    const s = await confirm();
    expect(s.status).toBe("done");
  });

  it("a failing 'scheduled' email does not turn it into an error either", async () => {
    h.lifecycle.mockRejectedValue(new Error("mail down"));
    const s = await confirm();
    expect(s.status).toBe("done");
  });

  it("a database error at the confirm leaves the person signed in and says so", async () => {
    serviceAnswers({ account_deletion_confirm: new Error("boom") });
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

  it("restore emails 'your account is restored' through the lifecycle sender, saying the Pass does not renew until they resubscribe", async () => {
    await expect(restoreAccountAction()).rejects.toThrow("NEXT_REDIRECT:/jobs");
    const [template, payload] = lastLifecycle();
    expect(template).toBe("deletion_restored");
    expect(payload.to).toBe("ada@example.com");
    expect(payload.text).toMatch(/Auto-Apply/);
    expect(payload.text).toMatch(/Pass .*(does not|doesn.t) renew until you resubscribe/i);
  });

  it("restore clears the gate flag with the service role, AFTER the database restore", async () => {
    const order: string[] = [];
    h.userRpc.mockImplementation(async () => (order.push("rpc:restore"), { data: { ok: true }, error: null }));
    h.updateUser.mockImplementation(async () => (order.push("flag:clear"), { data: {}, error: null }));
    await expect(restoreAccountAction()).rejects.toThrow("NEXT_REDIRECT:/jobs");
    expect(order).toEqual(["rpc:restore", "flag:clear"]);
    expect(h.updateUser).toHaveBeenCalledWith("user-A", { app_metadata: { deletion_pending: null } });
  });

  it("a failed clear is logged FAIL_OPEN and counted; the person is still restored (the prompt page heals a stale flag)", async () => {
    h.updateUser.mockResolvedValue({ data: null, error: { message: "auth admin down" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(restoreAccountAction()).rejects.toThrow("NEXT_REDIRECT:/jobs");
    expect(error.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/\[pending-deletion\] FAIL_OPEN kind=flag_not_cleared count=\d+/);
    error.mockRestore();
  });

  it("a refused restore leaves the gate flag alone", async () => {
    h.userRpc.mockResolvedValue({ data: { ok: false, reason: "window_closed" }, error: null });
    await expect(restoreAccountAction()).rejects.toThrow(/window_closed/);
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("restore reports a closed window instead of pretending, and sends no email", async () => {
    h.userRpc.mockResolvedValue({ data: { ok: false, reason: "window_closed" }, error: null });
    await expect(restoreAccountAction()).rejects.toThrow(/NEXT_REDIRECT:\/settings\/account-deletion\?error=window_closed/);
    expect(h.lifecycle).not.toHaveBeenCalled();
  });

  it("restore with no session sends the person to sign in", async () => {
    h.user = null;
    await expect(restoreAccountAction()).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    expect(h.userRpc).not.toHaveBeenCalled();
  });

  it("keeping the deletion signs out and goes to the home page, changing nothing", async () => {
    await expect(keepDeletionAction()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(h.userRpc).not.toHaveBeenCalled();
    expect(h.serviceRpc).not.toHaveBeenCalled();
  });
});
