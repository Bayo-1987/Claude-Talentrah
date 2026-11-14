/**
 * The mass-email runner against the REAL database (local per-job stack, never a hosted project): the database is the control for eligibility, for the cap and for the ceiling.
 *
 * Real: the email-eligibility function, the claim function (the rolling 24-hour cap and the UTC-month ceiling under the advisory lock), the mark-sent function,
 * the setting function and the stores that read profiles and preferences. Fake: the provider (no network), the clock, and the message row (a message cannot be started
 * here without turning the notification flags on, and a sibling file owns those flags; the runner takes its message through a port, so this file hands it one).
 *
 * This file OWNS the two mass-email settings and the admin-message email ledger while it runs. It reads the originals first, sets them relative to what the ledger already holds,
 * and puts them back. Ledger rows cannot be deleted (the service role has no delete on that table), so they stay; every count below is relative to the count it started with.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { acquireOperatorsLock } from "../support/operators-lock";
import { runEmailSend } from "@/lib/notifications/admin-messages/run-email";
import { emailSendStoreFromClient, recipientDirectoryFromClient } from "@/lib/notifications/admin-messages/supabase-ports";
import type { EmailRunDeps } from "@/lib/notifications/admin-messages/run-email";
import type { EmailSendStore } from "@/lib/notifications/admin-messages/ports";
import { resolveMassSendConfig } from "@/lib/email/mass-send-config";
import type { Clock, MassMailProvider } from "@/lib/email/mass-send";
import {
  NotificationDbError,
  adminEmailEligibleRecipients,
  claimNotification,
  deliveriesTable,
  markNotificationSent,
  notificationSettingChangesTable,
  notificationSettingsTable,
  setNotificationSetting,
} from "@/lib/notifications/contract-db";
import type { AdminMessageKind, AdminRecipientOutcome, NotificationSettingKey } from "@/lib/notifications/contract";

const T = randomUUID().slice(0, 8);
const userIds: string[] = [];
const roles: string[] = [];
const operatorIds: string[] = [];
let release: (() => Promise<void>) | undefined;
let superOp = "";
let superEmail = "";
let plainOp = "";
const originals = new Map<NotificationSettingKey, number>();

async function readSetting(key: NotificationSettingKey): Promise<number> {
  const { data, error } = await notificationSettingsTable(admin).select("int_value").eq("key", key).maybeSingle();
  if (error) throw new Error(`setting ${key}: ${error.message}`);
  return (data as { int_value: number } | null)?.int_value ?? 0;
}

async function makeOperator(label: string, permissions: string[]): Promise<{ id: string; email: string }> {
  const { data: role, error: re } = await admin.from("admin_roles").insert({ name: `pr-d a2 ${label} ${T}` }).select("id").single();
  if (re || !role) throw new Error(`role ${label}: ${re?.message}`);
  roles.push(role.id);
  const { error: pe } = await admin.from("admin_role_permissions").insert(permissions.map((permission) => ({ role_id: role.id, permission: permission as never })));
  if (pe) throw new Error(`permissions ${label}: ${pe.message}`);
  const email = `prd-a2-${label}-${T}@talentrah.test`;
  const { data: user, error: ue } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ue || !user.user) throw new Error(`user ${label}: ${ue?.message}`);
  operatorIds.push(user.user.id);
  const { error: oe } = await admin.from("admin_users").insert({ id: user.user.id, email, role_id: role.id });
  if (oe) throw new Error(`operator ${label}: ${oe.message}`);
  return { id: user.user.id, email };
}

async function openEmailClaims(sinceMs: number): Promise<number> {
  const { count, error } = await deliveriesTable(admin)
    .select("id", { count: "exact", head: true })
    .eq("kind", "admin_message")
    .eq("channel", "email")
    .is("released_at", null)
    .gte("claimed_at", new Date(sinceMs).toISOString());
  if (error) throw new Error(`ledger count: ${error.message}`);
  return count ?? 0;
}
const last24h = () => openEmailClaims(Date.now() - 24 * 3600_000);
const thisMonth = () => {
  const n = new Date();
  return openEmailClaims(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
};

/** A pooled account is reused between runs, so nothing about its state is assumed: it is made plainly eligible for announcements and promotions, and not pending deletion. */
async function normalise(ids: string[]): Promise<void> {
  const profile = await admin.from("profiles").update({ deletion_requested_at: null }).in("id", ids);
  if (profile.error) throw new Error(`normalise profiles: ${profile.error.message}`);
  const prefs = await admin.from("email_preferences").update({ email_announcements: true, email_promotions: true }).in("user_id", ids);
  if (prefs.error) throw new Error(`normalise preferences: ${prefs.error.message}`);
}

