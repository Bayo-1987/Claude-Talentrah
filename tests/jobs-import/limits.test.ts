/**
 * PR-U1: file limits. 2 MB and 1,000 data rows per upload, checked BEFORE anything is planned or written: too large -> 413, too many rows -> 413, a sheet missing required columns -> 400 that
 * names the columns (never a cell), not a text file -> 400.
 */
import { describe, expect, it } from "vitest";
import { handleConfirm, handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, UPLOAD_KEY_PATTERN, uploadSourceKey } from "@/lib/jobs/sheet-import/limits";
import { HEADER, NOW, csv, formRequest, linkRow, makeDeps, sheetOf, sha12 } from "./support";

describe("the limits", () => {
  it("are 2 MB and 1,000 rows", () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_UPLOAD_ROWS).toBe(1000);
  });

  it("the per-upload source key keeps the manual- prefix the stale sweep skips, and is date plus eight hex of the file's hash", () => {
    const key = uploadSourceKey(NOW, "ab".repeat(32));
    expect(key).toBe("manual-upload-20261105-abababab");
    expect(UPLOAD_KEY_PATTERN.test(key)).toBe(true);
    expect(key.startsWith("manual-")).toBe(true);
  });
});

describe.each([["preview", handlePreview, {}], ["confirm", handleConfirm, { sha12: "x", importable: "1", batches: "1", tick: "on" }]] as const)("%s", (name, handler, fields) => {
  it("refuses a file over 2 MB with 413 before reading the form, writing or planning", async () => {
    const { deps, db, audit } = makeDeps();
    const res = await handler(formRequest(name, "a,b\n1,2\n", fields, { contentLength: MAX_UPLOAD_BYTES + 1 + 1024 * 1024 }), deps);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
    expect(db.upserts).toHaveLength(0);
    expect(db.selects).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });

  it("refuses a file whose bytes are over 2 MB even when the length header lied", async () => {
    const { deps, db } = makeDeps();
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(97);
    const res = await handler(formRequest(name, big, fields), deps);
    expect(res.status).toBe(413);
    expect(db.selects).toHaveLength(0);
  });

  it("refuses more than 1,000 data rows with 413, and plans and writes nothing", async () => {
    const { deps, db, audit } = makeDeps();
    const rows = Array.from({ length: MAX_UPLOAD_ROWS + 1 }, () => linkRow());
    const res = await handler(formRequest(name, csv(rows), fields), deps);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_many_rows");
    expect(db.selects).toHaveLength(0);
    expect(db.upserts).toHaveLength(0);
    expect(audit.calls.filter((c) => c.kind === "requested")).toHaveLength(0);
  });

  it("accepts exactly 1,000 rows (the boundary)", async () => {
    const { deps } = makeDeps();
    const rows = Array.from({ length: MAX_UPLOAD_ROWS }, () => linkRow());
    const text = csv(rows);
    const res = await handler(formRequest(name, text, name === "confirm" ? { sha12: sha12(text), importable: "1000", batches: "20", tick: "on" } : {}), deps);
    expect([200, 409]).toContain(res.status);
  });

  it("answers 400 naming the missing columns, and never a cell", async () => {
    const { deps } = makeDeps();
    const header = HEADER.filter((h) => h !== "apply_link" && h !== "deadline");
    const res = await handler(formRequest(name, csv([linkRow({ title: "Secret Cell Title" })], header), fields), deps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("missing_columns");
    expect(body.columns).toEqual(["deadline", "apply_link"]);
    expect(JSON.stringify(body)).not.toContain("Secret Cell Title");
  });

  it("answers 400 for no file, an empty file and a file that is not text", async () => {
    const { deps } = makeDeps();
    expect((await handler(formRequest(name, null, fields), deps)).status).toBe(400);
    expect((await handler(formRequest(name, "", fields), deps)).status).toBe(400);
    expect((await handler(formRequest(name, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]), fields), deps)).status).toBe(400);
  });

  it("a sheet with the header only is fine and plans nothing", async () => {
    const { deps } = makeDeps();
    const res = await handlePreview(formRequest("preview", csv([]), {}), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).preview.counts.importable).toBe(0);
    void sheetOf;
  });
});
