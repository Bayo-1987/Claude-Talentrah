/**
 * The send action's typed confirmation, enforced on the SERVER. A message sent without a second approver and going to more than 50 people is started only when the form carries the word SEND exactly; the page's input
 * is a convenience, not the guard. A message that went through the two-person route is not asked for it (that route is unchanged). Run against the contract's in-memory database through the real messaging service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessagingService } from "@/lib/admin/messages/service";
import { CREATOR as CREATOR_ID, makeWorld } from "../admin-messages/support";

const h = vi.hoisted(() => ({ service: null as unknown, identity: null as null | { adminId: string; email: string; displayName: string | null; permissions: string[] } }));

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: () => undefined }));
vi.mock("@/lib/admin/require-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/require-admin")>()),
  requirePermission: async () => h.identity,
}));
vi.mock("@/lib/admin/messages", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/messages")>()), getMessagingService: () => h.service }));

const actions = await import("@/app/admin/(protected)/messages/actions");

const IDLE = { status: "idle" as const };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const ON = { master: true, adminMessaging: true, adminPromotions: true, adminEmail: true, adminMessagingSelfApprove: true } as const;

let world: ReturnType<typeof makeWorld>;
beforeEach(() => {
  world = makeWorld(ON);
  h.service = createMessagingService({ rpcs: world.rpcs, reads: world.reads, flags: world.flagReader, now: () => world.backend.now() });
  h.identity = { adminId: CREATOR_ID, email: "creator.operator@example.test", displayName: null, permissions: ["user_messaging"] };
});

async function prepared(recipients: number, over: { requiresApproval?: boolean } = {}) {
  for (let i = 1; i <= recipients; i++) world.backend.addPerson({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, unsubscribeToken: `tok${i}` });
  const message = world.backend.addDraftMessage({ createdBy: CREATOR_ID, kind: "service_announcement", channels: ["inapp"], segmentKey: "everyone", requiresApproval: over.requiresApproval ?? false });
  await world.backend.prepareAdminMessage({ p_message: message.id, p_actor: CREATOR_ID, p_max_audience: 500 });
  return message;
}
const started = (id: string) => world.backend.messages.find((m) => m.id === id)!.status === "sending";

describe("a self-approved message to more than 50 people needs SEND typed", () => {
  it("51 recipients: no word, a wrong word and a lower-case send are all refused and nothing is started", async () => {
    const m = await prepared(51);
    for (const typed of [undefined, "", "send", "Send", "SEND IT", "SENT"]) {
      world.calls.length = 0;
      const result = await actions.sendAction(IDLE, form(typed === undefined ? { id: m.id } : { id: m.id, confirmSend: typed }));
      expect(result.status, String(typed)).toBe("error");
      expect(result.message).toMatch(/Type SEND/);
      expect(world.calls).not.toContain("startAdminMessageSend");
    }
    expect(started(m.id)).toBe(false);
  });
  it("51 recipients with SEND typed (the word, nothing else) starts the send", async () => {
    const m = await prepared(51);
    const result = await actions.sendAction(IDLE, form({ id: m.id, confirmSend: "SEND" }));
    expect(result.status).toBe("success");
    expect(started(m.id)).toBe(true);
  });
  it("exactly 50 needs no typing; 51 does (the line is 'over 50')", async () => {
    const fifty = await prepared(50);
    expect((await actions.sendAction(IDLE, form({ id: fifty.id }))).status).toBe("success");
    expect(started(fifty.id)).toBe(true);
  });
  it("Only me (one person) needs no typing", async () => {
    world.backend.addPerson({ id: CREATOR_ID, unsubscribeToken: `tok${CREATOR_ID.slice(0, 4)}` });
    const m = world.backend.addDraftMessage({ createdBy: CREATOR_ID, kind: "service_announcement", channels: ["inapp"], segmentKey: "self_test", requiresApproval: false });
    await world.backend.prepareAdminMessage({ p_message: m.id, p_actor: CREATOR_ID, p_max_audience: 500 });
    expect((await actions.sendAction(IDLE, form({ id: m.id }))).status).toBe("success");
  });
  it("a message that went through the two-person route is not asked for it, however many people (that route is unchanged)", async () => {
    const m = await prepared(60, { requiresApproval: true });
    await world.backend.submitAdminMessage({ p_message: m.id, p_actor: CREATOR_ID });
    world.backend.addAdmin("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "approver.operator@example.test", ["user_messaging"]);
    await world.backend.approveAdminMessage({ p_message: m.id, p_actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", p_kind_confirmed: "service_announcement" });
    const result = await actions.sendAction(IDLE, form({ id: m.id }));
    expect(result.status).toBe("success");
    expect(started(m.id)).toBe(true);
  });
  it("with the flag OFF a self-approved message is not sent at all, with or without the word", async () => {
    const m = await prepared(60);
    world.setFlags({ ...ON, adminMessagingSelfApprove: false });
    const result = await actions.sendAction(IDLE, form({ id: m.id, confirmSend: "SEND" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/second approver/i);
    expect(started(m.id)).toBe(false);
  });
});

describe("fail closed: a message that cannot be read is never sent", () => {
  const withReads = (getMessage: (id: string) => Promise<unknown>) => {
    h.service = createMessagingService({ rpcs: world.rpcs, reads: { ...world.reads, getMessage: getMessage as never }, flags: world.flagReader, now: () => world.backend.now() });
  };
  it("the read finds no message (returns null) for a self-approved message to 60 people: nothing is started, with or without the word", async () => {
    const m = await prepared(60);
    withReads(async () => null);
    const cases: Array<Record<string, string>> = [{ id: m.id }, { id: m.id, confirmSend: "SEND" }];
    for (const fields of cases) {
      world.calls.length = 0;
      const result = await actions.sendAction(IDLE, form(fields));
      expect(result.status).toBe("error");
      expect(world.calls).not.toContain("startAdminMessageSend");
    }
    expect(started(m.id)).toBe(false);
  });
  it("the read throws: nothing is started and nothing is thrown at the caller", async () => {
    const m = await prepared(60);
    withReads(async () => {
      throw new Error("read failed");
    });
    const result = await actions.sendAction(IDLE, form({ id: m.id, confirmSend: "SEND" }));
    expect(result.status).toBe("error");
    expect(started(m.id)).toBe(false);
  });
});
