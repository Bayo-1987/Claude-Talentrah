/**
 * PR-E4 gate 2: the real postJobAction and updateJobAction with a fake Supabase, for an employer who chose "On our career site". What is pinned: the INSERT never carries the link; a job that takes a link
 * is created as a draft, then the SERVICE-ROLE function is called with the signed-in user as the actor, then (for "Publish") the existing publish step opens it; a refusal shows its plain sentence and
 * nothing else is written; an unverified company gets Path B only (and is told why); the careers-page tick is required for an ATS page; an edit that leaves the link as it is makes no call and does
 * not re-judge a link that was accepted earlier; and an edit that omits the choice changes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  events: [] as string[],
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  data: {} as Record<string, unknown>,
  userRpc: {} as Record<string, unknown>,
  adminRpcErr: null as null | { code?: string; message: string },
  org: { id: "org-1", name: "Acme", domain: "acme.example", verified: true } as Record<string, unknown>,
}));

const USER = { id: "user-1", email: "person@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" };

function chain(table: string): Record<string, unknown> {
  let op = "select";
  const result = () => ({ data: h.data[`${table}.${op}`] ?? null, error: null });
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "single" || p === "maybeSingle") return async () => result();
      return (...args: unknown[]) => {
        if (p === "insert" || p === "update" || p === "upsert" || p === "delete") {
          op = String(p);
          h.events.push(`${op}:${table}${op === "update" ? ":" + JSON.stringify(args[0]) : ""}`);
          if (p === "insert") h.inserts.push({ table, row: args[0] as Record<string, unknown> });
        }
        return c;
      };
    },
  });
  return c;
}

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/embed/revalidate", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/embed/revalidate")>()), revalidateEmbed: vi.fn() }));
vi.mock("@/lib/employer/claim", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/employer/claim")>()), getClaimCandidates: async () => [] }));
vi.mock("@/lib/employer/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/employer/membership")>()),
  requireEmployer: async () => ({ userId: USER.id, userEmail: USER.email, role: "admin", organization: h.org }),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: USER } }) },
    from: (table: string) => chain(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.events.push(`user-rpc:${name}:${JSON.stringify(args)}`);
      return { data: h.userRpc[name] ?? null, error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: (table: string) => chain(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.events.push(`admin-rpc:${name}:${JSON.stringify(args)}`);
      return { data: null, error: h.adminRpcErr };
    },
  }),
}));

import { postJobAction, updateJobAction } from "@/lib/employer/actions";
import { APPLY_LINK_NO_SCREENING_MESSAGE, APPLY_METHOD_MESSAGES, readApplyMethod } from "@/lib/employer/apply-method";

const URL_OK = "https://careers.acme.example/jobs";
const ATS = "https://boards.greenhouse.io/acme";
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("title", "Backend Engineer");
  f.set("location", "Lagos, Nigeria");
  f.set("description", "A real job description, long enough to pass the form's own 40-character minimum length check.");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  f.append("skills", "javascript");
  return f;
};
const link = (extra: Record<string, string> = {}) => form({ applyMethod: "link", applyLinkUrl: URL_OK, ...extra });
const errOf = (r: unknown) => (r as { error?: string }).error ?? "";
const at = (prefix: string) => h.events.findIndex((e) => e.startsWith(prefix));
const adminSet = (url: string | null, kind: string | null, tick: boolean, job = "job-9") =>
  `admin-rpc:set_job_apply_link:${JSON.stringify({ p_job_id: job, p_actor: USER.id, p_url: url, p_kind: kind, p_ats_confirmed: tick })}`;

beforeEach(() => {
  h.events = [];
  h.inserts = [];
  h.adminRpcErr = null;
  h.userRpc = {};
  h.org = { id: "org-1", name: "Acme", domain: "acme.example", verified: true };
  h.data = {
    "job_postings.insert": { id: "job-9" },
    "job_postings.select": { id: "job-9", status: "draft", source_type: "internal", expires_at: null, closing_date_source: null, apply_email: null, apply_link_kind: null },
    "job_postings.update": [{ id: "job-9" }],
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readApplyMethod, 'On our career site'", () => {
  const fd = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const ctx = { companyDomain: "acme.example", companyName: "Acme" };
  it("a link on the verified company's domain needs no tick and is cleaned", () => {
    expect(readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: " https://CAREERS.acme.example/jobs?utm_source=x " }), ctx)).toEqual({
      ok: true,
      method: { kind: "link", url: "https://careers.acme.example/jobs", linkKind: "company", atsConfirmed: false, warning: undefined, unchanged: false },
    });
  });
  it("an ATS page needs the tick (the careers-page confirmation), and is recorded as ats", () => {
    expect(readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: ATS }), ctx)).toEqual({ ok: false, error: APPLY_METHOD_MESSAGES.AE007 });
    expect(readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: ATS, applyLinkConfirm: "on" }), ctx)).toMatchObject({ ok: true, method: { kind: "link", linkKind: "ats", atsConfirmed: true } });
  });
  it("an unverified company (no domain passed) gets Path B only, and the message says why and what to do", () => {
    const out = readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: URL_OK }), { companyDomain: null });
    expect(out).toMatchObject({ ok: false });
    expect(errOf(out)).toMatch(/verified/i);
    expect(errOf(out)).toMatch(/applicant tracking/i);
  });
  it.each([
    ["http://careers.acme.example/x", /https/i],
    ["https://bit.ly/x", /shortener|short/i],
    ["https://careers.acme.example:8443/x", /port/i],
    ["https://elsewhere.example/x", /company's website|applicant tracking/i],
    ["", /address|link/i],
  ])("a refused address %j gets a sentence that says how to fix it", (url, expected) => {
    const out = readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: url }), ctx);
    expect(out).toMatchObject({ ok: false });
    expect(errOf(out)).toMatch(expected);
    expect(errOf(out).length).toBeGreaterThan(30);
  });
  it("an address equal to the stored one is passed through without being judged again (a company that was unverified since does not block an unrelated edit)", () => {
    const out = readApplyMethod(fd({ applyMethod: "link", applyLinkUrl: URL_OK }), { companyDomain: null, storedLink: { url: URL_OK, kind: "company" } });
    expect(out).toMatchObject({ ok: true, method: { kind: "link", url: URL_OK, linkKind: "company", unchanged: true } });
  });
});

describe("postJobAction, 'On our career site'", () => {
  it("creates a draft with NO link in the insert, calls the service-role function with the signed-in user as actor, then publishes, in that order", async () => {
    await expect(postJobAction(null, link({ intent: "publish" }))).rejects.toThrow("NEXT_REDIRECT /employer/jobs?posted=job-9");
    const insert = h.inserts.find((i) => i.table === "job_postings")!;
    expect(insert.row.status).toBe("draft");
    expect(Object.keys(insert.row).filter((k) => k.startsWith("apply_"))).toEqual([]);
    expect(JSON.stringify(insert.row)).not.toContain("acme.example/jobs");
    const created = at("insert:job_postings");
    const set = at("admin-rpc:set_job_apply_link");
    const opened = h.events.findIndex((e) => e.startsWith("update:job_postings") && e.includes('"status":"open"'));
    expect(set).toBeGreaterThan(created);
    expect(opened).toBeGreaterThan(set);
    expect(h.events[set]).toBe(adminSet("https://careers.acme.example/jobs", "company", false));
    expect(at("user-rpc:set_job_apply_link")).toBe(-1);
  });
  it("an ATS page with the tick is sent as ats with the tick", async () => {
    await expect(postJobAction(null, link({ applyLinkUrl: ATS, applyLinkConfirm: "on", intent: "draft" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.events.find((e) => e.startsWith("admin-rpc:set_job_apply_link"))).toBe(adminSet(ATS, "ats", true));
  });
  it("an ATS page without the tick, an unverified company's own site, and a bad address are all refused BEFORE anything is written", async () => {
    expect(errOf(await postJobAction(null, link({ applyLinkUrl: ATS })))).toBe(APPLY_METHOD_MESSAGES.AE007);
    h.org = { ...h.org, verified: false };
    expect(errOf(await postJobAction(null, link()))).toMatch(/verified/i);
    h.org = { ...h.org, verified: true };
    expect(errOf(await postJobAction(null, link({ applyLinkUrl: "http://x.example" })))).toMatch(/https/i);
    expect(h.events).toEqual([]);
  });
  it.each(["AE001", "AE002", "AE004", "AE005", "AE006", "AE007", "42501", "28000"] as const)("a refusal %s from the function shows its plain sentence, keeps the draft and never opens the job", async (code) => {
    h.adminRpcErr = { code, message: 'raw database text "zz_marker_7731"' };
    const out = await postJobAction(null, link({ intent: "publish" }));
    expect(errOf(out)).toContain(APPLY_METHOD_MESSAGES[code]);
    expect(errOf(out)).toContain("Saved as a draft");
    expect(errOf(out)).not.toContain("zz_marker_7731");
    expect(h.events.some((e) => e.startsWith("update:job_postings") && e.includes('"status":"open"'))).toBe(false);
  });
  it("an unknown refusal code gets the try-again line, and the database's text stays out", async () => {
    h.adminRpcErr = { code: "XX000", message: 'raw "zz_marker_7732"' };
    const out = await postJobAction(null, link());
    expect(errOf(out)).toContain("Please try again, or contact support if it keeps happening.");
    expect(errOf(out)).not.toContain("zz_marker_7732");
  });
  it("screening questions sent together with a link are refused before anything is written", async () => {
    const out = await postJobAction(null, link({ screeningQuestions: JSON.stringify([{ questionText: "Can you start in January?", questionType: "free_text", required: false }]) }));
    expect(errOf(out)).toBe(APPLY_LINK_NO_SCREENING_MESSAGE);
    expect(h.events).toEqual([]);
  });
  it("the address is never in the log when the function refuses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.adminRpcErr = { code: "AE005", message: "bad link https://careers.acme.example/jobs?token=secret" };
    await postJobAction(null, link());
    const logged = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("AE005");
    expect(logged).not.toContain("careers.acme.example/jobs");
    expect(logged).not.toContain("token=secret");
  });
  it("a name mismatch on an applicant-tracking page is a WARNING: it is saved, and the redirect carries a note; a matching name and a company-domain link carry none", async () => {
    await expect(postJobAction(null, link({ applyLinkUrl: "https://boards.greenhouse.io/zzqxvv", applyLinkConfirm: "on", intent: "draft" }))).rejects.toThrow("NEXT_REDIRECT /employer/jobs?posted=job-9&applyLinkNote=name");
    expect(at("admin-rpc:set_job_apply_link")).toBeGreaterThan(-1);
    h.events = [];
    await expect(postJobAction(null, link({ applyLinkUrl: ATS, applyLinkConfirm: "on", intent: "draft" }))).rejects.toThrow(/^NEXT_REDIRECT \/employer\/jobs\?posted=job-9$/);
    await expect(postJobAction(null, link({ intent: "draft" }))).rejects.toThrow(/^NEXT_REDIRECT \/employer\/jobs\?posted=job-9$/);
  });
  it("positive control: 'On Talentrah' makes no function call at all", async () => {
    await expect(postJobAction(null, form({ applyMethod: "talentrah", intent: "publish" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(at("admin-rpc:")).toBe(-1);
  });
});

describe("updateJobAction, 'On our career site'", () => {
  const stored = (apply_email: string | null, apply_link_kind: string | null, url: string | null = null) => {
    h.data["job_postings.select"] = { apply_email, apply_link_kind };
    h.userRpc.get_job_apply_link = url;
  };
  it("switching to a link calls the function FIRST, before any field is written", async () => {
    stored(null, null);
    await updateJobAction("job-9", null, link()).catch(() => {});
    const set = at("admin-rpc:set_job_apply_link");
    expect(set).toBeGreaterThan(-1);
    expect(h.events[set]).toBe(adminSet("https://careers.acme.example/jobs", "company", false, "job-9"));
    const written = at("update:job_postings");
    expect(written === -1 || written > set).toBe(true);
  });
  it("a refusal returns its sentence and writes nothing else", async () => {
    stored(null, null);
    h.adminRpcErr = { code: "AE001", message: 'raw "zz_marker_7733"' };
    const out = await updateJobAction("job-9", null, link());
    expect(errOf(out)).toBe(APPLY_METHOD_MESSAGES.AE001);
    expect(h.events.filter((e) => !e.startsWith("admin-rpc:") && !e.startsWith("user-rpc:"))).toEqual([]);
  });
  it("the same address again makes no function call, even if the company is unverified now", async () => {
    stored(null, "company", URL_OK);
    h.org = { ...h.org, verified: false };
    await updateJobAction("job-9", null, link({ applyLinkUrl: URL_OK })).catch(() => {});
    expect(at("admin-rpc:")).toBe(-1);
  });
  it("switching from a stored link to an address uses the e-mail function (which clears the link); no link call is made", async () => {
    stored(null, "company", URL_OK);
    await updateJobAction("job-9", null, form({ applyMethod: "email", applyEmail: "careers@example.test", applyEmailConfirm: "on" })).catch(() => {});
    expect(at("user-rpc:set_job_apply_email")).toBeGreaterThan(-1);
    expect(at("admin-rpc:")).toBe(-1);
  });
  it("an explicit 'On Talentrah' with a stored link clears it through the function", async () => {
    stored(null, "ats", ATS);
    await updateJobAction("job-9", null, form({ applyMethod: "talentrah" })).catch(() => {});
    expect(h.events.find((e) => e.startsWith("admin-rpc:set_job_apply_link"))).toBe(adminSet(null, null, false, "job-9"));
  });
  it("an edit that omits the choice changes nothing: no read of the link, no call", async () => {
    stored(null, "company", URL_OK);
    await updateJobAction("job-9", null, form()).catch(() => {});
    expect(at("admin-rpc:")).toBe(-1);
    expect(at("user-rpc:get_job_apply_link")).toBe(-1);
  });
  it("an ordinary job's edit (explicit On Talentrah, nothing stored) makes no call", async () => {
    stored(null, null);
    await updateJobAction("job-9", null, form({ applyMethod: "talentrah" })).catch(() => {});
    expect(at("admin-rpc:")).toBe(-1);
  });
  it("screening questions sent with a link are refused before anything is read or written", async () => {
    stored(null, null);
    const out = await updateJobAction("job-9", null, link({ screeningQuestions: JSON.stringify([{ questionText: "Can you start in January?", questionType: "free_text", required: false }]) }));
    expect(errOf(out)).toBe(APPLY_LINK_NO_SCREENING_MESSAGE);
    expect(h.events).toEqual([]);
  });
});
