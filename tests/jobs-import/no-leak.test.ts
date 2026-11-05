/**
 * PR-U1: no address, ever. The 558 e-mail-only rows' addresses exist only in job_postings.apply_email (and the request bytes in flight). They are never in a response, an audit row, a log
 * line, or an error. A database error is the real danger: a check-constraint error quotes the whole failing row. So the confirm path logs and audits an error CLASS only and never a message.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleConfirm } from "@/lib/jobs/sheet-import/handlers";
import { buildPlan } from "@/lib/jobs/sheet-import/plan";
import { FIXTURE_ADDRESSES, NOW, formRequest, makeDeps, sha12, sheetOf } from "./support";

const ROOT = path.join(__dirname, "../..");
const SHEET = sheetOf({ link: 3, both: 1, email: 3 });
const plan = buildPlan(SHEET, { now: NOW });
const FIELDS = { sha12: sha12(SHEET), importable: String(plan.counts.importable), batches: String(plan.counts.batches), tick: "on" };

afterEach(() => vi.restoreAllMocks());

function everythingSeen(parts: unknown[]): string {
  return parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\n").toLowerCase();
}
function expectNoAddress(text: string, where: string) {
  for (const secret of FIXTURE_ADDRESSES) expect(text, `${where}: ${secret}`).not.toContain(secret.toLowerCase());
  expect(text, where).not.toMatch(/hr\d@|both\d@|@example\.test/);
}
function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
}

describe("a database error that quotes the failing row (an address inside the message)", () => {
  const quoting = `new row for relation "job_postings" violates check constraint "job_postings_apply_email_length"\nDETAIL: Failing row contains (hr1@example.test, hr2@example.test, both1@example.test, careers.example.test, 08000000000).`;

  it("reaches no response, no audit row and no console call: a class only", async () => {
    const spies = consoleSpies();
    const { deps, db, audit, logged } = makeDeps();
    db.failOnWrite = 1;
    db.failMessage = quoting;
    const res = await handleConfirm(formRequest("confirm", SHEET, FIELDS), deps);
    const text = await res.text();
    expectNoAddress(text.toLowerCase(), "response");
    expectNoAddress(everythingSeen(audit.calls), "audit rows");
    expectNoAddress(everythingSeen(spies.flatMap((s) => s.mock.calls)), "console");
    expectNoAddress(everythingSeen(logged), "the handler's log");
    expect(JSON.parse(text).outcome).toBe("failed");
    expect(audit.calls.find((c) => c.kind === "finished")!.detail.error_class).toMatch(/^[A-Za-z0-9_:]{1,40}$/);
  });

  it("the same for a thrown error whose message holds an address", async () => {
    const spies = consoleSpies();
    const { deps, audit, logged } = makeDeps({
      service: () => ({
        from: () => ({
          upsert: () => ({
            select: async () => {
              throw new Error(`socket closed while sending hr1@example.test and careers.example.test`);
            },
          }),
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        }),
      }) as never,
    });
    const res = await handleConfirm(formRequest("confirm", SHEET, FIELDS), deps);
    const text = (await res.text()).toLowerCase();
    expectNoAddress(text, "response");
    expectNoAddress(everythingSeen(audit.calls), "audit rows");
    expectNoAddress(everythingSeen(spies.flatMap((s) => s.mock.calls)), "console");
    expectNoAddress(everythingSeen(logged), "log");
  });

  it("a database error while reading existing fingerprints is also a class only", async () => {
    const spies = consoleSpies();
    const { deps, audit } = makeDeps({
      service: () => ({
        from: () => ({
          upsert: () => ({ select: async () => ({ data: [], error: null }) }),
          select: () => ({ in: async () => ({ data: null, error: { message: quoting, code: "XX000" } }) }),
        }),
      }) as never,
    });
    const res = await handleConfirm(formRequest("confirm", SHEET, FIELDS), deps);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expectNoAddress((await res.text()).toLowerCase(), "response");
    expectNoAddress(everythingSeen(audit.calls), "audit rows");
    expectNoAddress(everythingSeen(spies.flatMap((s) => s.mock.calls)), "console");
  });
});

describe("the success path", () => {
  it("no response, audit row or console call holds an address either", async () => {
    const spies = consoleSpies();
    const { deps, audit, logged } = makeDeps();
    const res = await handleConfirm(formRequest("confirm", SHEET, FIELDS), deps);
    expect(res.status).toBe(200);
    expectNoAddress((await res.text()).toLowerCase(), "response");
    expectNoAddress(everythingSeen(audit.calls), "audit rows");
    expectNoAddress(everythingSeen(spies.flatMap((s) => s.mock.calls)), "console");
    expectNoAddress(everythingSeen(logged), "log");
  });
});

describe("the source", () => {
  it.each(["handlers.ts", "upload.ts", "write.ts", "audit.ts", "deps.ts", "constants.ts"])("%s never reads an error's message", (file) => {
    const code = readFileSync(path.join(ROOT, "src/lib/jobs/sheet-import", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.message\b/);
    expect(code).not.toMatch(/String\(\s*(err|error|e)\s*\)|\$\{\s*(err|error|e)\s*\}/);
  });
});
