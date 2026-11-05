/**
 * Apply by email for the jobs-sheet import (PR-E3). An e-mail-only row is now built: its address goes into job_postings.apply_email, normalised by the same helper the pages use, so the
 * job page can show "Apply by email" for it. The owner's rule: the address is never printed as text on the page or in the description, so the stored description never holds it.
 *
 * What is pinned: a valid e-mail-only row becomes an external, link-less posting with the normalised address; a row whose address is not one plain address is skipped with a named reason and
 * never repaired; a row with an apply link never gets an apply_email; the description holds no address (no "Email:" line, the row's address replaced by "(see Apply by email)" wherever it
 * appears, in any letter case); the dedup fingerprint is the one the importer always used; the preview file still shows no address; and the insert is still insert-only.
 * Everything is a SYNTHETIC sheet built here (every address ends in example.test); the real CSV is read only by the operator's preview run.
 */
import { describe, expect, it } from "vitest";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";
import { buildPlan, insertBatch, renderPreview, type ImportClient, type JobInsert } from "../../scripts/import-jobs-sheet";
import { composeDescription, readSheet } from "../../scripts/jobs-sheet-import/parse";

const NOW = new Date("2026-11-03T12:00:00Z");
const HEADER = ["id", "origin", "method", "title", "company", "location", "salary", "date_posted", "deadline", "summary", "description", "requirements", "qualifications", "apply_email", "apply_phone", "apply_link", "apply_text"];
type Cells = Partial<Record<(typeof HEADER)[number], string>>;
const SEE = "(see Apply by email)";
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

let seq = 0;
function row(over: Cells = {}): Cells {
  seq++;
  return { id: String(seq), origin: "recheck", method: "Email", title: `Email Role ${seq}`, company: `Email Co ${seq}`, location: "Lagos", salary: "", date_posted: "2 Nov 2026", deadline: "", summary: `Summary ${seq}.`, description: "", requirements: "", qualifications: "", apply_email: "", apply_phone: "", apply_link: "", apply_text: "", ...over };
}
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const csv = (rows: Cells[]) => [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => quote(r[h] ?? "")).join(","))].join("\r\n") + "\r\n";
const emailOnly = (over: Cells = {}) => row({ apply_email: "hr@example.test", apply_text: "Email hr@example.test.", ...over });
const linkRow = (over: Cells = {}) => row({ method: "Link", apply_link: `https://careers.example.test/jobs/${seq + 1}`, apply_text: "Apply at the link.", ...over });
const emailPlusLink = (over: Cells = {}) => linkRow({ method: "Email", apply_email: "jobs@example.test", apply_text: "Send your resume to jobs@example.test or use the link.", ...over });
const plan = (rows: Cells[]) => buildPlan(csv(rows), { now: NOW });

describe("an e-mail-only row is built with the normalised address", () => {
  it("becomes an external posting with no link and apply_email set to the normalised address", () => {
    const p = plan([emailOnly({ title: "Support Lead", company: "Acme", apply_email: "  Careers@Example.TEST " })]);
    expect(p.items).toHaveLength(1);
    const insert = p.items[0].insert;
    expect(insert.apply_email).toBe("careers@example.test");
    expect(insert.external_url).toBeNull();
    expect(insert.source_type).toBe("external");
    expect(insert.organization_id).toBeNull();
    expect(insert.status).toBe("open");
    expect(p.preview[0]).toMatchObject({ kind: "email", applyMethodType: "email", skipReason: "", batch: 1 });
  });

  it("keeps the dedup fingerprint the importer always used (company + title + first location)", () => {
    const p = plan([emailOnly({ title: "Support Lead", company: "Acme", location: "Lagos | Abuja" })]);
    expect(p.items[0].insert.dedup_fingerprint).toBe(computeDedupFingerprint("Acme", "Support Lead", "Lagos"));
  });

  it("two e-mail-only rows of one company, title and place but different addresses are two jobs; the same address is one", () => {
    const base = { title: "Clerk", company: "Same Co", location: "Lagos" };
    const different = plan([emailOnly({ ...base, apply_email: "a@example.test" }), emailOnly({ ...base, apply_email: "b@example.test" })]);
    expect(different.items).toHaveLength(2);
    expect(new Set(different.items.map((i) => i.insert.dedup_fingerprint)).size).toBe(2);
    const same = plan([emailOnly({ ...base, apply_email: "a@example.test" }), emailOnly({ ...base, apply_email: "A@Example.test" })]);
    expect(same.items).toHaveLength(1);
    expect(same.counts.skippedByReason["duplicate of an earlier row in this import"]).toBe(1);
  });

  it("is ordered after the link rows and the e-mail-plus-link rows, so the canary and the earlier batches are unchanged", () => {
    const p = plan([emailOnly({ title: "E1" }), linkRow({ title: "L1" }), emailPlusLink({ title: "B1" }), emailOnly({ title: "E2" }), linkRow({ title: "L2" })]);
    expect(p.items.map((i) => i.insert.title)).toEqual(["L1", "L2", "B1", "E1", "E2"]);
  });
});

