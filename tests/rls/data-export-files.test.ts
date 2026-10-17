/**
 * Migration 0263 against a real database (the local stack): the state row of an admin-produced data export and the six functions that move it.
 *
 *   - CLOSED TO CLIENTS: anon and a signed-in user can neither read nor write the table nor execute any function (42501); service_role can.
 *   - ONE LIVE EXPORT PER PERSON: a partial unique index over generating/generated; two inserts at the same moment leave exactly one row and one 23505.
 *   - THE ROW'S OWN RULES (CHECKs): the path is exactly <id>/<attempt>.json; a generated row has a file and an end date; a generating row has neither.
 *   - THE CLAIM IS THE SINGLE USE: owner only, once, before expiry, never while generating; six parallel claims produce exactly one winner.
 *   - THE ATTEMPT STATE MACHINE (T-A1, T-A3, T-A5 at the database): a stale generating row is swapped to a new attempt in ONE statement (two concurrent swaps: one winner); a young one is
 *     not; a late finish from a cancelled attempt changes nothing; the finish sets a 72-hour end.
 *   - CANCEL (T-B1, T-B1b): a generated, unclaimed export is cancelled once (two concurrent cancels: one winner); claimed, expired, deleted, cancelled and generating rows are not cancellable; it frees the slot.
 *   - DELETION: removing the person removes the row (the FK is ON DELETE CASCADE).
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createAuthedTestUser, createTestUser, deleteTestUsers, admin, type TestUser } from "../support/auth";
import { ageAttempt, deleteRowsFor, finish, getRow, insertGenerating, pathFor, setRow, svc } from "../support/data-export-db";
import type { SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

let owner: TestUser & { client: SupabaseClient };
let other: TestUser & { client: SupabaseClient };
const made: string[] = [];
/** Accounts made by the current test only: released after it, so the file never holds more than a few of the pool's 40 (see tests/support/data-export-fixtures.ts releaseCreated). */
const perTest: string[] = [];
const fresh = async (prefix: string) => {
  const u = await createTestUser(prefix);
  perTest.push(u.id);
  return u;
};

const claim = async (id: string, user: string) => {
  const { data, error } = await svc.rpc("claim_data_export_download", { p_export_id: id, p_user_id: user });
  expect(error, `claim: ${error?.message}`).toBeNull();
  return data as string | null;
};
const swap = async (id: string, oldA: string, newA: string) => {
  const { data, error } = await svc.rpc("swap_stale_data_export_attempt", { p_export_id: id, p_old_attempt: oldA, p_new_attempt: newA });
  expect(error, `swap: ${error?.message}`).toBeNull();
  return data as Array<{ export_id: string; new_attempt_id: string }>;
};
const cancelUnused = async (id: string, user: string) => {
  const { data, error } = await svc.rpc("cancel_unused_data_export", { p_export_id: id, p_user_id: user });
  expect(error, `cancel_unused: ${error?.message}`).toBeNull();
  return data as string | null;
};

beforeAll(async () => {
  owner = (await createAuthedTestUser("dx-owner")) as typeof owner;
  other = (await createAuthedTestUser("dx-other")) as typeof other;
  made.push(owner.id, other.id);
}, 120_000);

afterEach(async () => {
  const ids = perTest.splice(0);
  await deleteRowsFor(ids);
  await deleteTestUsers(ids);
}, 60_000);

afterAll(async () => {
  await deleteRowsFor(made);
  await deleteTestUsers(made);
});

describe("closed to clients", () => {
  it("anon and a signed-in user cannot read or write the table", async () => {
    for (const client of [anon, owner.client]) {
      const read = await client.from("data_export_files" as never).select("*");
      expect(read.error?.code, "select").toBe("42501");
      const ins = await client.from("data_export_files" as never).insert({ user_id: owner.id, attempt_id: randomUUID() } as never);
      expect(ins.error?.code, "insert").toBe("42501");
      const upd = await client.from("data_export_files" as never).update({ status: "failed" } as never).eq("user_id", owner.id);
      expect(upd.error?.code, "update").toBe("42501");
      const del = await client.from("data_export_files" as never).delete().eq("user_id", owner.id);
      expect(del.error?.code, "delete").toBe("42501");
    }
  });

  it("anon and a signed-in user cannot execute any of the six functions", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["claim_data_export_download", { p_export_id: randomUUID(), p_user_id: owner.id }],
      ["swap_stale_data_export_attempt", { p_export_id: randomUUID(), p_old_attempt: randomUUID(), p_new_attempt: randomUUID() }],
      ["finish_data_export_attempt", { p_export_id: randomUUID(), p_attempt_id: randomUUID(), p_object_path: "x" }],
      ["cancel_stale_data_exports", {}],
      ["cancel_unused_data_export", { p_export_id: randomUUID(), p_user_id: owner.id }],
      ["mark_data_export_object_deleted", { p_export_id: randomUUID(), p_attempt_id: randomUUID() }],
    ];
    for (const client of [anon, owner.client]) {
      for (const [fn, args] of calls) {
        const r = await client.rpc(fn as never, args as never);
        expect(r.error?.code, `${fn} as a client`).toBe("42501");
      }
    }
  });
});

