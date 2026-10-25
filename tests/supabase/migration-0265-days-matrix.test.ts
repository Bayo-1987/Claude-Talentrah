/**
 * The segment parameters, case by case: what the SQL does and what the fake does with the SAME JSON text. Both sides are held to the EXACT outcome: an accepted value must run without any error
 * (a permission error or a 22P02 is a failure, not "accepted"), and a refused value must be SQLSTATE 22023 exactly. Replayed cumulatively (0265 then 0273) in a private scratch database.
 *
 *  days   only the number 30, 60 or 90
 *  since  a JSON string YYYY-MM-DD that is a real calendar date
 * JavaScript has one number type, so the number written 30.0 is the one case where the two sides can differ: the SQL refuses it (F7), the fake receives 30.
 */
import { describe, expect, it } from "vitest";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { A2, FIXTURES, probe, replay0265 } from "./migration-0265-support";
import { A3, OPERATORS, call } from "./migration-0265-admin-support";

type Case = [name: string, json: string, accepted: boolean, differsInFake?: true];
const DAYS: Case[] = [
  ["the number 30", '{"days":30}', true],
  ["the number 60", '{"days":60}', true],
  ["the number 90", '{"days":90}', true],
  ["the number 3e1 (the value 30)", '{"days":3e1}', true],
  ["the string \"30\"", '{"days":"30"}', false],
  ["the string \"30.0\"", '{"days":"30.0"}', false],
  ["the number 30.0 (JavaScript cannot tell it from 30)", '{"days":30.0}', false, true],
  ["the number 30.5", '{"days":30.5}', false],
  ["the number 45", '{"days":45}', false],
  ["the number 0", '{"days":0}', false],
  ["null", '{"days":null}', false],
  ["a missing key", "{}", false],
  ["an object", '{"days":{"a":1}}', false],
  ["an array", '{"days":[30]}', false],
  ["the boolean true", '{"days":true}', false],
];
const SINCE: Case[] = [
  ["a date", '{"since":"2026-10-01"}', true],
  ["a leap day", '{"since":"2024-02-29"}', true],
  ["the first day of the year 1", '{"since":"0001-01-01"}', true],
  ["29 February in a common year", '{"since":"2026-02-29"}', false],
  ["month 13", '{"since":"2026-13-01"}', false],
  ["day 32", '{"since":"2026-10-32"}', false],
  ["day 00", '{"since":"2026-10-00"}', false],
  ["year 0000", '{"since":"0000-01-01"}', false],
  ["the layout 10/01/2026", '{"since":"10/01/2026"}', false],
  ["single-digit month and day", '{"since":"2026-1-1"}', false],
  ["a date with a time", '{"since":"2026-10-01T00:00:00Z"}', false],
  ["a leading space", '{"since":" 2026-10-01"}', false],
  ["a trailing newline", '{"since":"2026-10-01\\n"}', false],
  ["the empty string", '{"since":""}', false],
  ["a number", '{"since":20261001}', false],
  ["null", '{"since":null}', false],
  ["a missing key", "{}", false],
  ["the boolean true", '{"since":true}', false],
  ["an object", '{"since":{"a":1}}', false],
  ["an array", '{"since":["2026-10-01"]}', false],
];

const r = replay0265(
  [
    FIXTURES,
    OPERATORS,
    ...DAYS.map(([, json], i) => probe(`d${i}`, `select count(*) from ${call.resolve("inactive_seekers", json, A2)} s`, "22023")),
    ...DAYS.map(([, json], i) => `select 'R|dx${i}|' || coalesce((select pg_temp.errtext('select count(*) from ${call.resolve("inactive_seekers", json, A2).replace(/'/g, "''")} s')), 'x');`),
    ...SINCE.map(([, json], i) => probe(`s${i}`, `select count(*) from ${call.resolve("signed_up_since", json, A2)} s`, "22023")),
    ...SINCE.map(([, json], i) => `select 'R|sx${i}|' || coalesce((select pg_temp.errtext('select count(*) from ${call.resolve("signed_up_since", json, A2).replace(/'/g, "''")} s')), 'x');`),
  ].join("\n"),
);

const fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
fake.addAdmin(A3, "x@example.test", ["user_messaging"]);
const fakeOutcome = async (key: "inactive_seekers" | "signed_up_since", json: string) => {
  try {
    await fake.resolveAdminSegment({ p_key: key, p_params: JSON.parse(json), p_actor: A3 });
    return "accepted";
  } catch (e) {
    return e instanceof NotificationDbError ? e.info.sqlstate ?? "no sqlstate" : `NOT A DATABASE ERROR: ${String(e)}`;
  }
};

describe.each([
  ["days", DAYS, "d", "dx", "inactive_seekers"],
  ["since", SINCE, "s", "sx", "signed_up_since"],
] as const)("%s: the SQL against the fake, same JSON text, exact outcomes", (_name, cases, probeKey, textKey, key) => {
  it("the replay applies", () => expect(r.ok, r.stderr).toBe(true));
  it.each(cases.map((c, i) => [c[0], c[1], c[2], c[3] ?? false, i] as const))("%s: %s", async (_n, json, accepted, differs, i) => {
    // SQL: an accepted value runs to the end (the error text probe answers nothing wrong); a refused one is 22023 and nothing else
    if (accepted) expect(r.res[`${probeKey}${i}`], `sql ${json}`).toBe("NOT REFUSED");
    else expect(r.res[`${probeKey}${i}`], `sql ${json} (got ${r.res[`${textKey}${i}`]})`).toBe("ok");
    const fakeOutcomeNow = await fakeOutcome(key, json);
    console.log(`MATRIX ${key} ${json.padEnd(34)} sql=${accepted ? "accepted" : "22023"} fake=${fakeOutcomeNow}`);
    if (differs) expect(fakeOutcomeNow, `fake ${json}`).toBe("accepted");
    else expect(fakeOutcomeNow, `fake ${json}`).toBe(accepted ? "accepted" : "22023");
  });
});
