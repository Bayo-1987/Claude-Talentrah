/**
 * ACCT-1 — the account deletion map's own shape, without a database.
 *
 * docs/account-deletion-map.md is read by tests/rls/account-deletion-fk-map.test.ts, which compares it with the live foreign keys and storage
 * buckets. This test keeps the file itself honest where no database is needed: every row parses, every class is one of the defined classes, no key
 * appears twice, and the class agrees with the recorded ON DELETE action (a `delete` is a CASCADE, an `anonymise` or `detach` is a SET NULL, a
 * `block` is NO ACTION or RESTRICT), so the document cannot contradict itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountDeletionMap, ON_DELETE_FOR_CLASS } from "../support/account-deletion-map";

const doc = readFileSync(join(__dirname, "../../docs/account-deletion-map.md"), "utf8");
const map = parseAccountDeletionMap(doc);

describe("docs/account-deletion-map.md", () => {
  it("has foreign-key rows and storage rows", () => {
    expect(map.keys.length).toBeGreaterThan(40);
    expect(map.buckets.map((b) => b.bucket).sort()).toEqual(["job-assessment-exercises", "job-assessment-submissions", "job-banners"]);
  });

  it("lists every key once", () => {
    const names = map.keys.map((k) => k.key);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("uses only the defined classes", () => {
    const allowed = new Set(Object.keys(ON_DELETE_FOR_CLASS));
    expect(map.keys.filter((k) => !allowed.has(k.cls)).map((k) => `${k.key}: ${k.cls}`)).toEqual([]);
  });

  it("never contradicts itself: each class implies its ON DELETE action", () => {
    const bad = map.keys.filter((k) => {
      const ok = ON_DELETE_FOR_CLASS[k.cls];
      return ok && !ok.includes(k.onDelete);
    });
    expect(bad.map((k) => `${k.key}: ${k.cls} but ${k.onDelete}`)).toEqual([]);
  });

  it("gives every block a note naming how it is resolved", () => {
    const blocks = map.keys.filter((k) => k.cls === "block");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.filter((k) => !/PR 3/.test(k.note)).map((k) => k.key)).toEqual([]);
  });

  it("classifies the tables the owner named: money kept anonymised, referrals and sessions kept, personal content deleted", () => {
    const cls = (key: string) => map.keys.find((k) => k.key === key)?.cls;
    expect(cls("payment_transactions.user_id")).toBe("anonymise");
    expect(cls("credit_ledger.user_id")).toBe("anonymise");
    expect(cls("referrals.referrer_id")).toBe("anonymise");
    expect(cls("mentorship_sessions.mentee_id")).toBe("anonymise");
    expect(cls("mentorship_reviews.reviewer_id")).toBe("anonymise");
    expect(cls("resumes.user_id")).toBe("delete");
    expect(cls("farah_messages.user_id")).toBe("delete");
    expect(cls("match_scores.user_id")).toBe("delete");
    expect(cls("profiles.referred_by")).toBe("block");
    expect(cls("organizations.created_by")).toBe("block");
  });
});
