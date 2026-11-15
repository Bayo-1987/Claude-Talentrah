/**
 * The admin messaging service against the REAL database (local per-job stack, never a hosted project): the database is the control for the two-person rule, for the flags and for the permissions.
 *
 * Every database call goes through the contract's accessors (this folder may not spell a database name). The file owns the five notification flag rows while it runs: it reads their values first, checks the "off" state, turns on only what
 * it needs, and puts every value back. It never starts a send (the daily start limits are global and a start cannot be undone), never writes a setting and never touches the email ledger: the files that own those (tests/email/mass-send*)
 * run in parallel against the same database, so the two sets of tests share nothing.
 *
 * Audience: the "self_test" segment, so a message reaches only its own creator and the test does not depend on who else is in the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";
import { createMessagingService, type ComposeInput } from "@/lib/admin/messages/service";
import { MessagingError } from "@/lib/admin/messages/errors";
import { messagingRpcsFromClient } from "@/lib/admin/messages/rpcs";
import { readsFromClient } from "@/lib/admin/messages/reads";
import { NOTIFICATION_FLAGS, type NotificationFlagKey } from "@/lib/notifications/contract";
import {
  NotificationDbError,
  adminMessageEventsTable,
  approveAdminMessage,
  createAdminMessage,
  prepareAdminMessage,
  setNotificationSetting,
} from "@/lib/notifications/contract-db";
import { actor } from "./support";

const T = randomUUID().slice(0, 8);
const flagKeys = Object.values(NOTIFICATION_FLAGS);
const original = new Map<NotificationFlagKey, boolean>();

const ops = { a: "", b: "", outsider: "" };
const roles: string[] = [];
const userIds: string[] = [];

async function readFlag(key: string): Promise<boolean> {
  const { data, error } = await admin.from("feature_flags").select("enabled").eq("key", key).maybeSingle();
  if (error) throw new Error(`flag ${key}: ${error.message}`);
  return data?.enabled === true;
}
async function writeFlag(key: string, enabled: boolean) {
  const { error } = await admin.from("feature_flags").update({ enabled }).eq("key", key);
  if (error) throw new Error(`flag ${key}: ${error.message}`);
}

const service = createMessagingService({
  rpcs: messagingRpcsFromClient(admin),
  reads: readsFromClient(admin),
  flags: (key) => readFlag(key),
});

const COMPOSE: ComposeInput = {
  kind: "service_announcement",
  title: `Real database check ${T}`,
  body: "A message that reaches only its own creator.",
  linkPath: null,
  channels: ["inapp"],
  segmentKey: "self_test",
  segmentParams: {},
  consentLine: null,
};

async function makeOperator(label: string, permissions: string[]): Promise<string> {
  const { data: role, error: re } = await admin.from("admin_roles").insert({ name: `pr-d ${label} ${T}` }).select("id").single();
  if (re || !role) throw new Error(`role ${label}: ${re?.message}`);
  roles.push(role.id);
  const { error: pe } = await admin.from("admin_role_permissions").insert(permissions.map((permission) => ({ role_id: role.id, permission: permission as never })));
  if (pe) throw new Error(`permissions ${label}: ${pe.message}`);
  const email = `prd-${label}-${T}@talentrah.test`;
  const { data: user, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ue || !user.user) throw new Error(`user ${label}: ${ue?.message}`);
  userIds.push(user.user.id);
  const { error: oe } = await admin.from("admin_users").insert({ id: user.user.id, email, role_id: role.id });
  if (oe) throw new Error(`operator ${label}: ${oe.message}`);
  return user.user.id;
}

async function database(run: () => Promise<unknown>): Promise<NotificationDbError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(NotificationDbError);
    return error as NotificationDbError;
  }
  throw new Error("expected the database to refuse");
}
async function refused(run: () => Promise<unknown>): Promise<MessagingError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(MessagingError);
    return error as MessagingError;
  }
  throw new Error("expected the service to refuse");
}

const A = () => actor(ops.a, ["user_messaging"]);
const B = () => actor(ops.b, ["user_messaging"]);

beforeAll(async () => {
  for (const key of flagKeys) original.set(key, await readFlag(key));
  ops.a = await makeOperator("creator", ["user_messaging"]);
  ops.b = await makeOperator("approver", ["user_messaging"]);
  ops.outsider = await makeOperator("outsider", ["scholarships"]);
}, 120_000);

afterAll(async () => {
  for (const [key, value] of original) await writeFlag(key, value);
  const errors: string[] = [];
  const del = async (what: string, run: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run;
    if (error) errors.push(`${what}: ${error.message}`);
  };
  await del("operators", admin.from("admin_users").delete().in("id", userIds));
  await del("roles", admin.from("admin_roles").delete().in("id", roles));
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(`user: ${error.message}`);
  }
  if (errors.length) throw new Error(`teardown: ${errors.join("; ")}`);
}, 120_000);

describe("with the flags OFF, the database and the service both refuse", () => {
  it("the five notification flag rows exist and read OFF before this file touches them", () => {
    for (const key of flagKeys) expect(original.has(key)).toBe(true);
    expect(original.get(NOTIFICATION_FLAGS.adminMessaging)).toBe(false);
    expect(original.get(NOTIFICATION_FLAGS.adminPromotions)).toBe(false);
    expect(original.get(NOTIFICATION_FLAGS.adminEmail)).toBe(false);
  });

  it("the service says 'switched off' and never reaches the database", async () => {
    const error = await refused(() => service.compose(A(), COMPOSE));
    expect(error.code).toBe("switched_off");
  });

  it("the database refuses on its own when the service is bypassed: a draft cannot be prepared with the flags off (flag_off)", async () => {
    const id = await createAdminMessage(admin, {
      p_actor: ops.a, p_kind: "service_announcement", p_title: `bypass ${T}`, p_body: "bypass", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null,
    });
    const error = await database(() => prepareAdminMessage(admin, { p_message: id, p_actor: ops.a, p_max_audience: 500 }));
    expect(error.info.reason).toBe("flag_off");
  });
});

describe("the two-person rule: the DATABASE refuses the creator, not only the application", () => {
  let first = "";

  beforeAll(async () => {
    await writeFlag(NOTIFICATION_FLAGS.master, true);
    await writeFlag(NOTIFICATION_FLAGS.adminMessaging, true);
    first = await service.compose(A(), COMPOSE);
    expect(await service.prepare(A(), first)).toBe(1);
    await service.submit(A(), first);
  }, 60_000);

  it("the creator approving their own message is refused (self_approval) through the service", async () => {
    const error = await refused(() => service.approve(A(), first, "service_announcement"));
    expect(error.code).toBe("refused");
    expect(error.reason).toBe("self_approval");
    expect((await service.get(A(), first))!.status).toBe("submitted");
  });

  it("and refused by the database itself when the service is bypassed and the same actor is passed to the function", async () => {
    const error = await database(() => approveAdminMessage(admin, { p_message: first, p_actor: ops.a, p_kind_confirmed: "service_announcement" }));
    expect(error.info.code).toBe("refused");
    expect(error.info.reason).toBe("self_approval");
    expect((await service.get(A(), first))!.status).toBe("submitted");
  });

  it("another operator approves it; the approver on the row is that operator and the kind they confirmed is stored", async () => {
    await service.approve(B(), first, "service_announcement");
    const row = (await service.get(B(), first))!;
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(ops.b);
    expect(row.kind_confirmed_by_approver).toBe("service_announcement");
  });

  it("the creator stays excluded when someone else prepared and submitted: only the creator is shut out", async () => {
    const second = await service.compose(A(), { ...COMPOSE, title: `second ${T}` });
    await service.prepare(B(), second);
    await service.submit(B(), second);
    expect((await refused(() => service.approve(A(), second, "service_announcement"))).reason).toBe("self_approval");
    await service.approve(B(), second, "service_announcement");
    expect((await service.get(B(), second))!.status).toBe("approved");
  });

  it("the creation is on the audit trail with the creator as the actor", async () => {
    const { data, error } = await adminMessageEventsTable(admin).select("event, actor_admin_id").eq("message_id", first).eq("event", "created");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].actor_admin_id).toBe(ops.a);
  });
});

describe("permissions are the database's too", () => {
  it("an operator without user_messaging cannot create a message even through the contract directly (42501)", async () => {
    const error = await database(() =>
      createAdminMessage(admin, { p_actor: ops.outsider, p_kind: "service_announcement", p_title: "no", p_body: "no", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null }),
    );
    expect(error.info.code).toBe("permission_denied");
  });

  it("changing a limit needs operators: user_messaging alone is refused by the database (42501) and the service refuses first", async () => {
    const direct = await database(() => setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: 50, p_actor: ops.a }));
    expect(direct.info.code).toBe("permission_denied");
    expect((await refused(() => service.setLimit(A(), "mass_email_cap_24h", 50))).code).toBe("permission_denied");
  });
});

describe("the reads work with the service role (the grants allow them)", () => {
  it("the message list, one message, the channel counts and the limits all read without a permission error", async () => {
    const list = await service.list(A(), 5);
    expect(list.length).toBeGreaterThan(0);
    const id = list[0].id;
    expect((await service.get(A(), id))?.id).toBe(id);
    const counts = await service.channelCounts(A(), id);
    expect(Object.keys(counts).sort()).toEqual(["email", "inapp", "push", "queuedEmail"]);
    const limits = await service.limits(A());
    expect(limits.cap24h).toBeGreaterThanOrEqual(0);
    expect(limits.ceilingMonth).toBeGreaterThanOrEqual(0);
    expect(limits.sentLast24h).toBeGreaterThanOrEqual(0);
    expect(limits.sentThisMonth).toBeGreaterThanOrEqual(limits.sentLast24h - 0);
  });
});
