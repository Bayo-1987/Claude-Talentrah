/**
 * PR-U1: the preview writes nothing and shows no address. It reads only (the fingerprints already on Talentrah), and answers with counts, skip reasons, duplicates, the first 100 lines
 * (line number, title, company, batch, reason) and a preview CSV. No e-mail address, phone number or link appears anywhere in the response, for any kind of row.
 */
import { describe, expect, it } from "vitest";
import { handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { PREVIEW_LINE_LIMIT } from "@/lib/jobs/sheet-import/limits";
import { buildPlan } from "@/lib/jobs/sheet-import/plan";
import { FIXTURE_ADDRESSES, NOW, csv, emailOnly, emailPlusLink, formRequest, linkRow, makeDeps, sha12, sheetOf } from "./support";

async function preview(text: string, over: Parameters<typeof makeDeps>[0] = {}) {
  const made = makeDeps(over);
  const res = await handlePreview(formRequest("preview", text), made.deps);
  const raw = await res.text();
  return { res, raw, body: JSON.parse(raw), ...made };
}

describe("the preview", () => {
  it("counts what the plan counts: rows, importable by kind, batches, and the hash of the file", async () => {
    const text = sheetOf({ link: 3, both: 2, email: 2 });
    const { body } = await preview(text);
    const plan = buildPlan(text, { now: NOW });
    expect(body.ok).toBe(true);
    expect(body.preview.counts.rows).toBe(7);
    expect(body.preview.counts.importable).toBe(plan.counts.importable);
    expect(body.preview.counts.importableByKind).toEqual({ link: 3, emailPlusLink: 2, emailOnly: 2 });
    expect(body.preview.counts.batches).toBe(plan.counts.batches);
    expect(body.preview.sha12).toBe(sha12(text));
    expect(body.preview.sourceKey).toBe(`manual-upload-20261105-${sha12(text).slice(0, 0)}${(await import("node:crypto")).createHash("sha256").update(text).digest("hex").slice(0, 8)}`);
  });

  it("reports skip reasons as counts: an invalid address, a rejected link, a missing title, a passed deadline", async () => {
    const text = csv([
      linkRow(),
      emailOnly(1, { apply_email: "not an address" }),
      linkRow({ apply_link: "http://careers.example.test/x" }),
      linkRow({ title: "" }),
      linkRow({ deadline: "1 Oct 2026" }),
    ]);
    const { body } = await preview(text);
    const reasons = body.preview.counts.skippedByReason;
    expect(reasons["email address is not one plain address"]).toBe(1);
    expect(reasons["link rejected: not https"]).toBe(1);
    expect(reasons["missing title or company"]).toBe(1);
    expect(reasons["deadline already passed"]).toBe(1);
    expect(body.preview.counts.importable).toBe(1);
  });

  it("counts a job listed twice in the file, and a job already on Talentrah (read-only), separately", async () => {
    const dup = linkRow({ title: "Same", company: "Same Co", apply_link: "https://careers.example.test/same" });
    const text = csv([dup, { ...dup, id: "99" }, linkRow({ title: "Known", company: "Known Co" }), linkRow()]);
    const known = buildPlan(text, { now: NOW }).items.find((i) => i.insert.title === "Known")!.insert.dedup_fingerprint;
    const made = makeDeps();
    made.db.rows.set(known, {});
    const res = await handlePreview(formRequest("preview", text), made.deps);
    const body = await res.json();
    expect(body.preview.counts.inFileDuplicates).toBe(1);
    expect(body.preview.counts.alreadyOnTalentrah).toBe(1);
    expect(body.preview.counts.importable).toBe(2);
    expect(made.db.upserts).toHaveLength(0);
  });

  it("writes nothing and writes no audit row (it only reads)", async () => {
    const { db, audit } = await preview(sheetOf({ link: 2, both: 1, email: 1 }));
    expect(db.upserts).toHaveLength(0);
    expect(db.updates).toBe(0);
    expect(audit.calls).toHaveLength(0);
    expect(db.selects.length).toBeGreaterThan(0);
  });

  it("asks which fingerprints exist in chunks of at most 200", async () => {
    const rows = Array.from({ length: 450 }, () => linkRow());
    const { db } = await preview(csv(rows));
    expect(db.selects.map((s) => s.length)).toEqual([200, 200, 50]);
  });

  it("shows no e-mail address, phone number, link or link host anywhere in the response, for every kind of row", async () => {
    const { raw, body } = await preview(sheetOf({ link: 3, both: 2, email: 3 }));
    const everything = raw + JSON.stringify(body);
    for (const secret of FIXTURE_ADDRESSES) expect(everything.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    expect(everything).not.toMatch(/@|https?:|mailto|www\./i);
    expect(body.preview.previewCsv).not.toMatch(/@|https?:/);
  });

  it("hides a title or company that itself contains an address", async () => {
    const { body } = await preview(csv([linkRow({ title: "Write to boss@example.test today", company: "Visit https://careers.example.test now" })]));
    const text = JSON.stringify(body);
    expect(text).not.toContain("boss@example.test");
    expect(text).not.toContain("careers.example.test");
  });

  it("lists at most the first 100 lines, each with its line number, batch and reason", async () => {
    const rows = Array.from({ length: PREVIEW_LINE_LIMIT + 20 }, () => linkRow());
    const { body } = await preview(csv(rows));
    expect(body.preview.lines).toHaveLength(PREVIEW_LINE_LIMIT);
    expect(body.preview.lines[0]).toEqual({ line: 2, title: expect.any(String), company: expect.any(String), batch: 1, reason: "" });
    expect(body.preview.truncated).toBe(true);
  });

  it("says plainly that the rows go live on the public feed at once", async () => {
    const { body } = await preview(sheetOf({ link: 1 }));
    expect(body.preview.notice).toMatch(/public feed/i);
    expect(body.preview.notice).toMatch(/at once|immediately/i);
  });

  it("an apply_email never appears on a plan item for a link row, and always does for an e-mail-only row (the rules the uploader reuses)", () => {
    const plan = buildPlan(csv([linkRow(), emailPlusLink(1), emailOnly(1)]), { now: NOW });
    const byKind = Object.fromEntries(plan.items.map((i) => [i.preview.kind, i.insert]));
    expect("apply_email" in byKind["link"]).toBe(false);
    expect("apply_email" in byKind["email+link"]).toBe(false);
    expect(byKind["email"].apply_email).toBe("hr1@example.test");
    expect(byKind["email"].external_url).toBeNull();
  });
});
