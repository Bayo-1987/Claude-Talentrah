/**
 * The inactive-seekers `days` value, case by case: what the SQL does, and what the fake does with the SAME JSON text. Only the number 30, 60 or 90 is accepted. The JSON text is parsed for the fake
 * (JavaScript has one number type), which is why the number written 30.0 is the one case where the two can differ: see the last test.
 */
import { describe, expect, it } from "vitest";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { A2, FIXTURES, probe, replay0265 } from "./migration-0265-support";
import { A3, OPERATORS, call } from "./migration-0265-admin-support";

const CASES: Array<[string, string, boolean]> = [
  ["the number 30", '{"days":30}', true],
  ["the number 60", '{"days":60}', true],
  ["the number 90", '{"days":90}', true],
  ["the number 3e1 (the value 30)", '{"days":3e1}', true],
  ["the string \"30\"", '{"days":"30"}', false],
  ["the string \"30.0\"", '{"days":"30.0"}', false],
  ["the number 30.0", '{"days":30.0}', false],
  ["the number 30.5", '{"days":30.5}', false],
  ["the number 45", '{"days":45}', false],
  ["the number 0", '{"days":0}', false],
  ["null", '{"days":null}', false],
  ["a missing key", "{}", false],
  ["an object", '{"days":{"a":1}}', false],
  ["an array", '{"days":[30]}', false],
  ["the boolean true", '{"days":true}', false],
];
const r = replay0265(
  [FIXTURES, OPERATORS, ...CASES.map(([, json], i) => probe(`c${i}`, `select count(*) from ${call.resolve("inactive_seekers", json, A2)} s`, "22023"))].join("\n"),
);
describe("days: the SQL against the fake, same JSON text", () => {
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  const fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
  fake.addAdmin(A3, "x@example.test", ["user_messaging"]);
  it.each(CASES.map(([n, j, ok], i) => [n, j, ok, i] as const))("%s: %s", async (_n, json, accepted, i) => {
    const sqlRefused = r.res[`c${i}`] === "ok";
    let fakeRefused = false;
    try {
      await fake.resolveAdminSegment({ p_key: "inactive_seekers", p_params: JSON.parse(json), p_actor: A3 });
    } catch {
      fakeRefused = true;
    }
    console.log(`MATRIX ${json.padEnd(22)} sql=${sqlRefused ? "22023" : "accepted"} fake=${fakeRefused ? "22023" : "accepted"}`);
    if (json === '{"days":30.0}') {
      expect(sqlRefused).toBe(true); // F7: the text 30.0 is refused by the database
    } else {
      expect(sqlRefused).toBe(!accepted);
      expect(fakeRefused).toBe(!accepted);
    }
  });
});