describe("one live export per person", () => {
  it("a second live insert for the same person is refused with 23505", async () => {
    const u = await fresh("dx-live");
    await insertGenerating(u.id);
    await expect(insertGenerating(u.id)).rejects.toThrow(/duplicate key|23505|one_live/);
  });

  it("two inserts at the same moment leave exactly one row and exactly one refusal (23505)", async () => {
    const u = await fresh("dx-race");
    const results = await Promise.all([0, 1].map(() =>
      (svc.from("data_export_files").insert({ id: randomUUID(), user_id: u.id, attempt_id: randomUUID() }) as unknown as PromiseLike<{ error: { code?: string } | null }>)));
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error?.code === "23505")).toHaveLength(1);
    const { data } = await (svc.from("data_export_files").select("id").eq("user_id", u.id) as unknown as PromiseLike<{ data: unknown[] }>);
    expect(data).toHaveLength(1);
  });

  it("a finished row (failed, cancelled, downloaded...) does not hold the slot", async () => {
    const u = await fresh("dx-free");
    for (const status of ["failed", "downloaded", "expired", "deleted", "cancelled"]) {
      const a = await insertGenerating(u.id);
      await setRow(a.id, { status });
    }
    await expect(insertGenerating(u.id)).resolves.toBeTruthy();
  });
});

describe("the row's own rules", () => {
  it("the path must be exactly <id>/<attempt>.json", async () => {
    const u = await fresh("dx-path");
    const a = await insertGenerating(u.id);
    const bad = await (svc.from("data_export_files").update({ status: "generated", object_path: `${a.id}.json`, expires_at: new Date().toISOString() }).eq("id", a.id) as unknown as PromiseLike<{ error: { code?: string } | null }>);
    expect(bad.error?.code).toBe("23514");
    const ok = await (svc.from("data_export_files").update({ status: "generated", object_path: pathFor(a.id, a.attempt), expires_at: new Date().toISOString() }).eq("id", a.id) as unknown as PromiseLike<{ error: { code?: string } | null }>);
    expect(ok.error).toBeNull();
  });

  it("a generated row needs a file and an end date; a generating row may have neither set", async () => {
    const u = await fresh("dx-shape");
    const a = await insertGenerating(u.id);
    const noFile = await (svc.from("data_export_files").update({ status: "generated" }).eq("id", a.id) as unknown as PromiseLike<{ error: { code?: string } | null }>);
    expect(noFile.error?.code).toBe("23514");
    const early = await (svc.from("data_export_files").update({ expires_at: new Date().toISOString() }).eq("id", a.id) as unknown as PromiseLike<{ error: { code?: string } | null }>);
    expect(early.error?.code).toBe("23514");
  });

  it("an unknown status is refused", async () => {
    const u = await fresh("dx-status");
    const a = await insertGenerating(u.id);
    const r = await (svc.from("data_export_files").update({ status: "ready" }).eq("id", a.id) as unknown as PromiseLike<{ error: { code?: string } | null }>);
    expect(r.error?.code).toBe("23514");
  });
});

