/**
 * EMPLOYER-ACTIONS-RAW-DB-ERRORS-1: the employer Server Actions must not show the database's own error text. Each failure below makes one Supabase call return an error that carries a recognisable marker (a
 * constraint name); the response must not contain it and must say, in plain words, what failed and what to do. The real text goes to the server log with the action name and the user id. Response shape and
 * `values` (what was typed) are unchanged. Supabase is faked; the actions are the real ones. (Auto-Apply's two lines are in tests/auto-apply/toggle-dismiss-no-db-text.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  err: {} as Record<string, { message: string; code?: string }>,
  data: {} as Record<string, unknown>,
  rpcErr: null as null | { message: string },
}));

const USER = { id: "user-1", email: "person@acme.example", email_confirmed_at: "2026-01-01T00:00:00Z" };
const ORG = { id: "org-1", name: "Acme", domain: "acme.example", verified: true };

/** A chain whose terminal result depends on the table and the write (or read) verb that was called on it. */
function chain(table: string): Record<string, unknown> {
  let op = "select";
  const result = () => ({ data: h.data[`${table}.${op}`] ?? null, error: h.err[`${table}.${op}`] ?? null });
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "single" || p === "maybeSingle") return async () => result();
      return (...args: unknown[]) => {
        if (p === "insert" || p === "update" || p === "upsert" || p === "delete") op = String(p);
        void args;
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
  requireEmployer: async () => ({ userId: USER.id, userEmail: USER.email, role: "owner", organization: ORG }),
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: USER } }) },
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: h.rpcErr }),
  }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: h.rpcErr }),
  }),
}));

import {
  claimJobPostingAction,
  createOrganizationAction,
  getApplicationScreeningAnswersAction,
  joinOrganizationAction,
  postJobAction,
  setApplicantStatusAction,
  submitCacVerificationAction,
  updateCompanyProfileAction,
  updateJobAction,
} from "@/lib/employer/actions";

const MARKER = 'duplicate key value violates unique constraint "zz_marker_6620"';
const RAW = { message: MARKER, code: "XX000" };
const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const jobForm = (extra: Record<string, string> = {}) => {
  const f = fd({ title: "Backend Engineer", location: "Lagos, Nigeria", description: "A real job description, long enough to pass the form's own 40-character minimum length check.", ...extra });
  f.append("skills", "javascript");
  return f;
};
const errOf = (r: unknown) => (r as { error?: string }).error ?? "";
const TRY = "Please try again, or contact support if it keeps happening.";
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

beforeEach(() => {
  h.err = {};
  h.data = {};
  h.rpcErr = null;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  errorLog.mockClear();
});

function expectPlain(result: unknown, sentence: string, action: string) {
  expect(errOf(result)).toBe(sentence);
  expect(errOf(result)).not.toContain("zz_marker_6620");
  expect(errOf(result)).not.toContain("constraint");
  expect(logged()).toContain("zz_marker_6620");
  expect(logged()).toContain(action);
  expect(logged()).toContain(USER.id);
}

describe("each database failure shows a plain sentence and logs the real text with the action name and the user id", () => {
  it("createOrganizationAction: the verification update fails (the company exists; no values come back)", async () => {
    h.data["organizations.insert"] = { id: "org-9" };
    h.err["organizations.update"] = RAW;
    const out = await createOrganizationAction(null, fd({ name: "Acme", domain: "acme.example", description: "x" }));
    expectPlain(out, "Organisation created, but verification didn't complete. Your jobs stay private until it does. Please try again from Company Profile, or contact support.", "createOrganizationAction");
    expect(out).not.toHaveProperty("values");
    expect(logged()).toContain("org-9");
  });
  it("joinOrganizationAction: the company lookup fails", async () => {
    h.err["organizations.select"] = RAW;
    expectPlain(await joinOrganizationAction(null, fd({ organizationId: "org-2" })), `Couldn't look up that company. ${TRY}`, "joinOrganizationAction");
  });
  it("joinOrganizationAction: adding the member fails", async () => {
    h.data["organizations.select"] = { id: "org-2", domain: "acme.example", verified: true };
    h.err["organization_members.insert"] = RAW;
    expectPlain(await joinOrganizationAction(null, fd({ organizationId: "org-2" })), `Couldn't add you to that company. ${TRY}`, "joinOrganizationAction");
  });
  it("updateCompanyProfileAction: the profile save fails, and what was typed still comes back", async () => {
    h.err["organizations.update"] = RAW;
    const out = await updateCompanyProfileAction(null, fd({ name: "Acme Ltd", domain: "acme.example", description: "We make things.", logoUrl: "" }));
    expectPlain(out, `Couldn't save your profile. ${TRY}`, "updateCompanyProfileAction");
    expect((out as { values?: unknown }).values).toEqual({ name: "Acme Ltd", domain: "acme.example", description: "We make things.", logoUrl: "" });
  });
  it("submitCacVerificationAction: the write fails, and what was typed still comes back", async () => {
    h.err["organizations.update"] = RAW;
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" }));
    expectPlain(out, `Couldn't submit for verification. ${TRY}`, "submitCacVerificationAction");
    expect((out as { values?: unknown }).values).toEqual({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" });
  });
  it.each([
    ["publish", "publish the job", {}],
    ["draft", "save the draft", { intent: "draft" }],
  ])("postJobAction (%s): the insert fails", async (_intent, what, extra) => {
    h.err["job_postings.insert"] = RAW;
    expectPlain(await postJobAction(null, jobForm(extra)), `Couldn't ${what}. ${TRY}`, "postJobAction");
  });
  it("updateJobAction: the update fails", async () => {
    h.err["job_postings.update"] = RAW;
    expectPlain(await updateJobAction("job-1", null, jobForm()), `Couldn't save the job. ${TRY}`, "updateJobAction");
  });
  it("setApplicantStatusAction: the upsert fails", async () => {
    h.err["employer_applicant_status.upsert"] = RAW;
    expectPlain(await setApplicantStatusAction("app-1", "reviewing"), `Couldn't update status. ${TRY}`, "setApplicantStatusAction");
  });
  it("getApplicationScreeningAnswersAction: the lookup fails", async () => {
    h.rpcErr = RAW;
    expectPlain(await getApplicationScreeningAnswersAction("app-1"), `Couldn't load screening answers. ${TRY}`, "getApplicationScreeningAnswersAction");
  });
  it("claimJobPostingAction: the claim fails", async () => {
    h.rpcErr = RAW;
    const out = await claimJobPostingAction(null, fd({ externalJobPostingId: "ext-1", title: "Backend Engineer", description: "A real job description, long enough to pass the form's own 40-character minimum check.", location: "Lagos" }));
    expectPlain(out, `Couldn't claim this listing. ${TRY}`, "claimJobPostingAction");
  });
});

describe("what does not change", () => {
  it("a duplicate posting keeps its own plain answer (the 23505 branch is untouched)", async () => {
    h.err["job_postings.insert"] = { message: MARKER, code: "23505" };
    expect(errOf(await postJobAction(null, jobForm()))).toBe("You've already posted this role in this location.");
    h.err["job_postings.update"] = { message: MARKER, code: "23505" };
    expect(errOf(await updateJobAction("job-1", null, jobForm()))).toBe("Another of your postings already uses this title and location.");
  });
  it("no error: nothing is logged and no failure text is returned (a successful profile save)", async () => {
    const out = await submitCacVerificationAction(null, fd({ cacNumber: "RC1234567", cacBusinessName: "Acme Nigeria Ltd" }));
    expect(out).toEqual({ ok: true });
    expect(errorLog).not.toHaveBeenCalled();
  });
});
