/**
 * N1B FIX finding N3: the rollback of 0273 must run BEFORE the rollback of 0265. Run the other way round, 0265's rollback drops the tables and leaves the three functions 0273 added
 * and the flag_state column behind. The order is stated in the first lines of the rollback file, and this test keeps it there. It reads the file only (no database).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(process.cwd(), "supabase/rollbacks/0273_n1b_followup.rollback.sql"), "utf8");
const head = text.split("\n").slice(0, 12).filter((l) => l.startsWith("--")).join(" ").replace(/\s+/g, " ");

describe("the 0273 rollback says when it must be run", () => {
  it("in its first comment lines: BEFORE the rollback of 0265", () => {
    expect(head).toMatch(/run this file BEFORE supabase\/rollbacks\/0265_notifications_and_admin_messaging\.rollback\.sql/);
  });
  it("and says why: the three added functions and flag_state would be left behind", () => {
    for (const needle of ["create_admin_message", "record_admin_message_progress", "finish_admin_message_send", "flag_state"]) expect(head, needle).toContain(needle);
  });
  it("the first comment line is the title; the statements begin after the comment block", () => {
    expect(text.startsWith("-- Rollback of 0273 (N1B)")).toBe(true);
    expect(/^(drop|do|alter|revoke|grant|create)\b/m.test(text)).toBe(true);
  });
});
