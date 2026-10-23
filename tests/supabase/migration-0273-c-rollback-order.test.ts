/**
 * N1B FIX finding N3 (corrected by N1B-NOTES-1 F3): the rollback of 0273 should run BEFORE the rollback of 0265. What was MEASURED on a real local stack, in scratch databases, both orders:
 *   0273's rollback first, then 0265's: after the first the seven tables and the six 0265 functions I looked at are still there and the three functions 0273 added are gone; after the second nothing remains.
 *   0265's rollback first, then 0273's: after the first the seven tables are gone (flag_state goes with admin_message_events) and the three functions 0273 added are STILL THERE; after the second nothing remains.
 * So the order changes what is left between the two steps, not the end. The first lines of the rollback file say exactly that, and this test keeps them true. It reads the file only (no database).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const text = readFileSync(join(process.cwd(), "supabase/rollbacks/0273_n1b_followup.rollback.sql"), "utf8");
const head = text.split("\n").slice(0, 14).filter((l) => l.startsWith("--")).join(" ").replace(/\s+/g, " ");

describe("the 0273 rollback says when it should be run, and says only what was measured", () => {
  it("in its first comment lines: BEFORE the rollback of 0265", () => {
    expect(head).toMatch(/run this file BEFORE supabase\/rollbacks\/0265_notifications_and_admin_messaging\.rollback\.sql/);
  });
  it("the measured difference: run the other way round, 0265's rollback leaves the three added functions in place until this file is run", () => {
    expect(head).toMatch(/0265's rollback drops the seven tables and leaves the three functions 0273 added \(create_admin_message, record_admin_message_progress, finish_admin_message_send\) in place/);
    expect(head).toMatch(/in either order nothing of them remains after both files/i);
  });
  it("and that the flag_state column is not left behind: it goes with its table", () => {
    expect(head).toMatch(/the flag_state column is not left behind \(flag_state goes with admin_message_events\)/);
  });
  it("the three functions stay in place only until this file is run (not for good)", () => {
    expect(head).toMatch(/in place until this file is run;/);
  });
  it("the reversed wordings are not there: a column that IS left behind, functions in place for good", () => {
    expect(head).not.toMatch(/\bis left behind\b/);
    expect(head).not.toMatch(/\bleft behind\b(?<!not left behind)/);
    expect(head).not.toMatch(/in place for good/);
  });
  it("the false claim (a column left behind, on the strength of a review) is not there", () => {
    expect(head).not.toMatch(/and the flag_state column/);
    expect(head).not.toMatch(/FIX review/);
    expect(head).not.toMatch(/not independent/);
  });
  it("the first comment line is the title; the statements begin after the comment block", () => {
    expect(text.startsWith("-- Rollback of 0273 (N1B)")).toBe(true);
    expect(/^(drop|do|alter|revoke|grant|create)\b/m.test(text)).toBe(true);
  });
});
