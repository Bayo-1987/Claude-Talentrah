/**
 * The /admin/messages Server Actions, run against the contract's in-memory database through the real messaging service.
 *
 * The guard is mocked as the real one behaves: it returns the signed-in operator when they hold the permission and redirects (throws) when they do not. Whether the database's own
 * rules hold (the two-person rule, the flags) is proven against the real database in tests/admin-messages/real-database.test.ts; here the question is what the UI path does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMessagingService } from "@/lib/admin/messages/service";
import { APPROVER as APPROVER_ID, CREATOR as CREATOR_ID, SUPER as SUPER_ID, makeWorld } from "../admin-messages/support";

const h = vi.hoisted(() => ({
  service: null as unknown,
  identity: null as null | { adminId: string; email: string; displayName: string | null; permissions: string[] },
  required: [] as string[],
  touched: [] as string[],
  emailRuns: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/admin/require-admin", () => ({
  requirePermission: async (permission: string) => {
    h.required.push(permission);
    if (!h.identity || !h.identity.permissions.includes(permission)) throw new Error("NEXT_REDIRECT:/admin");
    return h.identity;
  },
}));
vi.mock("@/lib/admin/messages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/messages")>()),
  getMessagingService: () =>
    new Proxy(h.service as object, { get: (target, prop) => { h.touched.push(String(prop)); return (target as Record<string | symbol, unknown>)[prop]; } }),
}));
vi.mock("@/lib/notifications/admin-messages", () => ({
  sendAdminMessageEmail: async (id: string) => {
    h.emailRuns.push(id);
    return { status: "finished", reason: null, sent: 2, failed: 0, skipped: 0, heldByOpenClaim: 0, remainingQueued: 0, batches: 1 };
  },
}));
vi.mock("@/app/admin/(protected)/messages/test-send", () => ({ sendTestEmail: async () => "Test sent." }));

const actions = await import("@/app/admin/(protected)/messages/actions");

const as = (adminId: string, email: string, permissions: string[]) => { h.identity = { adminId, email, displayName: null, permissions }; };
const creator = () => as(CREATOR_ID, "creator.operator@example.test", ["user_messaging"]);
const approver = () => as(APPROVER_ID, "approver.operator@example.test", ["user_messaging"]);
const superAdmin = () => as(SUPER_ID, "super.operator@example.test", ["user_messaging", "operators"]);
const form = (fields: Readonly<Record<string, string | readonly string[]>>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of typeof v === "string" ? [v] : v) f.append(k, one);
  return f;
};
const IDLE = { status: "idle" as const };

let world: ReturnType<typeof makeWorld>;
beforeEach(() => {
  world = makeWorld();
  h.service = createMessagingService({ rpcs: world.rpcs, reads: world.reads, flags: world.flagReader });
  h.identity = null;
  h.required = [];
  h.touched = [];
  h.emailRuns = [];
  world.backend.addPerson({ id: "00000000-0000-4000-8000-000000000001" });
  world.backend.addPerson({ id: "00000000-0000-4000-8000-000000000002" });
});

async function submittedMessage(channels: ("inapp" | "email")[] = ["inapp"], kind: "service_announcement" | "promotion" = "service_announcement") {
  const row = world.backend.addDraftMessage({ createdBy: CREATOR_ID, kind, channels, consentLine: kind === "promotion" ? "You asked for promotions." : null, segmentKey: "everyone" });
  await world.backend.prepareAdminMessage({ p_message: row.id, p_actor: CREATOR_ID, p_max_audience: 500 });
  await world.backend.submitAdminMessage({ p_message: row.id, p_actor: CREATOR_ID });
  return row;
}
const statusOf = (id: string) => world.backend.messages.find((m) => m.id === id)!.status;

describe("an operator without user_messaging cannot use /admin/messages, and every Server Action refuses", () => {
  const names = Object.keys(actions).filter((k) => typeof (actions as Record<string, unknown>)[k] === "function");

  it("there are the actions the page needs", () => {
    expect(names.sort()).toEqual(["approveAction", "cancelAction", "composeAction", "continueEmailAction", "prepareAction", "resolveClaimAction", "resumeAction", "sendAction", "setLimitAction", "submitAction", "testSendAction"].sort());
  });

  it.each([["nobody signed in", null], ["an operator without the permission", ["scholarships", "feature_flags"]]])("with %s every action is refused before the service, the database or the mail runner is touched", async (_label, permissions) => {
    if (permissions) as("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "other.operator@example.test", permissions as string[]);
    for (const name of names) {
      h.touched = [];
      await expect((actions as Record<string, (p: unknown, f: FormData) => Promise<unknown>>)[name](IDLE, form({ id: "x", kind: "promotion", confirmKind: "yes", key: "mass_email_cap_24h", value: "5", claimId: "c", resolution: "mark_sent" })), name).rejects.toThrow(/NEXT_REDIRECT/);
      expect(h.touched, name).toEqual([]);
    }
    expect(h.emailRuns).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  it("each action asks for the permission first: user_messaging for all, operators for the limits", async () => {
    const source = readFileSync(join(__dirname, "../../src/app/admin/(protected)/messages/actions.ts"), "utf8");
    const bodies = source.split(/\nexport async function /).slice(1);
    expect(bodies.length).toBe(names.length);
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf("("));
      const guard = name === "setLimitAction" ? /requirePermission\("operators"\)/ : /(requirePermission\("user_messaging"\)|await session\(\))/;
      const at = body.search(guard);
      expect(at, name).toBeGreaterThan(-1);
      for (const later of ["formData", "getMessagingService(", "sendAdminMessageEmail("]) {
        const i = body.indexOf(later, body.indexOf("{"));
        expect(i === -1 || i > at, `${name}: ${later} before the guard`).toBe(true);
      }
    }
  });

  it("the three pages call the guard too", () => {
    for (const f of ["page.tsx", "new/page.tsx", "[id]/page.tsx"]) {
      expect(readFileSync(join(__dirname, "../../src/app/admin/(protected)/messages", f), "utf8"), f).toMatch(/await requirePermission\("user_messaging"\)/);
    }
  });
});

describe("approval", () => {
  it("a send cannot be approved by its own sender: the UI path shows why, and the message stays where it was", async () => {
    const row = await submittedMessage();
    creator();
    const result = await actions.approveAction(IDLE, form({ id: row.id, kind: row.kind, confirmKind: "yes" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/someone else has to approve/);
    expect(statusOf(row.id)).toBe("submitted");
  });

  it("approval needs the kind tick: without it the database is not even asked", async () => {
    const row = await submittedMessage();
    approver();
    const result = await actions.approveAction(IDLE, form({ id: row.id, kind: row.kind }));
    expect(result).toMatchObject({ status: "error" });
    expect(result.message).toMatch(/Tick the box/);
    expect(world.calls).not.toContain("approveAdminMessage");
    expect(statusOf(row.id)).toBe("submitted");
  });

  it("with the tick another operator approves it, and the kind they confirmed is stored", async () => {
    const row = await submittedMessage();
    approver();
    const result = await actions.approveAction(IDLE, form({ id: row.id, kind: row.kind, confirmKind: "yes" }));
    expect(result.status).toBe("success");
    const stored = world.backend.messages.find((m) => m.id === row.id)!;
    expect(stored.status).toBe("approved");
    expect(stored.kind_confirmed_by_approver).toBe("service_announcement");
    expect(stored.approved_by).toBe(APPROVER_ID);
  });

  it("a wrong kind is refused by the database even with the tick", async () => {
    const row = await submittedMessage();
    approver();
    const result = await actions.approveAction(IDLE, form({ id: row.id, kind: "promotion", confirmKind: "yes" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/not the kind/);
    expect(statusOf(row.id)).toBe("submitted");
  });
});

describe("promotion, repeat sends, and the flags", () => {
  const compose = { kind: "promotion", title: "Offer", body: "Body", channels: ["inapp"], segmentKey: "self_test", consentLine: "You asked." };

  it("the page refuses promotion while admin_promotions is off", async () => {
    creator();
    const result = await actions.composeAction(IDLE, form(compose));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/romotions are switched off/);
    expect(world.calls).not.toContain("createAdminMessage");
  });

  it("with admin_promotions on, the same form is accepted and the person is sent to the new message", async () => {
    world.setFlags({ master: true, adminMessaging: true, adminPromotions: true, adminEmail: true });
    creator();
    await expect(actions.composeAction(IDLE, form(compose))).rejects.toThrow(/NEXT_REDIRECT:\/admin\/messages\//);
    expect(world.backend.messages).toHaveLength(1);
  });

  it("a repeat or double send sends nothing extra", async () => {
    const row = await submittedMessage(["inapp", "email"]);
    await world.backend.approveAdminMessage({ p_message: row.id, p_actor: APPROVER_ID, p_kind_confirmed: "service_announcement" });
    creator();
    const first = await actions.sendAction(IDLE, form({ id: row.id }));
    const second = await actions.sendAction(IDLE, form({ id: row.id }));
    expect(first.status).toBe("success");
    expect(second.status).toBe("error");
    expect(second.message).toMatch(/Nothing was started/);
    expect(h.emailRuns).toEqual([row.id]);
  });

  it("with admin_messaging, admin_promotions and admin_email all OFF: no action does anything, no email runs, and the approver still cannot be the creator", async () => {
    const row = await submittedMessage(["email"]);
    world.setFlags({});
    world.calls.length = 0;
    approver();
    for (const [action, fields] of [
      [actions.prepareAction, { id: row.id }], [actions.submitAction, { id: row.id }], [actions.approveAction, { id: row.id, kind: row.kind, confirmKind: "yes" }],
      [actions.sendAction, { id: row.id }], [actions.continueEmailAction, { id: row.id }], [actions.resumeAction, { id: row.id }], [actions.testSendAction, { id: row.id }],
      [actions.composeAction, { kind: "service_announcement", title: "t", body: "b", channels: ["inapp"], segmentKey: "self_test" }],
    ] as const) {
      const result = await action(IDLE, form(fields));
      expect(result.status).toBe("error");
      expect(result.message).toMatch(/switched off/);
    }
    expect(world.calls).toEqual([]);
    expect(h.emailRuns).toEqual([]);
    expect(statusOf(row.id)).toBe("submitted");
    await expect(world.backend.approveAdminMessage({ p_message: row.id, p_actor: CREATOR_ID, p_kind_confirmed: "service_announcement" })).rejects.toMatchObject({ info: { reason: "self_approval" } });
  });
});

describe("the limits", () => {
  it("only a Super Admin changes a limit, through the permission guard, and the change is logged", async () => {
    creator();
    await expect(actions.setLimitAction(IDLE, form({ key: "mass_email_cap_24h", value: "5" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(h.required.at(-1)).toBe("operators");
    expect(world.backend.settingChanges).toHaveLength(0);
    superAdmin();
    const result = await actions.setLimitAction(IDLE, form({ key: "mass_email_cap_24h", value: "75" }));
    expect(result.status).toBe("success");
    expect(world.backend.settingChanges).toHaveLength(1);
    expect(world.backend.settingChanges[0]).toMatchObject({ key: "mass_email_cap_24h", new_value: 75, actor_admin_id: SUPER_ID });
  });

  it("raising a limit never resumes a paused message", async () => {
    const row = await submittedMessage(["email"]);
    await world.backend.approveAdminMessage({ p_message: row.id, p_actor: APPROVER_ID, p_kind_confirmed: "service_announcement" });
    await world.backend.startAdminMessageSend({ p_message: row.id, p_actor: CREATOR_ID });
    await world.backend.pauseAdminMessageSend({ p_message: row.id, p_reason: "cap_24h" });
    world.calls.length = 0;
    superAdmin();
    await actions.setLimitAction(IDLE, form({ key: "mass_email_cap_24h", value: "500" }));
    expect(statusOf(row.id)).toBe("paused_email_cap");
    expect(world.calls).not.toContain("resumeAdminMessageSend");
    expect(h.emailRuns).toEqual([]);
  });

  it("a nonsense limit is refused", async () => {
    superAdmin();
    expect((await actions.setLimitAction(IDLE, form({ key: "mass_email_cap_24h", value: "1.5" }))).status).toBe("error");
    expect((await actions.setLimitAction(IDLE, form({ key: "something_else", value: "5" }))).status).toBe("error");
  });

  it("a stale claim is resolved only by an operator with user_messaging", async () => {
    creator();
    const result = await actions.resolveClaimAction(IDLE, form({ claimId: "nope", resolution: "release_for_retry" }));
    expect(result.status).toBe("error");
    expect((await actions.resolveClaimAction(IDLE, form({ claimId: "nope", resolution: "delete_it" }))).message).toMatch(/Pick mark sent/);
  });
});
