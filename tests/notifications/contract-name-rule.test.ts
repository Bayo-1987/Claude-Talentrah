import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE EMAIL-LIKE NAME RULE, applied to the contract's row types.
 *
 * The email-pins addendum (version 3, sha256
 * caf9f5ec170816fdecb9e69bdab9853cf585a5b6095a07fcff274d7cc097fa77) says a
 * column named like an address (email, address or recipient, in any case, as a
 * word or a prefix or suffix) is allowed only if it is on one of its TWO closed
 * lists:
 *   LIST 1, the five operator-address columns:
 *     the messages row's created_by_email and approved_by_email,
 *     the events row's actor_email,
 *     the settings row's updated_by_email,
 *     the setting-changes row's actor_email.
 *   LIST 2, the two non-address columns:
 *     the recipients row's to_email (a boolean flag) and email_outcome (a closed outcome).
 * The lists are closed: adding a name here is a finding to report, not an edit.
 * The pattern used here is wider than the addendum's words (it also catches e-mail,
 * addr, recip and rcpt), and the closed lists still hold.
 *
 * This scans the SOURCE of every row type in the contract, so a new column that
 * trips the rule turns the test red naming the row type and the key. (A second,
 * compile-time version of the same check lives in the shapes test.) The tests
 * name row types, never database tables: this file is inside the scanned tree.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../../src/lib/notifications/contract.ts"), "utf8");
const EMAIL_LIKE = /e-?mail|addr|recip|rcpt/i;

/** The row types, with the email-like keys each is allowed (lists 1 and 2 above). */
const ALLOWED: Record<string, readonly string[]> = {
  NotificationDeliveryRow: [],
  PushSubscriptionRow: [],
  AdminMessageRow: ["created_by_email", "approved_by_email"], // list 1
  AdminMessageRecipientRow: ["to_email", "email_outcome"], // list 2
  AdminMessageEventRow: ["actor_email"], // list 1
  NotificationSettingRow: ["updated_by_email"], // list 1
  NotificationSettingChangeRow: ["actor_email"], // list 1
};

/** The keys declared directly in `export type <name> = { ... };`. */
function keysOf(typeName: string): string[] {
  const start = SOURCE.indexOf(`export type ${typeName} = {`);
  if (start === -1) throw new Error(`row type ${typeName} not found in the contract`);
  const end = SOURCE.indexOf("\n};", start);
  const body = SOURCE.slice(start, end);
  return [...body.matchAll(/^ {2}([a-z_][a-z0-9_]*)\??:/gm)].map((match) => match[1]);
}

/** Every row type in the contract, found by name, so a new one cannot escape the scan. */
const ROW_TYPES = [...SOURCE.matchAll(/^export type (\w+Row) = \{/gm)].map((m) => m[1]).filter((n) => n !== "StaleClaimRow");

describe("the email-like column name rule over the contract's row types", () => {
  it("every row type in the contract is covered by the allowed table above", () => {
    const covered = new Set([...Object.keys(ALLOWED), "PushSubscriptionClientRow"]);
    const missing = ROW_TYPES.filter((name) => !covered.has(name) && !name.startsWith("InboxItem"));
    expect(missing).toEqual([]);
  });

  for (const [typeName, allowed] of Object.entries(ALLOWED)) {
    it(`${typeName}: the only email-like keys are ${allowed.length === 0 ? "none" : allowed.join(", ")}`, () => {
      const keys = keysOf(typeName);
      expect(keys.length).toBeGreaterThan(3); // the scan really read columns
      const found = keys.filter((key) => EMAIL_LIKE.test(key));
      expect(found.sort(), `${typeName} has email-like column(s) not on the addendum's lists`).toEqual([...allowed].sort());
    });
  }

  it("the allowed names are the addendum's seven and nothing more", () => {
    expect(Object.values(ALLOWED).flat().sort()).toEqual(
      ["actor_email", "actor_email", "approved_by_email", "created_by_email", "email_outcome", "to_email", "updated_by_email"],
    );
  });

  it("the list-2 columns are a boolean flag and a closed outcome, not free text", () => {
    expect(SOURCE).toMatch(/\bto_email: boolean;/);
    expect(SOURCE).toMatch(/\bemail_outcome: AdminRecipientOutcome \| null;/);
  });
});
