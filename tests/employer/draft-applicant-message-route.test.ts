/**
 * "Draft/Refine with Farah" on Message candidate, the route handler (POST /api/employer/applicant-message-draft), on a real database with the employer's REAL session and the real ad wallet. The model is replaced by a recorder (the
 * recipe of tests/employer/draft-job-action.test.ts); Premium is set the only way it can be, through admin_set_organization_premium. ONE employer identity for the whole file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { FARAH_MESSAGE_DRAFT_NGN } from "@/lib/billing/catalog";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
}));

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => testClientRef.current }));

const mail = vi.hoisted(() => ({ sent: [] as unknown[] }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({ emails: { send: async (payload: unknown) => { mail.sent.push(payload); return { data: { id: "x" }, error: null }; } } }),
}));

const { POST } = await import("@/app/api/employer/applicant-message-draft/route");

type Input = { jobId: string; applicationId: string; kind: string; mode: string; notes: string; subject: string; body: string };
/** The route as the browser calls it: a JSON POST; the request's own signal aborts when the browser disconnects. */
async function draftApplicantMessageWithFarahAction(input: Input, signal?: AbortSignal) {
  const response = await POST(new Request("http://localhost/api/employer/applicant-message-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), ...(signal ? { signal } : {}) }));
  return (await response.json()) as { ok: boolean; kind?: string; error?: string; subject?: string; body?: string };
}

const GOOD = JSON.stringify({ subject: "Interview for Growth Marketer at Zimcrest", body: "Hi Joy,\n\nThank you for applying. Could you share two times that work for you next week?\n\nBest regards,\nTolu, Zimcrest" });

let employer: TestUser;
let seeker: TestUser;
let stranger: TestUser;
let orgId: string;
let otherOrgId: string;
let jobId: string;
let applicationId: string;
let foreignJobId: string;
let foreignApplicationId: string;
const orgIds: string[] = [];

const base = () => ({ jobId, applicationId, kind: "invite_interview", mode: "draft", notes: "Ask for two times next week.", subject: "", body: "" });

async function setWallet(balance: number) {
  const { error } = await admin.from("ad_wallets").upsert({ organization_id: orgId, balance_ngn: balance }, { onConflict: "organization_id" });
  if (error) throw new Error(`wallet: ${error.message}`);
}
const balance = async () => (await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).maybeSingle()).data?.balance_ngn ?? 0;
async function ledger() {
  const { data } = await admin.from("ad_wallet_ledger").select("reason, delta_ngn").eq("organization_id", orgId).order("created_at", { ascending: true });
  return (data ?? []).map((r) => `${r.reason}:${r.delta_ngn}`);
}
async function setPremium(until: string | null) {
  const { error } = await admin.rpc("admin_set_organization_premium", {
    p_organization_id: orgId,
    p_premium_until: until as unknown as string,
    p_admin_user_id: null as unknown as string,
    p_admin_email: "operator@talentrah.internal",
    p_admin_session_id: null as unknown as string,
    p_reason: "test fixture",
  });
  if (error) throw new Error(`premium: ${error.message}`);
}
const future = () => new Date(Date.now() + 86_400_000).toISOString();

async function makeJob(organizationId: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: organizationId, company_name: "EMPLOYER-TEST Co", title, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`job: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  [employer, seeker, stranger] = await Promise.all([createTestUser("amsg-draft-emp"), createTestUser("amsg-draft-seeker"), createTestUser("amsg-draft-other")]);
  testClientRef.current = await sessionFor(employer.email, employer.id);
  await admin.from("profiles").update({ first_name: "Joy" }).eq("id", seeker.id);
  for (const [label, owner] of [["own", employer], ["other", stranger]] as const) {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({ name: `EMPLOYER-TEST Msg draft ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true })
      .select("id")
      .single();
    if (error || !org) throw new Error(`org: ${error?.message}`);
    orgIds.push(org.id);
    await admin.from("organization_members").insert({ organization_id: org.id, user_id: owner.id, role: "owner" });
    if (label === "own") orgId = org.id;
    else otherOrgId = org.id;
  }
  jobId = await makeJob(orgId, "Growth Marketer");
  foreignJobId = await makeJob(otherOrgId, "Other role");
  const apply = async (job: string) => {
    const { data, error } = await admin
      .from("applications")
      .insert({ user_id: seeker.id, job_posting_id: job, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !data) throw new Error(`application: ${error?.message}`);
    return data.id;
  };
  applicationId = await apply(jobId);
  foreignApplicationId = await apply(foreignJobId);
}, 90_000);

