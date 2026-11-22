/**
 * "One operator may send without a second approver", behind admin_messaging_self_approve (OFF). Variant A: code only. The service passes p_requires_approval = false to the create function only when the flag is ON and
 * the message is not a promotion; everything else is the database's existing rule (the fake mirrors it): a promotion, or an audience over 100, still needs a second person.
 */
import { describe, expect, it } from "vitest";
import { createMessagingService } from "@/lib/admin/messages/service";
import { MessagingError } from "@/lib/admin/messages/errors";
import type { ComposeInput } from "@/lib/admin/messages/service";
import { COMPOSE, CREATOR, creator, makeWorld } from "./support";

const ON = { master: true, adminMessaging: true, adminPromotions: true, adminEmail: true, adminMessagingSelfApprove: true } as const;
const OFF = { ...ON, adminMessagingSelfApprove: false };
const INAPP: ComposeInput = { ...COMPOSE, channels: ["inapp"] };
const PROMO: ComposeInput = { ...COMPOSE, kind: "promotion", channels: ["inapp"], consentLine: "You asked for offers." };

function build(flags: Parameters<typeof makeWorld>[0], flagReader?: (key: string) => Promise<boolean>) {
  const world = makeWorld(flags);
  const created: Array<Record<string, unknown>> = [];
  const rpcs = { ...world.rpcs, createAdminMessage: (a: Parameters<typeof world.rpcs.createAdminMessage>[0]) => (created.push({ ...a }), world.rpcs.createAdminMessage(a)) };
  const service = createMessagingService({ rpcs, reads: world.reads, flags: (flagReader as never) ?? world.flagReader, now: () => world.backend.now() });
  return { ...world, service, created };
}
const people = (w: ReturnType<typeof build>, n: number) => {
  for (let i = 1; i <= n; i++) w.backend.addPerson({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, unsubscribeToken: `tok${i}` });
};
const row = (w: ReturnType<typeof build>, id: string) => w.backend.messages.find((m) => m.id === id)!;

describe("with the flag OFF the service behaves exactly as it does today", () => {
  it("compose calls the create function with no approval argument at all, and the message needs approval", async () => {
    const w = build(OFF);
    const id = await w.service.compose(creator(), INAPP);
    expect(w.created).toHaveLength(1);
    expect("p_requires_approval" in w.created[0]).toBe(false);
    expect(row(w, id).requires_approval).toBe(true);
  });
  it("a prepared message cannot be started by its creator; it must be submitted and approved", async () => {
    const w = build(OFF);
    people(w, 3);
    const id = await w.service.compose(creator(), INAPP);
    await w.service.prepare(creator(), id);
    expect(await w.service.start(creator(), id)).toBeNull();
  });
  it("a missing flag row (absent from the reader) and a flag that cannot be read both mean OFF", async () => {
    const absent = build({ master: true, adminMessaging: true, adminPromotions: true, adminEmail: true });
    await absent.service.compose(creator(), INAPP);
    expect("p_requires_approval" in absent.created[0]).toBe(false);
    const broken = build(ON, async (key) => {
      if (key === "admin_messaging_self_approve") throw new Error("flag store down");
      return true;
    });
    await broken.service.compose(creator(), INAPP);
    expect("p_requires_approval" in broken.created[0]).toBe(false);
  });
});

describe("with the flag ON", () => {
  it("a non-promotion is created without a second approver and can be started by its creator alone", async () => {
    const w = build(ON);
    people(w, 3);
    const id = await w.service.compose(creator(), INAPP);
    expect(w.created[0].p_requires_approval).toBe(false);
    expect(row(w, id).requires_approval).toBe(false);
    expect(await w.service.prepare(creator(), id)).toBe(3);
    expect(row(w, id).requires_approval).toBe(false);
    expect(await w.service.start(creator(), id)).toBe(id);
  });
  it("a promotion NEVER skips the second approver, even with admin_promotions on", async () => {
    const w = build(ON);
    people(w, 3);
    const id = await w.service.compose(creator(), PROMO);
    expect("p_requires_approval" in w.created[0]).toBe(false);
    await w.service.prepare(creator(), id);
    expect(row(w, id).requires_approval).toBe(true);
    expect(await w.service.start(creator(), id)).toBeNull();
  });
  it("an audience over 100 still needs approval: the database raises the requirement when the audience is frozen", async () => {
    const w = build(ON);
    people(w, 101);
    const id = await w.service.compose(creator(), INAPP);
    expect(w.created[0].p_requires_approval).toBe(false);
    expect(await w.service.prepare(creator(), id, 5000)).toBe(101);
    expect(row(w, id).requires_approval).toBe(true);
    expect(await w.service.start(creator(), id)).toBeNull();
  });
  it("exactly 100 is still self-approvable", async () => {
    const w = build(ON);
    people(w, 100);
    const id = await w.service.compose(creator(), INAPP);
    await w.service.prepare(creator(), id, 5000);
    expect(row(w, id).requires_approval).toBe(false);
    expect(await w.service.start(creator(), id)).toBe(id);
  });
  it("Only me works: the audience is the operator alone and the send starts with no approver", async () => {
    const w = build(ON);
    w.backend.addPerson({ id: CREATOR, unsubscribeToken: `tok${CREATOR.slice(0, 4)}` });
    const id = await w.service.compose(creator(), { ...INAPP, segmentKey: "self_test" });
    expect(await w.service.prepare(creator(), id)).toBe(1);
    expect(await w.service.start(creator(), id)).toBe(id);
  });
  it("the daily limits still apply to a self-approved send (the database's, unchanged)", async () => {
    const w = build(ON);
    w.backend.addPerson({ id: CREATOR, unsubscribeToken: `tok${CREATOR.slice(0, 4)}` });
    for (let i = 0; i < w.defaults.adminPerOperatorPerDay; i++) {
      const id = await w.service.compose(creator(), { ...INAPP, segmentKey: "self_test" });
      await w.service.prepare(creator(), id);
      expect(await w.service.start(creator(), id)).toBe(id);
    }
    const next = await w.service.compose(creator(), { ...INAPP, segmentKey: "self_test" });
    const error = await w.service.prepare(creator(), next).then(() => null, (e: MessagingError) => e);
    expect(error?.reason).toBe("operator_daily_limit");
  });
});

describe("a send without a second approver needs the flag at the moment of sending too", () => {
  it("switching the flag OFF after the message was made stops its start, and the database is not asked", async () => {
    const w = build(ON);
    people(w, 3);
    const id = await w.service.compose(creator(), INAPP);
    await w.service.prepare(creator(), id);
    w.setFlags(OFF);
    w.calls.length = 0;
    const error = await w.service.start(creator(), id).then(() => null, (e: MessagingError) => e);
    expect(error).toBeInstanceOf(MessagingError);
    expect(error?.code).toBe("switched_off");
    expect(error?.message).toMatch(/second approver/);
    expect(w.calls).not.toContain("startAdminMessageSend");
  });
  it("a message that DID get its second approver still starts with the flag off (nothing about it changed)", async () => {
    const w = build(OFF);
    people(w, 3);
    const id = await w.service.compose(creator(), INAPP);
    await w.service.prepare(creator(), id);
    await w.service.submit(creator(), id);
    await w.backend.approveAdminMessage({ p_message: id, p_actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", p_kind_confirmed: "service_announcement" });
    expect(await w.service.start(creator(), id)).toBe(id);
  });
});
