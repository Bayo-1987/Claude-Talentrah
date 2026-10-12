import { afterEach, describe, expect, it, vi, type Mocked } from "vitest";
import { findInventedPromise, runFarahMessageDraft, buildDraftPrompt, type DraftDeps, type DraftInput } from "@/lib/employer/applicant-messages/draft-core";
import { FARAH_MESSAGE_DRAFT_NGN } from "@/lib/billing/catalog";

const input: DraftInput = {
  organizationId: "org-1",
  userId: "user-1",
  kind: "invite_interview",
  mode: "draft",
  jobTitle: "Growth Marketer",
  orgName: "Zimcrest",
  candidateFirstName: "Joy",
  senderFirstName: "Tolu",
  notes: "Mention her referral idea. Ask for two times next week.",
  currentSubject: "",
  currentBody: "",
};

const GOOD = { subject: "Interview for Growth Marketer at Zimcrest", body: "Hi Joy,\n\nYour referral idea stood out. Could you share two times that work for you next week?\n\nBest regards,\nTolu, Zimcrest" };

function makeDeps(overrides: Partial<DraftDeps> = {}) {
  const deps = {
    hasPremium: vi.fn(async () => true),
    debit: vi.fn(async () => ({ ok: true as boolean, failed: false })),
    credit: vi.fn(async () => ({ failed: false })),
    generate: vi.fn(async () => ({ ...GOOD })),
    ...overrides,
  };
  return deps as unknown as Mocked<DraftDeps>;
}

afterEach(() => vi.restoreAllMocks());

describe("runFarahMessageDraft: Premium gate, charge before generate, refund on failure, never sends", () => {
  it("a free plan is refused BEFORE any charge or model call", async () => {
    const deps = makeDeps({ hasPremium: vi.fn(async () => false) });
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toMatchObject({ ok: false, kind: "premium_required" });
    expect(deps.debit).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.credit).not.toHaveBeenCalled();
  });

  it("a Premium draft debits the price once, generates once, returns the text, and refunds nothing", async () => {
    const deps = makeDeps();
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toEqual({ ok: true, subject: GOOD.subject, body: GOOD.body });
    expect(deps.debit).toHaveBeenCalledTimes(1);
    expect(deps.debit).toHaveBeenCalledWith({ organizationId: "org-1", userId: "user-1", amountNgn: FARAH_MESSAGE_DRAFT_NGN });
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(deps.credit).not.toHaveBeenCalled();
  });

  it("not enough ad wallet balance: told plainly with the price, nothing generated, nothing to refund", async () => {
    const deps = makeDeps({ debit: vi.fn(async () => ({ ok: false, failed: false })) });
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toMatchObject({ ok: false, kind: "insufficient_balance" });
    expect((result as { error: string }).error).toContain(String(FARAH_MESSAGE_DRAFT_NGN));
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.credit).not.toHaveBeenCalled();
  });

  it("a wallet error is not 'insufficient balance': a generic try-again, nothing generated, nothing refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ debit: vi.fn(async () => ({ ok: false, failed: true })) });
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.credit).not.toHaveBeenCalled();
  });

  it("a model failure refunds the charge exactly once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ generate: vi.fn(async () => { throw new Error("rate limited"); }) });
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(deps.credit).toHaveBeenCalledTimes(1);
    expect(deps.credit).toHaveBeenCalledWith({ organizationId: "org-1", userId: "user-1", amountNgn: FARAH_MESSAGE_DRAFT_NGN });
  });

  it("a draft that never arrives (the model hangs) is a failure after the timeout and is refunded exactly once; a late answer changes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveLate: (v: { subject: string; body: string }) => void = () => {};
    const deps = makeDeps({ generate: vi.fn(() => new Promise<{ subject: string; body: string }>((resolve) => { resolveLate = resolve; })) });
    const result = await runFarahMessageDraft({ ...input, timeoutMs: 20 }, deps);
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(deps.credit).toHaveBeenCalledTimes(1);
    resolveLate({ ...GOOD });
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.credit, "the late answer does not refund again or charge again").toHaveBeenCalledTimes(1);
    expect(deps.debit).toHaveBeenCalledTimes(1);
  });

  it("the browser DISCONNECTS mid-generation: refunded exactly once, reported as aborted, and a late answer changes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    let resolveLate: (v: { subject: string; body: string }) => void = () => {};
    const deps = makeDeps({ generate: vi.fn(() => new Promise<{ subject: string; body: string }>((resolve) => { resolveLate = resolve; })) });
    const pending = runFarahMessageDraft({ ...input, signal: controller.signal }, deps);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: "aborted" });
    expect(deps.credit).toHaveBeenCalledTimes(1);
    resolveLate({ ...GOOD });
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.credit).toHaveBeenCalledTimes(1);
    expect(deps.debit).toHaveBeenCalledTimes(1);
  });

  it("the browser disconnects just AFTER the model answered: the draft is not delivered, so the charge is refunded once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const deps = makeDeps({ generate: vi.fn(async () => { controller.abort(); return { ...GOOD }; }) });
    const result = await runFarahMessageDraft({ ...input, signal: controller.signal }, deps);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
    expect(deps.credit).toHaveBeenCalledTimes(1);
  });

  it("already disconnected before anything starts: no Premium read, no charge, no model call", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = makeDeps();
    expect(await runFarahMessageDraft({ ...input, signal: controller.signal }, deps)).toMatchObject({ ok: false, kind: "aborted" });
    expect(deps.hasPremium).not.toHaveBeenCalled();
    expect(deps.debit).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it("a delivered draft with a live signal is charged once and not refunded", async () => {
    const controller = new AbortController();
    const deps = makeDeps();
    expect(await runFarahMessageDraft({ ...input, signal: controller.signal }, deps)).toMatchObject({ ok: true });
    expect(deps.debit).toHaveBeenCalledTimes(1);
    expect(deps.credit).not.toHaveBeenCalled();
  });

  it("an empty or unusable draft is a failure and is refunded exactly once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of [{ subject: "", body: "x" }, { subject: "s", body: "   " }]) {
      const deps = makeDeps({ generate: vi.fn(async () => bad) });
      expect(await runFarahMessageDraft(input, deps)).toMatchObject({ ok: false, kind: "generation_error" });
      expect(deps.credit).toHaveBeenCalledTimes(1);
    }
  });

  it("a draft that invents money, a guarantee or a clock time the employer never wrote is refused and refunded once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const invented of ["The salary is ₦500,000 a month.", "We guarantee you will be hired.", "Let's meet on Tuesday at 10:30."]) {
      const deps = makeDeps({ generate: vi.fn(async () => ({ subject: GOOD.subject, body: `Hi Joy,\n\n${invented}` })) });
      const result = await runFarahMessageDraft(input, deps);
      expect(result, invented).toMatchObject({ ok: false, kind: "generation_error" });
      expect(deps.credit, invented).toHaveBeenCalledTimes(1);
    }
  });

  it("the same figure IS allowed when the employer wrote it in their own notes", async () => {
    const deps = makeDeps({ generate: vi.fn(async () => ({ subject: GOOD.subject, body: "Hi Joy,\n\nThe salary is ₦500,000 a month." })) });
    const result = await runFarahMessageDraft({ ...input, notes: "The salary is ₦500,000 a month." }, deps);
    expect(result.ok).toBe(true);
  });

  it("a failed refund is reported loudly and the employer still gets the failure answer", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps({ generate: vi.fn(async () => { throw new Error("x"); }), credit: vi.fn(async () => ({ failed: true })) });
    const result = await runFarahMessageDraft(input, deps);
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/reversal FAILED/);
  });

  it("over-long notes or text are refused before anything is charged", async () => {
    const deps = makeDeps();
    expect(await runFarahMessageDraft({ ...input, notes: "n".repeat(2001) }, deps)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await runFarahMessageDraft({ ...input, currentBody: "b".repeat(5001) }, deps)).toMatchObject({ ok: false, kind: "invalid" });
    expect(deps.hasPremium).not.toHaveBeenCalled();
    expect(deps.debit).not.toHaveBeenCalled();
  });

  it("only the minimum reaches the model: kind, mode, job title, organisation, first names, the employer's own notes and text, and nothing else", async () => {
    const deps = makeDeps();
    await runFarahMessageDraft({ ...input, mode: "refine", currentSubject: "Hello", currentBody: "Hi Joy, come in." }, deps);
    const sent = (deps.generate.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["candidateFirstName", "currentBody", "currentSubject", "jobTitle", "kind", "mode", "notes", "orgName", "senderFirstName"]);
  });
});