async function freshUsers(n: number, label: string): Promise<{ id: string; email: string }[]> {
  const out: { id: string; email: string }[] = [];
  for (let i = 0; i < n; i++) {
    const u = await createTestUser(`a2${label}${i}`);
    userIds.push(u.id);
    out.push(u);
  }
  await normalise(out.map((u) => u.id));
  return out;
}

/** The runner over the real functions, with a fake provider, a fixed clock and a message handed in through the store port. */
function harness(recipientIds: string[], kind: AdminMessageKind = "service_announcement") {
  const messageId = randomUUID();
  const outcomes = new Map<string, AdminRecipientOutcome>();
  const sentTo: string[] = [];
  const calls = { progress: [] as unknown[], pause: [] as string[], finish: 0 };
  const realStore = emailSendStoreFromClient(admin);
  void realStore;
  const store: EmailSendStore = {
    async getMessage() {
      return { id: messageId, kind, title: `A2 real database ${T}`, body: "Body.", link_path: null, channels: ["email"], consent_line: kind === "promotion" ? "You asked for promotions." : null, status: "sending" };
    },
    async queuedEmailRecipientIds() {
      return recipientIds.filter((id) => !outcomes.has(id));
    },
    async setEmailOutcome(_m, ids, outcome) {
      for (const id of ids) outcomes.set(id, outcome);
    },
  };
  const clock: Clock = { now: () => Date.now(), sleep: async () => {} };
  const provider: MassMailProvider = {
    async readQuota() {
      return { rateRemaining: 9, dailyRemaining: 10_000, monthlyRemaining: 100_000 };
    },
    async sendBatch(emails) {
      sentTo.push(...emails.map((e) => e.to));
      return { kind: "ok", quota: null };
    },
  };
  const deps: EmailRunDeps = {
    rpcs: {
      adminEmailEligibleRecipients: (a) => adminEmailEligibleRecipients(admin, a),
      claimNotification: (a) => claimNotification(admin, a),
      markNotificationSent: (a) => markNotificationSent(admin, a),
      recordAdminMessageProgress: async (a) => void calls.progress.push(a),
      finishAdminMessageSend: async () => void (calls.finish += 1),
      pauseAdminMessageSend: async (a) => void calls.pause.push(a.p_reason),
    },
    store,
    directory: recipientDirectoryFromClient(admin),
    provider,
    flags: async () => true,
    clock,
    log: () => {},
    identity: { from: "Talentrah <announce@mail.example.test>", replyTo: null },
    config: resolveMassSendConfig(),
  };
  return { messageId, outcomes, sentTo, calls, deps };
}

