/**
 * The AUTHENTICATED half of the grant check for migration 0207: a signed-in employer, however legitimate, must not be
 * able to call any of the closing-reminder functions or read the reminder table. (The anon half, and everything else,
 * is expiry-reminders-db.test.ts.)
 *
 * CI-BOUND. It needs a real authenticated session (tests/support/auth.ts's sessionFor), which cannot be minted against
 * a hosted project from a developer machine (the JWT key does not match). The same SQL behaviour was verified on the
 * test project with `set local role authenticated` inside a rolled-back transaction; see the PR description.
 *
 * Why it matters: Postgres grants EXECUTE on a new function to PUBLIC by default, and revoking from `anon` and
 * `authenticated` alone leaves that in place. These functions can mark a posting reminded and extend its closing date.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestUser, deleteTestUsers, sessionFor, type DB } from "../../support/auth";

let userId = "";
let client: DB;

beforeAll(async () => {
  const user = await createTestUser("expiryrem-grants");
  userId = user.id;
  client = await sessionFor(user.email, user.id);
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const now = new Date("2030-06-15T19:00:00.000Z").toISOString();
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["expiry_reminder_window_ok", { p_closes_at: now, p_now: now }],
  ["due_job_expiry_reminders", { p_now: now, p_limit: 5 }],
  ["claim_job_expiry_reminder", { p_job_posting_id: randomUUID(), p_token_hash: "x", p_now: now }],
  ["redeem_job_expiry_extend_token", { p_token_hash: "x", p_now: now }],
  ["job_expiry_function_definition", { p_name: "redeem_job_expiry_extend_token" }],
];

describe("an authenticated user", () => {
  it.each(CALLS)("calling %s is refused with permission denied (42501)", async (fn, args) => {
    const res = await client.rpc(fn as never, args as never);
    expect(res.error, `${fn} must not be callable by an authenticated user`).not.toBeNull();
    expect(res.error!.code).toBe("42501");
  });

  it("cannot read job_expiry_reminders: an error, or nothing", async () => {
    const res = await client.from("job_expiry_reminders").select("*");
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
  });

  it("cannot insert into it either", async () => {
    const res = await client
      .from("job_expiry_reminders")
      .insert({ job_posting_id: randomUUID(), closes_at: now, token_hash: randomUUID() });
    expect(res.error).not.toBeNull();
  });
});