describe("buildDraftPrompt", () => {
  it("carries the facts it was given and the rules: no invented dates, pay, promises or reasons; a draft the employer reviews", () => {
    const prompt = buildDraftPrompt({ kind: "not_moving_forward", mode: "draft", jobTitle: "Growth Marketer", orgName: "Zimcrest", candidateFirstName: "Joy", senderFirstName: "Tolu", notes: "Keep it kind.", currentSubject: "", currentBody: "" });
    expect(prompt).toContain("Growth Marketer");
    expect(prompt).toContain("Zimcrest");
    expect(prompt).toContain("Joy");
    expect(prompt).toContain("Keep it kind.");
    expect(prompt).toMatch(/do not invent/i);
    expect(prompt).toMatch(/salary|pay/i);
    expect(prompt).toMatch(/review/i);
  });

  it("refine mode includes the employer's current text to improve, draft mode does not pretend there is one", () => {
    const refine = buildDraftPrompt({ kind: "custom", mode: "refine", jobTitle: "J", orgName: "O", candidateFirstName: null, senderFirstName: null, notes: "", currentSubject: "My subject", currentBody: "My own body text" });
    expect(refine).toContain("My own body text");
    expect(refine).toContain("My subject");
    const draft = buildDraftPrompt({ kind: "custom", mode: "draft", jobTitle: "J", orgName: "O", candidateFirstName: null, senderFirstName: null, notes: "", currentSubject: "", currentBody: "" });
    expect(draft).not.toContain("My own body text");
  });
});

describe("findInventedPromise", () => {
  it("is null for an ordinary courteous message", () => {
    expect(findInventedPromise(GOOD.body, "")).toBeNull();
  });
  it("catches amounts, salary words, offers, guarantees, clock times and dates that are not in the employer's own words", () => {
    for (const text of ["₦250,000 per month", "a $5,000 bonus", "your salary will be", "we will make you an offer", "we guarantee", "at 3pm", "at 14:30", "on 14 October", "You are hired"]) {
      expect(findInventedPromise(text, ""), text).not.toBeNull();
    }
  });
  it("lets through what the employer wrote themselves", () => {
    expect(findInventedPromise("Interviews are at 3pm on 14 October.", "interview at 3pm on 14 October")).toBeNull();
  });
});