async function ledgerFor(messageId: string): Promise<string[]> {
  const { data, error } = await deliveriesTable(admin).select("user_id").eq("subject_id", messageId).eq("kind", "admin_message").eq("channel", "email");
  if (error) throw new Error(`ledger: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

beforeAll(async () => {
  release = await acquireOperatorsLock(admin, "pr-d-a2-mass-email");
  for (const key of ["mass_email_cap_24h", "mass_email_ceiling_month"] as const) originals.set(key, await readSetting(key));
  const s = await makeOperator("super", ["user_messaging", "operators"]);
  superOp = s.id;
  superEmail = s.email;
  plainOp = (await makeOperator("plain", ["user_messaging"])).id;
}, 180_000);

afterAll(async () => {
  const errors: string[] = [];
  for (const [key, value] of originals) {
    try {
      await setNotificationSetting(admin, { p_key: key, p_value: value, p_actor: superOp });
    } catch (e) {
      errors.push(`restore ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const del = async (what: string, run: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run;
    if (error) errors.push(`${what}: ${error.message}`);
  };
  await del("operators", admin.from("admin_users").delete().in("id", operatorIds));
  await del("roles", admin.from("admin_roles").delete().in("id", roles));
  for (const id of operatorIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) errors.push(`operator user: ${error.message}`);
  }
  try {
    await normalise(userIds);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  await deleteTestUsers(userIds);
  await release?.();
  if (errors.length) throw new Error(`teardown: ${errors.join("; ")}`);
}, 180_000);

describe("eligibility on the real database (NOTIF-EMAIL-BATCH-GUARD-1)", () => {
  it("a batch containing a pending-deletion recipient never sends to that address, and an opted-out one is skipped too", async () => {
    const [a, pending, optedOut, d] = await freshUsers(4, "elig");
    // the person who asked to leave, after Prepare would have counted them
    const gone = await admin.from("profiles").update({ deletion_requested_at: new Date().toISOString() }).eq("id", pending.id);
    expect(gone.error).toBeNull();
    const pref = await admin.from("email_preferences").update({ email_announcements: false }).eq("user_id", optedOut.id);
    expect(pref.error).toBeNull();
    const on = await admin.from("email_preferences").update({ email_announcements: true }).in("user_id", [a.id, d.id]);
    expect(on.error).toBeNull();

    await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: (await last24h()) + 100, p_actor: superOp });
    await setNotificationSetting(admin, { p_key: "mass_email_ceiling_month", p_value: (await thisMonth()) + 100, p_actor: superOp });

    const h = harness([a.id, pending.id, optedOut.id, d.id]);
    const result = await runEmailSend(h.deps, h.messageId);

    const profiles = await admin.from("profiles").select("id, email").in("id", [a.id, d.id, pending.id, optedOut.id]);
    const address = new Map((profiles.data ?? []).map((p) => [p.id, p.email as string]));
    expect(h.sentTo.sort()).toEqual([address.get(a.id)!, address.get(d.id)!].sort());
    expect(h.sentTo).not.toContain(address.get(pending.id));
    expect(h.sentTo).not.toContain(address.get(optedOut.id));
    expect(h.outcomes.get(pending.id)).toBe("skipped_deleted");
    expect(h.outcomes.get(optedOut.id)).toBe("skipped_opted_out");
    expect(h.outcomes.get(a.id)).toBe("sent");
    expect(result).toMatchObject({ status: "finished", sent: 2, skipped: 2 });
    expect((await ledgerFor(h.messageId)).sort()).toEqual([a.id, d.id].sort());
    const { data: sentRows } = await deliveriesTable(admin).select("sent_at").eq("subject_id", h.messageId);
    expect((sentRows as { sent_at: string | null }[]).every((r) => r.sent_at !== null)).toBe(true);
  }, 120_000);
});

