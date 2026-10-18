/**
 * The start of an admin-produced data export and the cancel of an unused one, against the real local database, the real private bucket and the real audit log (only the mailer is fake).
 * Read docs/admin-data-export.md for the order these tests pin. The tests are named for what the build prompt calls them (T-A1 ... T-B2).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin as realService } from "../support/auth";
import { fakeSecret } from "../support/fake-secret";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import {
  PERSON_FIRST_NAME, PERSON_LAST_NAME, auditRowsSince, bucketPaths, cleanupAll, releaseCreated, countedService, fakeMailer, flags, makeAdmin, makePerson, putObject,
} from "../support/data-export-fixtures";
import { ageAttempt, finish as finishRow, getRow, insertGenerating, pathFor, setRow } from "../support/data-export-db";
import { startExport, cancelExport, type StartDeps } from "@/lib/data-export/start";
import { sweepDataExports } from "@/lib/data-export/sweep";
import { DATA_EXPORT_BUCKET, REFUSAL_CODES, parseObjectName } from "@/lib/data-export/constants";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

const INPUT = { ticket: "SUP-1042", reason: "access_request", requesterCheck: "contact_form" } as const;

function deps(adminIdentity: Awaited<ReturnType<typeof makeAdmin>>, mail = fakeMailer(), extra: Partial<StartDeps> = {}) {
  const counted = countedService();
  const d: StartDeps = {
    service: counted.client,
    admin: adminIdentity,
    send: mail.send,
    siteOrigin: "https://www.example.test",
    supportUrl: "https://www.example.test/contact",
    from: "Talentrah <notifications@example.test>",
    loadBankNames: async () => new Map(),
    ...extra,
  };
  return { d, mail, reads: counted.reads };
}

beforeEach(() => {
  flags.failAuditInsert = false;
  flags.failRemove = 0;
});
beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
afterEach(releaseCreated, 60_000);
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

const rowsFor = async (a: { adminId: string }) => (await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId);
const finishedRows = (rows: Awaited<ReturnType<typeof auditRowsSince>>) => rows.filter((r) => r.action === "people.export_finished");

describe("a start that succeeds", () => {
  it("claims, sends the notice FIRST, generates into the private bucket, finishes, then sends the link; every step is audited", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const secret = fakeSecret("token");
    await realService.from("email_preferences").update({ unsubscribe_token: secret }).eq("user_id", p.id);
    const { d, mail } = deps(a);

    const r = await startExport(d, { targetRaw: p.id, ...INPUT });
    expect(r.status).toBe("started");
    if (r.status !== "started") return;

    expect(mail.sent.map((m) => m.template)).toEqual(["data_export_generated", "data_export_link"]);
    expect(mail.sent.every((m) => m.to === p.email)).toBe(true);
    expect(mail.sent.some((m) => m.to === a.email), "the admin is never mailed the notice or the link").toBe(false);
    expect(mail.sent[0].text).not.toContain("/data-export/");
    expect(mail.sent[1].text).toContain(`https://www.example.test/data-export/${r.exportId}`);

    const row = (await getRow(r.exportId))!;
    expect(row.status).toBe("generated");
    expect(row.created_by_admin).toBe(a.adminId);
    expect(row.object_path).toBe(pathFor(row.id, row.attempt_id));
    const hours = (new Date(row.expires_at!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.8);
    expect(hours).toBeLessThan(72.1);

    const dl = await realService.storage.from(DATA_EXPORT_BUCKET).download(row.object_path!);
    expect(dl.error).toBeNull();
    const text = await dl.data!.text();
    const file = JSON.parse(text) as { tables: Record<string, unknown[]> };
    expect(Object.keys(file.tables)).toContain("profiles");
    expect(text, "a planted token must never reach the file").not.toContain(secret);
    expect(text).toContain(p.email);

    const rows = await rowsFor(a);
    expect(rows.map((x) => x.action)).toEqual(["people.export_requested", "people.export_notice_sent", "people.export_generated", "people.export_finished"]);
    expect(finishedRows(rows)[0].detail).toMatchObject({ outcome: "completed", refusal_code: null, export_id: r.exportId });
    expect(rows[2].detail).toMatchObject({ export_id: r.exportId });
    expect(typeof (rows[2].detail as { rows: number }).rows).toBe("number");
  });

  it("no audit row holds the person's name or address, or anything the admin typed beyond the codes", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const { d } = deps(a);
    await startExport(d, { targetRaw: p.id, ...INPUT });
    const blob = JSON.stringify(await rowsFor(a));
    for (const s of [PERSON_FIRST_NAME, PERSON_LAST_NAME, p.email]) expect(blob, s).not.toContain(s);
    expect(blob).toContain("SUP-1042");
  });

  it("a person inside their 30 days before a deletion CAN be exported", async () => {
    const a = await makeAdmin();
    const p = await makePerson({ pendingDeletion: true });
    const { d } = deps(a);
    expect((await startExport(d, { targetRaw: p.id, ...INPUT })).status).toBe("started");
  });
});

describe("FAIL CLOSED", () => {
  it("when the first audit row cannot be written, NOTHING is read and nothing is sent (zero table reads)", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const { d, mail, reads } = deps(a);
    flags.failAuditInsert = true;
    const r = await startExport(d, { targetRaw: p.id, ...INPUT });
    expect(r.status).toBe("unavailable");
    expect(reads, "no table was read").toEqual([]);
    expect(mail.sent).toEqual([]);
    expect(await getRow(randomUUID())).toBeNull();
    const { data } = await realService.from("data_export_files").select("id").eq("user_id", p.id);
    expect(data).toEqual([]);
  });

  it("the same for a cancel", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const { d, reads } = deps(a);
    flags.failAuditInsert = true;
    const r = await cancelExport({ service: d.service, admin: a }, { targetRaw: p.id, ticket: "SUP-1" + "042" });
    expect(r.status).toBe("unavailable");
    expect(reads).toEqual([]);
  });

  it("when the notice email fails, NO export is generated: no table is read, nothing is in the bucket, the attempt is failed, and the refusal is audited", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const mail = fakeMailer({ failTemplates: ["data_export_generated"] });
    const { d, reads } = deps(a, mail);
    const r = await startExport(d, { targetRaw: p.id, ...INPUT });
    expect(r).toEqual({ status: "refused", code: "notice_failed" });
    expect(mail.sent).toEqual([]);
    expect(reads.filter((t) => !["profiles", "admin_users", "data_export_files", "admin_audit_log"].includes(t)), "no exported table was read").toEqual([]);
    const { data } = await realService.from("data_export_files").select("status, object_path").eq("user_id", p.id);
    expect(data).toEqual([{ status: "failed", object_path: null }]);
    expect((await bucketPaths()).filter((x) => x.startsWith("")).length).toBeGreaterThanOrEqual(0);
    expect(finishedRows(await rowsFor(a))[0].detail).toMatchObject({ outcome: "refused", refusal_code: "notice_failed" });
    // and a new export can start at once
    const again = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(again.status).toBe("started");
  });

  it("when the link email fails, the export is taken back (nothing left behind) and a retry can start at once", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const mail = fakeMailer({ failTemplates: ["data_export_link"] });
    const r = await startExport(deps(a, mail).d, { targetRaw: p.id, ...INPUT });
    expect(r.status).toBe("failed");
    const { data } = await realService.from("data_export_files").select("id, status").eq("user_id", p.id);
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("cancelled");
    expect((await bucketPaths()).filter((x) => x.startsWith(data![0].id))).toEqual([]);
    expect((await startExport(deps(a).d, { targetRaw: p.id, ...INPUT })).status).toBe("started");
  });
});

describe("T-B2: every refused start ends in ONE final people.export_finished row with a short refusal code and no personal data", () => {
  const RAW_NOT_A_UUID = "someone.private@example.com";

  type Case = { code: (typeof REFUSAL_CODES)[number]; run: () => Promise<{ admin: Awaited<ReturnType<typeof makeAdmin>>; result: { status: string; code?: string }; person: { email: string } | null }> };

  const cases: Case[] = [
    {
      code: "not_a_uuid",
      run: async () => {
        const a = await makeAdmin();
        return { admin: a, result: await startExport(deps(a).d, { targetRaw: RAW_NOT_A_UUID, ...INPUT }), person: null };
      },
    },
    {
      code: "own_account",
      run: async () => {
        const a = await makeAdmin();
        return { admin: a, result: await startExport(deps(a).d, { targetRaw: a.adminId, ...INPUT }), person: null };
      },
    },
    {
      code: "no_such_person",
      run: async () => {
        const a = await makeAdmin();
        return { admin: a, result: await startExport(deps(a).d, { targetRaw: randomUUID(), ...INPUT }), person: null };
      },
    },
    {
      code: "admin_target_needs_other_admin",
      run: async () => {
        const a = await makeAdmin();
        const b = await makePerson();
        await realService.from("admin_users").upsert({ id: b.id, email: `other-${randomUUID()}@talentrah.test` });
        // The acting admin's address is the target's registered address: the same mailbox.
        const who = { ...a, email: b.email };
        return { admin: a, result: await startExport(deps(who).d, { targetRaw: b.id, ...INPUT }), person: b };
      },
    },
    {
      code: "in_progress",
      run: async () => {
        const a = await makeAdmin();
        const p = await makePerson();
        await insertGenerating(p.id);
        return { admin: a, result: await startExport(deps(a).d, { targetRaw: p.id, ...INPUT }), person: p };
      },
    },
    {
      code: "live_export_exists",
      run: async () => {
        const a = await makeAdmin();
        const p = await makePerson();
        const g = await insertGenerating(p.id);
        await finishRow(g.id, g.attempt);
        return { admin: a, result: await startExport(deps(a).d, { targetRaw: p.id, ...INPUT }), person: p };
      },
    },
    {
      code: "notice_failed",
      run: async () => {
        const a = await makeAdmin();
        const p = await makePerson();
        return { admin: a, result: await startExport(deps(a, fakeMailer({ failTemplates: ["data_export_generated"] })).d, { targetRaw: p.id, ...INPUT }), person: p };
      },
    },
    {
      code: "not_cancellable",
      run: async () => {
        const a = await makeAdmin();
        const p = await makePerson();
        return { admin: a, result: await cancelExport({ service: deps(a).d.service, admin: a }, { targetRaw: p.id, ticket: "SUP-77" }), person: p };
      },
    },
  ];

  it("the list covers every code in the fixed list, once", () => {
    expect(cases.map((c) => c.code).sort()).toEqual([...REFUSAL_CODES].sort());
  });

  it.each(cases.map((c) => [c.code, c] as const))("%s: exactly one final refusal row, tied to its request, with no personal data", async (_code, c) => {
    const { admin: a, result, person } = await c.run();
    expect(result).toMatchObject({ status: "refused", code: c.code });
    const rows = await rowsFor(a);
    const requested = rows.filter((r) => r.action === "people.export_requested");
    const finished = finishedRows(rows);
    expect(requested, "one request row").toHaveLength(1);
    expect(finished, "exactly ONE final row").toHaveLength(1);
    expect(finished[0].detail).toMatchObject({ outcome: "refused", refusal_code: c.code, requested_id: requested[0].id });
    // no personal data anywhere in this admin's audit rows
    // admin_email is the STAFF address every audit row snapshots; the admin_target case is built so that it equals the target's address, so it is left out of the comparison.
    const blob = JSON.stringify(rows.map((r) => ({ ...r, admin_email: null })));
    for (const s of [PERSON_FIRST_NAME, PERSON_LAST_NAME, RAW_NOT_A_UUID, "someone.private", ...(person ? [person.email] : [])]) expect(blob, `an audit row holds ${s}`).not.toContain(s);
    if (c.code === "not_a_uuid") {
      expect(requested[0].target_id, "the raw input is never copied").toBeNull();
      expect(finished[0].target_id).toBeNull();
    }
  });

  it("a successful start leaves a final row with NO refusal code (and none for the paths that did not refuse)", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    const finished = finishedRows(await rowsFor(a));
    expect(finished).toHaveLength(1);
    expect(finished[0].detail).toMatchObject({ outcome: "completed", refusal_code: null });
  });

  it("with the audit insert forced to fail, the start returns unavailable (the route's 503) and performs zero table reads", async () => {
    const a = await makeAdmin();
    const { d, reads } = deps(a);
    flags.failAuditInsert = true;
    expect(await startExport(d, { targetRaw: randomUUID(), ...INPUT })).toEqual({ status: "unavailable" });
    expect(reads).toEqual([]);
  });
});

describe("T-A1: a stale generating row does not block; a young one does", () => {
  it("one older than 15 minutes is handed to a new attempt, which completes; the old attempt's object is removed", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const old = await insertGenerating(p.id);
    await putObject(`${old.id}/${old.attempt}.json`);
    expect(await bucketPaths(), "setup: the old attempt's object is in the bucket").toContain(`${old.id}/${old.attempt}.json`);
    await ageAttempt(old.id, 20);
    const r = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(r).toEqual({ status: "started", exportId: old.id });
    const row = (await getRow(old.id))!;
    expect(row.attempt_id).not.toBe(old.attempt);
    expect(row.status).toBe("generated");
    const paths = await bucketPaths();
    expect(paths).not.toContain(`${old.id}/${old.attempt}.json`);
    expect(paths).toContain(`${old.id}/${row.attempt_id}.json`);
    const deleted = (await rowsFor(a)).filter((x) => x.action === "people.export_deleted");
    expect(deleted.map((x) => (x.detail as { reason: string }).reason)).toEqual(["cancelled"]);
  });

  it("one younger than that is NOT cancelled and the start is refused in_progress", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const young = await insertGenerating(p.id);
    await ageAttempt(young.id, 10);
    const { d, mail } = deps(a);
    expect(await startExport(d, { targetRaw: p.id, ...INPUT })).toEqual({ status: "refused", code: "in_progress" });
    expect((await getRow(young.id))!.attempt_id).toBe(young.attempt);
    expect(mail.sent).toEqual([]);
  });
});

describe("T-A2: a unique object path per attempt", () => {
  it("two attempts for the same export write different paths, and the sweep's pattern accepts <uuid>/<uuid>.json and rejects a flat <uuid>.json", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const old = await insertGenerating(p.id);
    await ageAttempt(old.id, 20);
    const r = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(r.status).toBe("started");
    const row = (await getRow(old.id))!;
    expect(pathFor(old.id, old.attempt)).not.toBe(row.object_path);
    expect(parseObjectName(row.object_path!)).toEqual({ exportId: old.id, attemptId: row.attempt_id });
    expect(parseObjectName(`${old.id}.json`)).toBeNull();
    expect(parseObjectName(`${old.id}/${old.attempt}.txt`)).toBeNull();
  });
});

describe("T-A3 / T-A4: a late finish from a cancelled attempt, and the sweep after it", () => {
  it("attempt A is cancelled by the 15-minute rule, B starts and completes, A then finishes: A's update changes nothing, A deletes its own object, no link goes out for A; the sweep then removes A's stray object and leaves B's", async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const p = await makePerson();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const mailA = fakeMailer({ gates: { data_export_generated: gate } });
    const runA = startExport(deps(a1, mailA).d, { targetRaw: p.id, ...INPUT });

    // wait until A has claimed its row (it is blocked sending its notice)
    let row = null as Awaited<ReturnType<typeof getRow>> | null;
    for (let i = 0; i < 100 && !row; i++) {
      const { data } = await realService.from("data_export_files").select("id").eq("user_id", p.id).maybeSingle();
      if (data) row = await getRow(data.id);
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(row?.status).toBe("generating");
    const A = row!.attempt_id;
    await ageAttempt(row!.id, 20);

    const mailB = fakeMailer();
    const rB = await startExport(deps(a2, mailB).d, { targetRaw: p.id, ...INPUT });
    expect(rB).toEqual({ status: "started", exportId: row!.id });
    const afterB = (await getRow(row!.id))!;
    expect(afterB.attempt_id).not.toBe(A);

    release();
    const rA = await runA;
    expect(rA, "A's late finish must not mark the export ready").toEqual({ status: "superseded" });
    expect(mailA.sent.map((m) => m.template), "no link email for A").toEqual(["data_export_generated"]);
    expect(mailB.sent.map((m) => m.template)).toEqual(["data_export_generated", "data_export_link"]);

    const finalRow = (await getRow(row!.id))!;
    expect(finalRow).toMatchObject({ status: "generated", attempt_id: afterB.attempt_id, object_path: afterB.object_path });
    const paths = await bucketPaths();
    expect(paths, "A deleted its own object").not.toContain(pathFor(row!.id, A));
    expect(paths).toContain(afterB.object_path);

    // T-A4: a late write from A lands anyway; the sweep removes it and leaves B's object untouched
    await putObject(pathFor(row!.id, A));
    expect(await bucketPaths()).toContain(pathFor(row!.id, A));
    const summary = await sweepDataExports(countedService().client);
    expect(summary.orphansDeleted).toBeGreaterThanOrEqual(1);
    const after = await bucketPaths();
    expect(after).not.toContain(pathFor(row!.id, A));
    expect(after).toContain(afterB.object_path);
    expect((await getRow(row!.id))!.status).toBe("generated");
  }, 60_000);
});

describe("T-A5: concurrent starts", () => {
  it("two admins start at the same moment on the SAME stale generating row: exactly one wins, one notice is sent, the row ends with the winner's attempt", async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const p = await makePerson();
    const stale = await insertGenerating(p.id);
    await ageAttempt(stale.id, 30);
    const m1 = fakeMailer();
    const m2 = fakeMailer();
    const [r1, r2] = await Promise.all([startExport(deps(a1, m1).d, { targetRaw: p.id, ...INPUT }), startExport(deps(a2, m2).d, { targetRaw: p.id, ...INPUT })]);
    const results = [r1, r2];
    expect(results.filter((r) => r.status === "started")).toHaveLength(1);
    const loser = results.find((r) => r.status !== "started")!;
    expect(loser).toEqual({ status: "refused", code: "in_progress" });
    const notices = [...m1.sent, ...m2.sent].filter((m) => m.template === "data_export_generated");
    expect(notices, "exactly ONE notice is sent").toHaveLength(1);
    const row = (await getRow(stale.id))!;
    expect(row.attempt_id).not.toBe(stale.attempt);
    expect(row.status).toBe("generated");
  }, 60_000);

  it("with NO live row, two concurrent starts produce exactly one row and one refusal", async () => {
    const a1 = await makeAdmin();
    const a2 = await makeAdmin();
    const p = await makePerson();
    const m1 = fakeMailer();
    const m2 = fakeMailer();
    const results = await Promise.all([startExport(deps(a1, m1).d, { targetRaw: p.id, ...INPUT }), startExport(deps(a2, m2).d, { targetRaw: p.id, ...INPUT })]);
    expect(results.filter((r) => r.status === "started")).toHaveLength(1);
    expect(results.find((r) => r.status !== "started")).toEqual({ status: "refused", code: "in_progress" });
    const { data } = await realService.from("data_export_files").select("id").eq("user_id", p.id);
    expect(data).toHaveLength(1);
    expect([...m1.sent, ...m2.sent].filter((m) => m.template === "data_export_generated")).toHaveLength(1);
  }, 60_000);
});

describe("a live unclaimed export, and the cancel (T-B1, T-B1b, T-B1c)", () => {
  it("T-B1c: starting while a live unclaimed export exists is refused live_export_exists, writes the refusal row, generates nothing and sends no notice", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const first = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(first.status).toBe("started");
    const { d, mail, reads } = deps(a);
    const second = await startExport(d, { targetRaw: p.id, ...INPUT });
    expect(second).toEqual({ status: "refused", code: "live_export_exists" });
    expect(mail.sent).toEqual([]);
    expect(reads.filter((t) => !["profiles", "admin_users", "data_export_files", "admin_audit_log"].includes(t))).toEqual([]);
    const { data } = await realService.from("data_export_files").select("id").eq("user_id", p.id);
    expect(data).toHaveLength(1);
  });

  it("T-B1: cancelling an unused generated export works exactly once (two concurrent cancels: one wins), deletes the object, audits it, sends no email, and a new export can then start", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const mail = fakeMailer();
    const first = await startExport(deps(a, mail).d, { targetRaw: p.id, ...INPUT });
    if (first.status !== "started") throw new Error("setup");
    const row = (await getRow(first.exportId))!;
    expect(await bucketPaths()).toContain(row.object_path);
    const sentBefore = mail.sent.length;

    const cancels = await Promise.all([0, 1].map(() => cancelExport({ service: deps(a).d.service, admin: a }, { targetRaw: p.id, ticket: "SUP-2001" })));
    expect(cancels.filter((c) => c.status === "cancelled")).toHaveLength(1);
    expect(cancels.find((c) => c.status !== "cancelled")).toEqual({ status: "refused", code: "not_cancellable" });
    expect(mail.sent.length, "no email").toBe(sentBefore);
    expect((await getRow(first.exportId))!.status).toBe("cancelled");
    expect(await bucketPaths()).not.toContain(row.object_path);
    const actions = (await rowsFor(a)).map((r) => r.action);
    expect(actions).toContain("people.export_cancelled");

    const again = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(again.status).toBe("started");
  }, 60_000);

  it("T-B1b: a claimed, expired, deleted or already cancelled export cannot be cancelled (refused not_cancellable)", async () => {
    const a = await makeAdmin();
    for (const status of ["downloaded", "expired", "deleted", "cancelled"]) {
      const p = await makePerson();
      const g = await insertGenerating(p.id);
      await finishRow(g.id, g.attempt);
      await setRow(g.id, { status, ...(status === "downloaded" ? { claimed_at: new Date().toISOString() } : {}) });
      const r = await cancelExport({ service: deps(a).d.service, admin: a }, { targetRaw: p.id, ticket: "SUP-2002" });
      expect(r, status).toEqual({ status: "refused", code: "not_cancellable" });
    }
  });

  it("starting after a CLAIMED export is not blocked (it is no longer live)", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const g = await insertGenerating(p.id);
    await finishRow(g.id, g.attempt);
    await setRow(g.id, { status: "downloaded", claimed_at: new Date().toISOString() });
    expect((await startExport(deps(a).d, { targetRaw: p.id, ...INPUT })).status).toBe("started");
  });
});

describe("one live export per person", () => {
  it("a second start for the same person is refused while the first is live", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    expect((await startExport(deps(a).d, { targetRaw: p.id, ...INPUT })).status).toBe("started");
    expect(await startExport(deps(a).d, { targetRaw: p.id, ...INPUT })).toEqual({ status: "refused", code: "live_export_exists" });
  });

  it("a live export past its 72 hours is cleared (its object deleted) and the new start proceeds", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    const first = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    if (first.status !== "started") throw new Error("setup");
    const row = (await getRow(first.exportId))!;
    await setRow(row.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const second = await startExport(deps(a).d, { targetRaw: p.id, ...INPUT });
    expect(second.status).toBe("started");
    expect(await bucketPaths()).not.toContain(row.object_path);
    expect((await getRow(row.id))!.status).toBe("expired");
  });
});