describe("the finish", () => {
  it("sets the file, the status and a 72-hour end, once", async () => {
    const u = await fresh("dx-finish");
    const a = await insertGenerating(u.id);
    const before = Date.now();
    const expires = await finish(a.id, a.attempt);
    expect(expires).toBeTruthy();
    const hours = (new Date(expires!).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
    const row = await getRow(a.id);
    expect(row).toMatchObject({ status: "generated", object_path: pathFor(a.id, a.attempt) });
    expect(await finish(a.id, a.attempt), "a second finish matches nothing").toBeNull();
  });

  it("T-A3: a late finish from a cancelled attempt cannot mark the export ready", async () => {
    const u = await fresh("dx-late");
    const A = await insertGenerating(u.id);
    await ageAttempt(A.id, 20);
    const B = randomUUID();
    expect(await swap(A.id, A.attempt, B)).toHaveLength(1);
    expect(await finish(A.id, A.attempt), "attempt A's finish").toBeNull();
    const row = await getRow(A.id);
    expect(row).toMatchObject({ status: "generating", attempt_id: B, object_path: null, expires_at: null });
  });
});

describe("the stale-attempt swap", () => {
  it("T-A1: a row older than 15 minutes is handed to a new attempt; a younger one is not", async () => {
    const u = await fresh("dx-swap");
    const A = await insertGenerating(u.id);
    const B = randomUUID();
    await ageAttempt(A.id, 14);
    expect(await swap(A.id, A.attempt, B), "14 minutes is not stale").toEqual([]);
    expect((await getRow(A.id))!.attempt_id).toBe(A.attempt);
    await ageAttempt(A.id, 16);
    expect(await swap(A.id, A.attempt, B)).toEqual([{ export_id: A.id, new_attempt_id: B }]);
    const row = (await getRow(A.id))!;
    expect(row.attempt_id).toBe(B);
    expect(Date.now() - new Date(row.attempt_started_at).getTime(), "the new attempt starts now").toBeLessThan(60_000);
  });

  it("T-A5 (database): two swaps at the same moment on the same stale row: exactly one wins and the row ends with the winner's attempt", async () => {
    const u = await fresh("dx-swaprace");
    const A = await insertGenerating(u.id);
    await ageAttempt(A.id, 30);
    const b1 = randomUUID();
    const b2 = randomUUID();
    const [r1, r2] = await Promise.all([swap(A.id, A.attempt, b1), swap(A.id, A.attempt, b2)]);
    expect(r1.length + r2.length).toBe(1);
    const winner = r1.length ? b1 : b2;
    expect((await getRow(A.id))!.attempt_id).toBe(winner);
  });

  it("a swap needs the CURRENT attempt id, a different new one, and a generating row", async () => {
    const u = await fresh("dx-swapguard");
    const A = await insertGenerating(u.id);
    await ageAttempt(A.id, 30);
    expect(await swap(A.id, randomUUID(), randomUUID()), "wrong old attempt").toEqual([]);
    expect(await swap(A.id, A.attempt, A.attempt), "same attempt").toEqual([]);
    await setRow(A.id, { status: "failed" });
    expect(await swap(A.id, A.attempt, randomUUID()), "not generating").toEqual([]);
  });
});

describe("cancel_stale_data_exports (the sweep's rule)", () => {
  it("fails only generating rows older than 15 minutes and says which", async () => {
    const stale = await fresh("dx-stale1");
    const young = await fresh("dx-stale2");
    const S = await insertGenerating(stale.id);
    const Y = await insertGenerating(young.id);
    await ageAttempt(S.id, 20);
    const { data, error } = await svc.rpc("cancel_stale_data_exports");
    expect(error).toBeNull();
    const rows = data as Array<{ export_id: string; user_id: string; attempt_id: string }>;
    expect(rows.filter((r) => r.export_id === S.id)).toEqual([{ export_id: S.id, user_id: stale.id, attempt_id: S.attempt }]);
    expect(rows.find((r) => r.export_id === Y.id)).toBeUndefined();
    expect((await getRow(S.id))!.status).toBe("failed");
    expect((await getRow(Y.id))!.status).toBe("generating");
  });
});

describe("the claim is the single use", () => {
  it("works for the owner, once, and returns the path", async () => {
    const u = await fresh("dx-claim");
    const a = await insertGenerating(u.id);
    expect(await claim(a.id, u.id), "still generating").toBeNull();
    await finish(a.id, a.attempt);
    expect(await claim(a.id, u.id)).toBe(pathFor(a.id, a.attempt));
    expect(await claim(a.id, u.id), "the second use").toBeNull();
    expect(await getRow(a.id)).toMatchObject({ status: "downloaded" });
    expect((await getRow(a.id))!.claimed_at).toBeTruthy();
  });

  it("does not work for another account, and a refusal does not burn the use", async () => {
    const u = await fresh("dx-claimother");
    const a = await insertGenerating(u.id);
    await finish(a.id, a.attempt);
    expect(await claim(a.id, other.id)).toBeNull();
    expect((await getRow(a.id))!.claimed_at).toBeNull();
    expect(await claim(a.id, u.id)).toBe(pathFor(a.id, a.attempt));
  });

  it("does not work after the end date", async () => {
    const u = await fresh("dx-claimexp");
    const a = await insertGenerating(u.id);
    await finish(a.id, a.attempt);
    await setRow(a.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await claim(a.id, u.id)).toBeNull();
  });

  it("six parallel claims produce exactly one winner", async () => {
    const u = await fresh("dx-claimpar");
    const a = await insertGenerating(u.id);
    await finish(a.id, a.attempt);
    const results = await Promise.all(Array.from({ length: 6 }, () => claim(a.id, u.id)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("cancel an unused export", () => {
  it("T-B1: works once, returns the path, frees the slot; two concurrent cancels: one winner", async () => {
    const u = await fresh("dx-cancel");
    const a = await insertGenerating(u.id);
    await finish(a.id, a.attempt);
    await expect(insertGenerating(u.id), "the slot is held by the generated export").rejects.toThrow();
    const results = await Promise.all([cancelUnused(a.id, u.id), cancelUnused(a.id, u.id)]);
    expect(results.filter((r) => r !== null)).toEqual([pathFor(a.id, a.attempt)]);
    expect(await getRow(a.id)).toMatchObject({ status: "cancelled" });
    expect((await getRow(a.id))!.deleted_at).toBeTruthy();
    await expect(insertGenerating(u.id), "cancelling frees the slot").resolves.toBeTruthy();
  });

  it("T-B1b: claimed, expired, deleted, already cancelled and still-generating rows are not cancellable", async () => {
    const u = await fresh("dx-nocancel");
    for (const status of ["downloaded", "expired", "deleted", "cancelled", "failed"]) {
      const a = await insertGenerating(u.id);
      await setRow(a.id, { status });
      expect(await cancelUnused(a.id, u.id), status).toBeNull();
    }
    const g = await insertGenerating(u.id);
    expect(await cancelUnused(g.id, u.id), "generating").toBeNull();
    await finish(g.id, g.attempt);
    expect(await cancelUnused(g.id, other.id), "somebody else's export").toBeNull();
    expect(await cancelUnused(g.id, u.id)).toBe(pathFor(g.id, g.attempt));
  });
});

describe("mark_data_export_object_deleted", () => {
  const mark = async (id: string, attempt: string, status: string | null) => {
    const { data, error } = await svc.rpc("mark_data_export_object_deleted", { p_export_id: id, p_attempt_id: attempt, p_status: status });
    expect(error, error?.message).toBeNull();
    return data as string | null;
  };

  it("expired only for a generated row past its end; deleted only for a claimed one; neither for a live one", async () => {
    const u = await fresh("dx-mark");
    const a = await insertGenerating(u.id);
    await finish(a.id, a.attempt);
    expect(await mark(a.id, a.attempt, "expired"), "not yet past its end").toBeNull();
    expect(await mark(a.id, a.attempt, "deleted"), "not claimed").toBeNull();
    await claim(a.id, u.id);
    expect(await mark(a.id, a.attempt, "deleted")).toBe(a.id);
    expect(await getRow(a.id)).toMatchObject({ status: "deleted" });
    expect((await getRow(a.id))!.deleted_at).toBeTruthy();

    const e = await insertGenerating(u.id);
    await finish(e.id, e.attempt);
    await setRow(e.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await mark(e.id, e.attempt, "expired")).toBe(e.id);
    expect(await getRow(e.id)).toMatchObject({ status: "expired" });
  });

  it("is conditional on the attempt id: a late call from a cancelled attempt touches nothing", async () => {
    const u = await fresh("dx-markattempt");
    const A = await insertGenerating(u.id);
    await setRow(A.id, { status: "failed" });
    expect(await mark(A.id, randomUUID(), null)).toBeNull();
    expect((await getRow(A.id))!.deleted_at).toBeNull();
    expect(await mark(A.id, A.attempt, null)).toBe(A.id);
    expect((await getRow(A.id))!.deleted_at).toBeTruthy();
  });
});

describe("deleting the person", () => {
  it("removes the row (ON DELETE CASCADE)", async () => {
    // A real auth delete: the pooled test users are released, not deleted, so this one is created and removed directly.
    const created = await admin.auth.admin.createUser({ email: `dx-cascade-${randomUUID()}@talentrah.test`, email_confirm: true });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    const a = await insertGenerating(id);
    const gone = await admin.auth.admin.deleteUser(id);
    expect(gone.error).toBeNull();
    expect(await getRow(a.id)).toBeNull();
  });
});