describe("the cap and the ceiling on the real database", () => {
  it("cap reached stops the send and leaves the rest queued; raising the cap (a Super Admin action, logged) lets the rest go", async () => {
    const people = await freshUsers(4, "cap");
    const ids = people.map((p) => p.id);
    const before = await last24h();
    await setNotificationSetting(admin, { p_key: "mass_email_ceiling_month", p_value: (await thisMonth()) + 1000, p_actor: superOp });
    await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: before + 2, p_actor: superOp });

    const h = harness(ids);
    const first = await runEmailSend(h.deps, h.messageId);
    expect(first).toMatchObject({ status: "paused_email_cap", reason: "cap_24h", sent: 2, remainingQueued: 2 });
    expect(h.calls.pause).toEqual(["cap_24h"]);
    expect(h.sentTo).toHaveLength(2);
    expect((await ledgerFor(h.messageId)).length).toBe(2); // the two unsent recipients hold no claim
    expect(await last24h()).toBe(before + 2);

    // raising the cap does not send anything by itself
    await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: before + 50, p_actor: superOp });
    expect(h.sentTo).toHaveLength(2);

    const second = await runEmailSend(h.deps, h.messageId);
    expect(second).toMatchObject({ status: "finished", sent: 2 });
    expect(h.sentTo).toHaveLength(4);
    expect(new Set(h.sentTo).size).toBe(4); // nobody twice

    const { data: changes } = await notificationSettingChangesTable(admin).select("*").eq("key", "mass_email_cap_24h").eq("actor_admin_id", superOp).order("at", { ascending: false }).limit(1);
    expect((changes as { new_value: number; old_value: number; actor_email: string }[])[0]).toMatchObject({ old_value: before + 2, new_value: before + 50, actor_email: superEmail });
  }, 180_000);

  it("the monthly ceiling pauses sending with its own reason", async () => {
    const people = await freshUsers(3, "ceil");
    const month = await thisMonth();
    await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: (await last24h()) + 1000, p_actor: superOp });
    await setNotificationSetting(admin, { p_key: "mass_email_ceiling_month", p_value: month + 1, p_actor: superOp });

    const h = harness(people.map((p) => p.id));
    const result = await runEmailSend(h.deps, h.messageId);
    expect(result).toMatchObject({ status: "paused_email_ceiling", reason: "ceiling_month", sent: 1, remainingQueued: 2 });
    expect(h.calls.pause).toEqual(["ceiling_month"]);
    expect(h.sentTo).toHaveLength(1);
    expect(await thisMonth()).toBe(month + 1);
  }, 180_000);

  it("a retry skips a recipient whose email claim is open: the database says already_claimed, the runner sends nobody", async () => {
    const [p] = await freshUsers(1, "held");
    await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: (await last24h()) + 1000, p_actor: superOp });
    await setNotificationSetting(admin, { p_key: "mass_email_ceiling_month", p_value: (await thisMonth()) + 1000, p_actor: superOp });
    const h = harness([p.id]);
    // an earlier attempt claimed this person and its outcome is unknown: the claim is open and nobody marked it
    const claim = await claimNotification(admin, { p_user: p.id, p_kind: "admin_message", p_subject: h.messageId, p_channel: "email" });
    expect(claim.id).not.toBeNull();
    const result = await runEmailSend(h.deps, h.messageId);
    expect(result).toMatchObject({ status: "held_open_claims", sent: 0, heldByOpenClaim: 1 });
    expect(h.sentTo).toHaveLength(0);
    const { data } = await deliveriesTable(admin).select("released_at, sent_at").eq("subject_id", h.messageId);
    expect(data).toEqual([{ released_at: null, sent_at: null }]); // still open: the runner never releases an email claim
  }, 120_000);
});

describe("who may change the limits", () => {
  it("an operator without the operators permission is refused by the database, and nothing is logged", async () => {
    const before = await readSetting("mass_email_cap_24h");
    const { count: logged } = await notificationSettingChangesTable(admin).select("id", { count: "exact", head: true }).eq("actor_admin_id", plainOp);
    let error: unknown;
    try {
      await setNotificationSetting(admin, { p_key: "mass_email_cap_24h", p_value: before + 1, p_actor: plainOp });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(NotificationDbError);
    expect((error as NotificationDbError).info.code).toBe("permission_denied");
    expect(await readSetting("mass_email_cap_24h")).toBe(before);
    const { count: after } = await notificationSettingChangesTable(admin).select("id", { count: "exact", head: true }).eq("actor_admin_id", plainOp);
    expect(after).toBe(logged);
  }, 60_000);
});
