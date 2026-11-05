/**
 * PR-U1: confirm is the only write, and its authority never comes from the client. The server recomputes the whole plan from the bytes and writes nothing unless the three numbers the
 * admin saw (hash, importable, batches) equal its own. Audit: `jobs.import_requested` BEFORE any write (cannot be written -> nothing is written), `jobs.import_finished` after.
 * Insert-only, a canary of 10 then batches of at most 50, sequential, stopping at the first error.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { handleConfirm } from "@/lib/jobs/sheet-import/handlers";
import { buildPlan } from "@/lib/jobs/sheet-import/plan";
import { NOW, csv, fakeAudit, formRequest, linkRow, makeDeps, sheetOf, sha12 } from "./support";

const fieldsFor = (text: string, over: Record<string, string> = {}) => {
  const plan = buildPlan(text, { now: NOW });
  return { sha12: sha12(text), importable: String(plan.counts.importable), batches: String(plan.counts.batches), tick: "on", ...over };
};
const post = (text: string, fields: Record<string, string>, deps: Parameters<typeof handleConfirm>[1]) => handleConfirm(formRequest("confirm", text, fields), deps);

describe("the echo", () => {
  const text = sheetOf({ link: 5, email: 2 });
  it.each([
    ["a changed file hash", { sha12: "000000000000" }],
    ["another importable count", { importable: "99" }],
    ["another batch count", { batches: "9" }],
  ])("%s writes nothing and answers 409", async (_n, bad) => {
    const { deps, db, audit } = makeDeps();
    const res = await post(text, fieldsFor(text, bad), deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("preview_changed");
    expect(db.upserts).toHaveLength(0);
    expect(audit.calls.filter((c) => c.kind === "requested")).toHaveLength(0);
  });

  it("a missing tick answers 400 and writes nothing", async () => {
    const { deps, db } = makeDeps();
    const res = await post(text, { ...fieldsFor(text), tick: "" }, deps);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("not_confirmed");
    expect(db.upserts).toHaveLength(0);
  });

  it("takes nothing but the three numbers and the tick from the client: a posted rows, key or batch field changes nothing", async () => {
    const { deps, db } = makeDeps();
    const res = await post(text, { ...fieldsFor(text), rows: '[{"title":"x"}]', source_key: "manual-sheet-2026-11-02", batch: "9", external_source: "greenhouse" }, deps);
    expect(res.status).toBe(200);
    for (const u of db.upserts) for (const r of u.rows) expect((r.external_source as string).startsWith("manual-upload-")).toBe(true);
  });

  it("the changed database since the preview (a row now already on Talentrah) also answers 409", async () => {
    const { deps, db } = makeDeps();
    const fields = fieldsFor(text);
    const first = buildPlan(text, { now: NOW }).items[0].insert.dedup_fingerprint;
    db.rows.set(first, {});
    const res = await post(text, fields, deps);
    expect(res.status).toBe(409);
    expect(db.upserts).toHaveLength(0);
  });
});

describe("the write", () => {
  it("writes a canary of 10, then batches of at most 50, each as insert-only upsert that ignores a known fingerprint, in order", async () => {
    const text = sheetOf({ link: 100, both: 15, email: 5 });
    const { deps, db, audit } = makeDeps();
    const res = await post(text, fieldsFor(text), deps);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.upserts.map((u) => u.rows.length)).toEqual([10, 50, 50, 10]);
    for (const u of db.upserts) expect(u.options).toEqual({ onConflict: "dedup_fingerprint", ignoreDuplicates: true });
    expect(body).toMatchObject({ ok: true, outcome: "completed", inserted: 120, skippedExisting: 0, batchesDone: 4, batchesTotal: 4 });
    expect(audit.calls.map((c) => c.kind)).toEqual(["requested", "finished"]);
  });

  it("never updates a posting and never writes a source key that is not a manual-upload- key", async () => {
    const text = sheetOf({ link: 12 });
    const { deps, db } = makeDeps();
    await post(text, fieldsFor(text), deps);
    expect(db.updates).toBe(0);
    const key = `manual-upload-20261105-${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
    for (const u of db.upserts) for (const r of u.rows) expect(r.external_source).toBe(key);
  });

  it("an apply_email goes only on an e-mail-only row (with no external_url); a link row has none, and no description holds an address", async () => {
    const text = sheetOf({ link: 2, both: 1, email: 2 });
    const { deps, db } = makeDeps();
    await post(text, fieldsFor(text), deps);
    const rows = db.upserts.flatMap((u) => u.rows);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      if ("apply_email" in r) {
        expect(r.external_url).toBeNull();
        expect(String(r.apply_email)).toMatch(/^hr\d@example\.test$/);
      } else expect(typeof r.external_url).toBe("string");
      expect(String(r.description)).not.toMatch(/@example\.test/);
    }
    expect(rows.filter((r) => "apply_email" in r)).toHaveLength(2);
  });

  it("a row already on Talentrah is skipped by the database and counted, not an error", async () => {
    const text = sheetOf({ link: 3 });
    const { deps, db } = makeDeps();
    const ok = await post(text, fieldsFor(text), deps);
    expect((await ok.json()).inserted).toBe(3);
    const again = makeDeps({ service: () => db as never });
    db.upserts.length = 0;
    const res = await post(text, fieldsFor(text, { importable: "0", batches: "0" }), again.deps);
    expect(res.status).toBe(200);
    expect((await res.json()).inserted).toBe(0);
  });
});

describe("the audit", () => {
  it("writes the requested row BEFORE the first write and the finished row after the last", async () => {
    const text = sheetOf({ link: 15 });
    const { deps, order } = makeDeps();
    await post(text, fieldsFor(text), deps);
    expect(order.events[0]).toBe("audit:requested");
    expect(order.events.indexOf("audit:requested")).toBeLessThan(order.events.indexOf("write"));
    expect(order.events[order.events.length - 1]).toBe("audit:finished");
  });

  it("when the requested row cannot be written NOTHING is written, and the answer is 503", async () => {
    const text = sheetOf({ link: 3 });
    const order = { events: [] as string[] };
    const { deps, db } = makeDeps({}, order);
    deps.audit = fakeAudit(order, { requestedFails: true });
    const res = await post(text, fieldsFor(text), deps);
    expect(res.status).toBe(503);
    expect(db.upserts).toHaveLength(0);
  });

  it("the rows hold counts and codes only: source key, hash prefix, counts, outcome, an error class", async () => {
    const text = sheetOf({ link: 2, both: 1, email: 2 });
    const { deps, audit } = makeDeps();
    await post(text, fieldsFor(text), deps);
    const [requested, finished] = audit.calls;
    expect(Object.keys(requested.detail).sort()).toEqual(["batches", "csv_sha12", "importable", "importable_email_only", "importable_email_plus_link", "importable_link", "rows", "source_key"]);
    expect(Object.keys(finished.detail).sort()).toEqual(["batches_done", "batches_total", "error_class", "inserted", "outcome", "requested_id", "skipped_existing", "source_key"]);
    for (const d of [requested.detail, finished.detail]) for (const v of Object.values(d)) expect(["number", "string"].includes(typeof v) || v === null).toBe(true);
    expect(requested.detail.importable_email_only).toBe(2);
    expect(finished.detail.outcome).toBe("completed");
  });
});

describe("failure halfway", () => {
  const text = sheetOf({ link: 130 });
  it("stops at the first failed batch, sends no later batch, records partial with the counts, and tells the admin to run the same file again", async () => {
    const { deps, db, audit } = makeDeps();
    db.failOnWrite = 3;
    const res = await post(text, fieldsFor(text), deps);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(db.upserts).toHaveLength(3);
    expect(body).toMatchObject({ ok: false, outcome: "partial", inserted: 60, batchesDone: 2, batchesTotal: 4 });
    expect(body.message).toMatch(/run the same file again/i);
    const finished = audit.calls.find((c) => c.kind === "finished")!;
    expect(finished.detail).toMatchObject({ outcome: "partial", inserted: 60, batches_done: 2, batches_total: 4 });
  });

  it("a failure on the first batch is outcome failed, with nothing inserted", async () => {
    const { deps, db, audit } = makeDeps();
    db.failOnWrite = 1;
    const res = await post(text, fieldsFor(text), deps);
    expect((await res.json()).outcome).toBe("failed");
    expect(db.upserts).toHaveLength(1);
    expect(audit.calls.find((c) => c.kind === "finished")!.detail).toMatchObject({ outcome: "failed", inserted: 0 });
  });

  it("running the same file again inserts only the rest (rows already in are skipped by their fingerprint)", async () => {
    const first = makeDeps();
    first.db.failOnWrite = 3;
    await post(text, fieldsFor(text), first.deps);
    expect(first.db.rows.size).toBe(60);
    const second = makeDeps({ service: () => first.db as never });
    first.db.failOnWrite = null;
    first.db.upserts.length = 0;
    const plan = buildPlan(text, { now: NOW });
    const remaining = plan.items.length - 60;
    const res = await post(text, fieldsFor(text, { importable: String(remaining), batches: String(remaining > 10 ? 1 + Math.ceil((remaining - 10) / 50) : 1) }), second.deps);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(first.db.rows.size).toBe(130);
    expect(body.inserted).toBe(70);
    expect(csv([linkRow()]).length).toBeGreaterThan(0);
  });
});