describe("a row whose address is not one plain address is skipped, never repaired", () => {
  const REASON = "email address is not one plain address";
  it.each([
    ["two addresses", "a@example.test, b@example.test"],
    ["two addresses with a semicolon", "a@example.test; b@example.test"],
    ["a display name", "Careers <a@example.test>"],
    ["a space inside", "a b@example.test"],
    ["no top-level part", "a@example"],
    ["a query tail", "a@example.test?cc=x"],
    ["a mailto prefix", "mailto:a@example.test"],
    ["two dots in a row", "a..b@example.test"],
    ["a non-ASCII letter", "é@example.test"],
    ["no @", "careers.example.test"],
  ])("skips %s with the named reason", (_name, address) => {
    const p = plan([emailOnly({ title: "Skipped", apply_email: address, apply_text: "" })]);
    expect(p.items).toHaveLength(0);
    expect(p.preview[0].skipReason).toBe(REASON);
    expect(p.counts.skippedByReason[REASON]).toBe(1);
    expect(p.counts.importable).toBe(0);
  });

  it("skips only that row; a valid row beside it is still built", () => {
    const p = plan([emailOnly({ title: "Bad", apply_email: "x@y" }), emailOnly({ title: "Good", apply_email: "ok@example.test" })]);
    expect(p.items.map((i) => i.insert.title)).toEqual(["Good"]);
  });
});

describe("a row with an apply link never gets an apply_email", () => {
  it("a link row and an e-mail-plus-link row carry no apply_email key at all", () => {
    const p = plan([linkRow({ title: "L" }), emailPlusLink({ title: "B" })]);
    expect(p.items).toHaveLength(2);
    for (const item of p.items) {
      expect("apply_email" in item.insert, item.insert.title).toBe(false);
      expect(item.insert.external_url).toMatch(/^https:\/\//);
    }
  });

  it("an e-mail-plus-link row with an address that is not one plain address is still built from its link", () => {
    const p = plan([emailPlusLink({ title: "B", apply_email: "a@example.test, b@example.test" })]);
    expect(p.items).toHaveLength(1);
    expect("apply_email" in p.items[0].insert).toBe(false);
  });
});

describe("the stored description never holds the address", () => {
  const descriptionOf = (over: Cells) => plan([emailOnly(over)]).items[0].insert.description;

  it("drops the 'Email:' line and replaces the address inside the apply text", () => {
    const d = descriptionOf({ apply_text: "Send your resume to hr@example.test today." });
    expect(d).not.toContain("hr@example.test");
    expect(d).not.toContain("Email:");
    expect(d).toContain(`Send your resume to ${SEE} today.`);
  });

  it("adds no 'Email:' line when the apply text does not mention the address", () => {
    const d = descriptionOf({ apply_text: "See the job board." });
    expect(d).not.toContain("hr@example.test");
    expect(d).not.toContain("Email:");
    expect(d).toContain("See the job board.");
  });

  it("replaces the address in the other text of the row too (summary, description, requirements, qualifications), in any letter case", () => {
    const d = descriptionOf({ summary: "Write to HR@Example.test now.", description: "Or hr@example.test.", requirements: "Mail Hr@example.TEST", qualifications: "hr@example.test", apply_text: "hr@EXAMPLE.test" });
    expect(d.toLowerCase()).not.toContain("hr@example.test");
    expect(d.split(SEE)).toHaveLength(6);
  });

  it("replaces every address written in the row's own address field, even when the row is skipped for it elsewhere", () => {
    const sheet = readSheet(csv([emailPlusLink({ apply_email: "a@example.test; b@example.test", apply_text: "Mail a@example.test or b@example.test." })]));
    const d = composeDescription(sheet[0], [], true);
    expect(d).not.toMatch(/@example\.test/);
    expect(d).toContain(`Mail ${SEE} or ${SEE}.`);
  });

  it("keeps a phone number as written, and the source line", () => {
    const d = descriptionOf({ apply_phone: "0800 000 0000", apply_text: "Call or write to hr@example.test." });
    expect(d).toContain("Phone: 0800 000 0000");
    expect(d).toContain("Listed from public job boards");
  });

  it("holds no address-shaped text for any planned row of a mixed sheet", () => {
    const p = plan([emailOnly(), emailPlusLink(), linkRow({ apply_email: "x@example.test", apply_text: "Mail x@example.test." }), emailOnly({ summary: "Mail HR@example.test", apply_text: "HR@EXAMPLE.TEST" })]);
    expect(p.items.length).toBe(4);
    for (const item of p.items) expect(item.insert.description.match(EMAIL_SHAPED) ?? [], item.insert.title).toEqual([]);
  });
});

describe("the preview file still shows no address, and the insert is still insert-only", () => {
  it("renders no @ for e-mail rows built or skipped", () => {
    const text = renderPreview(plan([emailOnly(), emailOnly({ apply_email: "bad@x" }), emailPlusLink(), linkRow()]));
    expect(text).not.toMatch(/@|mailto|example\.test/);
    expect(text.split("\n")[0]).toBe("title,company,kind,apply_method_type,external_key,batch,skip_reason");
  });

  it("an e-mail row goes through the same upsert: ON CONFLICT (dedup_fingerprint) DO NOTHING, nothing updated", async () => {
    const calls: Array<{ rows: JobInsert[]; options: unknown }> = [];
    const client = {
      from: () => ({
        upsert: (rows: JobInsert[], options: unknown) => {
          calls.push({ rows, options });
          return { select: async () => ({ data: rows.map((_r, i) => ({ id: String(i) })), error: null }) };
        },
        update: () => {
          throw new Error("an import never updates");
        },
        select: () => {
          throw new Error("not used");
        },
      }),
    } as unknown as ImportClient;
    const p = plan([emailOnly(), emailOnly()]);
    const result = await insertBatch(client, p.items.map((i) => i.insert));
    expect(result.inserted).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toEqual({ onConflict: "dedup_fingerprint", ignoreDuplicates: true });
    expect(calls[0].rows.every((r) => typeof r.apply_email === "string")).toBe(true);
  });
});