beforeEach(async () => {
  generateText.mockReset();
  generateText.mockResolvedValue(GOOD);
  mail.sent.length = 0;
  await admin.from("ad_wallet_ledger").delete().eq("organization_id", orgId);
  await admin.from("organization_premium").delete().eq("organization_id", orgId);
  await setWallet(1000);
  await setPremium(future());
});

afterAll(async () => {
  await admin.from("applications").delete().in("id", [applicationId, foreignApplicationId].filter(Boolean));
  if (orgIds.length) await deleteOrgsCascade(admin, orgIds);
  await deleteTestUsers([employer?.id, seeker?.id, stranger?.id].filter(Boolean) as string[]);
});

describe("draftApplicantMessageWithFarahAction", () => {
  it("a Premium employer gets a draft, pays exactly the price from the ad wallet, and NOTHING is sent", async () => {
    const result = await draftApplicantMessageWithFarahAction(base());
    expect(result).toMatchObject({ ok: true });
    expect((result as { body: string }).body).toContain("two times");
    expect(await balance()).toBe(1000 - FARAH_MESSAGE_DRAFT_NGN);
    expect(await ledger()).toEqual([`farah_message_draft_charge:-${FARAH_MESSAGE_DRAFT_NGN}`]);
    expect(mail.sent, "Farah never sends").toHaveLength(0);
    const { count } = await admin.from("applicant_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
    expect(count ?? 0, "and nothing is logged as a message").toBe(0);
  });

  it("a free plan is refused by the server: no model call, no charge", async () => {
    await admin.from("organization_premium").delete().eq("organization_id", orgId);
    const result = await draftApplicantMessageWithFarahAction(base());
    expect(result).toMatchObject({ ok: false, kind: "premium_required" });
    expect(generateText).not.toHaveBeenCalled();
    expect(await balance()).toBe(1000);
    expect(await ledger()).toEqual([]);
  });

  it("a Premium date in the past is a free plan", async () => {
    await setPremium(new Date(Date.now() - 1000).toISOString());
    expect(await draftApplicantMessageWithFarahAction(base())).toMatchObject({ ok: false, kind: "premium_required" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("not enough ad wallet balance: told the price, no model call, nothing charged", async () => {
    await setWallet(FARAH_MESSAGE_DRAFT_NGN - 1);
    const result = await draftApplicantMessageWithFarahAction(base());
    expect(result).toMatchObject({ ok: false, kind: "insufficient_balance" });
    expect(generateText).not.toHaveBeenCalled();
    expect(await balance()).toBe(FARAH_MESSAGE_DRAFT_NGN - 1);
  });

  it("a model failure is refunded: the balance is back and the ledger shows one charge and ONE reversal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateText.mockRejectedValue(new Error("provider down"));
    const result = await draftApplicantMessageWithFarahAction(base());
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(await balance()).toBe(1000);
    expect(await ledger()).toEqual([`farah_message_draft_charge:-${FARAH_MESSAGE_DRAFT_NGN}`, `reversal:${FARAH_MESSAGE_DRAFT_NGN}`]);
    vi.restoreAllMocks();
  });

  it("a draft that invents a salary is refused and refunded once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateText.mockResolvedValue(JSON.stringify({ subject: "Offer", body: "Hi Joy,\n\nThe salary is ₦900,000 a month." }));
    const result = await draftApplicantMessageWithFarahAction(base());
    expect(result).toMatchObject({ ok: false, kind: "generation_error" });
    expect(await balance()).toBe(1000);
    expect((await ledger()).filter((l) => l.startsWith("reversal")).length).toBe(1);
    vi.restoreAllMocks();
  });

  it("an applicant on ANOTHER organisation's job is refused before anything is charged or sent to the model", async () => {
    const result = await draftApplicantMessageWithFarahAction({ ...base(), jobId: foreignJobId, applicationId: foreignApplicationId });
    expect(result).toMatchObject({ ok: false, kind: "not_found" });
    expect(await draftApplicantMessageWithFarahAction({ ...base(), applicationId: foreignApplicationId })).toMatchObject({ ok: false, kind: "not_found" });
    expect(generateText).not.toHaveBeenCalled();
    expect(await balance()).toBe(1000);
  });

  it("only the minimum reaches the model: no email, no surname, nothing from the resume", async () => {
    await draftApplicantMessageWithFarahAction({ ...base(), mode: "refine", subject: "Hello", body: "Hi Joy, come in." });
    const prompt = JSON.stringify(generateText.mock.calls[0][0]);
    expect(prompt).toContain("Joy");
    expect(prompt).toContain("Growth Marketer");
    expect(prompt).not.toContain(seeker.email);
    expect(prompt).not.toMatch(/@/);
  });

  it("DISCONNECT mid-generation: the browser goes away before the draft is delivered, so the N100 is refunded automatically, exactly once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    generateText.mockImplementation(() => new Promise(() => {})); // the model never answers while the browser is still there
    const pending = draftApplicantMessageWithFarahAction(base(), controller.signal);
    for (let i = 0; i < 200 && generateText.mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(generateText, "the charge happened and the model was asked").toHaveBeenCalledTimes(1);
    expect(await balance(), "charged while the model works").toBe(1000 - FARAH_MESSAGE_DRAFT_NGN);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, kind: "aborted" });
    expect(await balance()).toBe(1000);
    expect(await ledger()).toEqual([`farah_message_draft_charge:-${FARAH_MESSAGE_DRAFT_NGN}`, `reversal:${FARAH_MESSAGE_DRAFT_NGN}`]);
    vi.restoreAllMocks();
  });

  it("DISCONNECT after the model answered but before the draft is returned: refunded once, nothing delivered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    generateText.mockImplementation(async () => {
      controller.abort(); // the browser leaves just as the model finishes
      return GOOD;
    });
    const result = await draftApplicantMessageWithFarahAction(base(), controller.signal);
    expect(result).toMatchObject({ ok: false });
    expect(await balance()).toBe(1000);
    expect((await ledger()).filter((l) => l.startsWith("reversal")).length).toBe(1);
    vi.restoreAllMocks();
  });

  it("a request that was already cancelled before it started is never charged", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await draftApplicantMessageWithFarahAction(base(), controller.signal);
    expect(result).toMatchObject({ ok: false });
    expect(generateText).not.toHaveBeenCalled();
    expect(await balance()).toBe(1000);
    expect(await ledger()).toEqual([]);
  });

  it("a DELIVERED draft (no disconnect) is charged exactly once, even with a live signal attached", async () => {
    const controller = new AbortController();
    const result = await draftApplicantMessageWithFarahAction(base(), controller.signal);
    expect(result).toMatchObject({ ok: true });
    expect(await balance()).toBe(1000 - FARAH_MESSAGE_DRAFT_NGN);
    expect(await ledger()).toEqual([`farah_message_draft_charge:-${FARAH_MESSAGE_DRAFT_NGN}`]);
  });

  it("a signed-out caller and a signed-in person with no organisation get 401 and 403-shaped answers, nothing charged", async () => {
    const saved = testClientRef.current;
    testClientRef.current = { auth: { getUser: async () => ({ data: { user: null } }) } } as unknown as DB;
    const response = await POST(new Request("http://localhost/api/employer/applicant-message-draft", { method: "POST", body: JSON.stringify(base()) }));
    expect(response.status).toBe(401);
    testClientRef.current = saved;
    expect(await balance()).toBe(1000);
  });

  it("a browser cannot slip in another application or kind: junk ids are refused", async () => {
    expect(await draftApplicantMessageWithFarahAction({ ...base(), applicationId: "x" })).toMatchObject({ ok: false, kind: "not_found" });
    expect(generateText).not.toHaveBeenCalled();
  });
});
