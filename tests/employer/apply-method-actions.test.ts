/**
 * PR-E2b: the real postJobAction and updateJobAction with a fake Supabase, for an employer who chose "By email". What is pinned: the INSERT never carries the address; a job that takes email is
 * created as a draft, then the database function is called, then (for "Publish") the existing publish step opens it, in that order; a refusal shows its plain sentence and nothing else is
 * written; screening questions sent with email are refused; an edit changes the method FIRST and only when it changed; an ordinary job's edit makes no function call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  events: [] as string[],
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  data: {} as Record<string, unknown>,
  rpcErr: null as null | { code?: string; message: string },
}));

const USER = { id: "user-1", email: "person@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" };
const ORG = { id: "org-1", name: "Acme", domain: "acme.example", verified: true };

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
  requireEmployer: async () => ({ userId: USER.id, userEmail: USER.email, role: "admin", organization: ORG }),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: USER } }) },
    from: (table: string) => chain(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.events.push(`rpc:${name}:${JSON.stringify(args)}`);
      return { data: null, error: h.rpcErr };
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({ from: (table: string) => chain(table), rpc: async () => ({ data: null, error: null }) }),
}));

import { postJobAction, updateJobAction } from "@/lib/employer/actions";
import { APPLY_EMAIL_CONFIRM_MESSAGE, APPLY_EMAIL_NO_SCREENING_MESSAGE, APPLY_METHOD_MESSAGES } from "@/lib/employer/apply-method";

const ADDRESS = "careers@example.test";
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("title", "Backend Engineer");
  f.set("location", "Lagos, Nigeria");
  f.set("description", "A real job description, long enough to pass the form's own 40-character minimum length check.");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  f.append("skills", "javascript");
  return f;
};
const email = (extra: Record<string, string> = {}) => form({ applyMethod: "email", applyEmail: " Careers@Example.TEST ", applyEmailConfirm: "on", ...extra });
const errOf = (r: unknown) => (r as { error?: string }).error ?? "";
const at = (prefix: string) => h.events.findIndex((e) => e.startsWith(prefix));
const rpcEvent = `rpc:set_job_apply_email:${JSON.stringify({ p_job_id: "job-9", p_address: ADDRESS })}`;

beforeEach(() => {
  h.events = [];
  h.inserts = [];
  h.rpcErr = null;
  h.data = {
    "job_postings.insert": { id: "job-9" },
    // publishJobAction's own read of the draft, and its update's returned row.
    "job_postings.select": { id: "job-9", status: "draft", source_type: "internal", expires_at: null, closing_date_source: null, apply_email: null },
    "job_postings.update": [{ id: "job-9" }],
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("postJobAction, 'By email'", () => {
  it("creates a draft with NO address in the insert, calls the function, then publishes: in that order", async () => {
    await expect(postJobAction(null, email({ intent: "publish" }))).rejects.toThrow("NEXT_REDIRECT /employer/jobs?posted=job-9");
    const insert = h.inserts.find((i) => i.table === "job_postings")!;
    expect(insert.row.status).toBe("draft");
    expect("apply_email" in insert.row).toBe(false);
    expect(JSON.stringify(insert.row)).not.toContain("example.test");
    const created = at("insert:job_postings");
    const set = at("rpc:set_job_apply_email");
    const opened = h.events.findIndex((e) => e.startsWith("update:job_postings") && e.includes('"status":"open"'));
    expect(created).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(created);
    expect(opened).toBeGreaterThan(set);
    expect(h.events[set]).toBe(rpcEvent); // the NORMALISED address
  });

  it("'Save as draft' calls the function and never opens the job", async () => {
    await expect(postJobAction(null, email({ intent: "draft" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(at("rpc:set_job_apply_email")).toBeGreaterThan(-1);
    expect(h.events.some((e) => e.startsWith("update:job_postings") && e.includes('"status":"open"'))).toBe(false);
  });

  it.each(["AE001", "AE002", "AE003", "AE004", "42501", "28000"] as const)("a refusal %s shows its plain sentence, keeps the draft and never opens the job", async (code) => {
    h.rpcErr = { code, message: 'raw database text "zz_marker_5521"' };
    const out = await postJobAction(null, email({ intent: "publish" }));
    expect(errOf(out)).toContain(APPLY_METHOD_MESSAGES[code]);
    expect(errOf(out)).toContain("Saved as a draft");
    expect(errOf(out)).not.toContain("zz_marker_5521");
    expect(h.events.some((e) => e.startsWith("update:job_postings") && e.includes('"status":"open"'))).toBe(false);
  });

  it("an unknown refusal code gets the try-again line", async () => {
    h.rpcErr = { code: "XX000", message: 'raw "zz_marker_5522"' };
    const out = await postJobAction(null, email());
    expect(errOf(out)).toContain("Please try again, or contact support if it keeps happening.");
    expect(errOf(out)).not.toContain("zz_marker_5522");
  });

  it("an unusable address or a missing tick is refused BEFORE anything is written", async () => {
    expect(errOf(await postJobAction(null, email({ applyEmail: "a@b.co, c@d.co" })))).toBe(APPLY_METHOD_MESSAGES.AE003);
    const noTick = email();
    noTick.delete("applyEmailConfirm");
    expect(errOf(await postJobAction(null, noTick))).toBe(APPLY_EMAIL_CONFIRM_MESSAGE);
    expect(h.events).toEqual([]);
  });

  it("screening questions sent together with email are refused, not dropped, before anything is written", async () => {
    const out = await postJobAction(null, email({ screeningQuestions: JSON.stringify([{ questionText: "Can you start in January?", questionType: "free_text", required: false }]) }));
    expect(errOf(out)).toBe(APPLY_EMAIL_NO_SCREENING_MESSAGE);
    expect(h.events).toEqual([]);
  });

  it("positive control: 'On Talentrah' is created open, with no function call and no address", async () => {
    await expect(postJobAction(null, form({ intent: "publish" }))).rejects.toThrow("NEXT_REDIRECT /employer/jobs?posted=job-9");
    const insert = h.inserts.find((i) => i.table === "job_postings")!;
    expect(insert.row.status).toBe("open");
    expect("apply_email" in insert.row).toBe(false);
    expect(at("rpc:set_job_apply_email")).toBe(-1);
  });
});

describe("updateJobAction", () => {
  const stored = (apply_email: string | null) => {
    h.data["job_postings.select"] = { apply_email };
  };

  it("switching to email calls the function FIRST, before any field is written", async () => {
    stored(null);
    await updateJobAction("job-9", null, email()).catch(() => {});
    const set = at("rpc:set_job_apply_email");
    const written = at("update:job_postings");
    expect(set).toBeGreaterThan(-1);
    expect(h.events[set]).toBe(rpcEvent);
    expect(written === -1 || written > set).toBe(true);
  });

  it("a refusal returns its sentence and writes nothing else", async () => {
    stored(null);
    h.rpcErr = { code: "AE001", message: 'raw "zz_marker_5523"' };
    const out = await updateJobAction("job-9", null, email());
    expect(errOf(out)).toBe(APPLY_METHOD_MESSAGES.AE001);
    expect(h.events.filter((e) => !e.startsWith("rpc:"))).toEqual([]);
  });

  it("the same address again makes no function call", async () => {
    stored(ADDRESS);
    await updateJobAction("job-9", null, email()).catch(() => {});
    expect(at("rpc:set_job_apply_email")).toBe(-1);
  });

  it("switching back to 'On Talentrah' clears the address through the function", async () => {
    stored(ADDRESS);
    await updateJobAction("job-9", null, form()).catch(() => {});
    expect(h.events.find((e) => e.startsWith("rpc:set_job_apply_email"))).toBe(`rpc:set_job_apply_email:${JSON.stringify({ p_job_id: "job-9", p_address: null })}`);
  });

  it("an ordinary job's edit (no address before or after) makes no function call", async () => {
    stored(null);
    await updateJobAction("job-9", null, form()).catch(() => {});
    expect(at("rpc:set_job_apply_email")).toBe(-1);
  });

  it("screening questions sent with email are refused before anything is read or written", async () => {
    stored(null);
    const out = await updateJobAction("job-9", null, email({ screeningQuestions: JSON.stringify([{ questionText: "Can you start in January?", questionType: "free_text", required: false }]) }));
    expect(errOf(out)).toBe(APPLY_EMAIL_NO_SCREENING_MESSAGE);
    expect(h.events).toEqual([]);
  });
});
