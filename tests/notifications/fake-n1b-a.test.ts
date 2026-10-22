import { beforeEach, describe, expect, it } from "vitest";
import { NotificationDbError } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * N1B (0273) part A, in the fake: the same rules as the database tests in tests/supabase/migration-0273-a.test.ts (the create-message function, the independence rule of the approve function,
 * the sender's two functions). The fake has no tables to refuse, so the service-role write closures and the status-graph trigger are database-only.
 */
const A2 = "00000000-0000-4000-8000-0000000000b2";
const A3 = "00000000-0000-4000-8000-0000000000b3";
const A4 = "00000000-0000-4000-8000-0000000000b4";
const NOBODY = "00000000-0000-4000-8000-0000000000b1";
let fake: FakeNotificationBackend;
const refusal = async (p: Promise<unknown>) => p.then(() => "NOT REFUSED", (e: NotificationDbError) => `${e.info.sqlstate}/${e.info.reason ?? "-"}`);
const make = (actor: string, over: Record<string, unknown> = {}) =>
  fake.createAdminMessage({ p_actor: actor, p_kind: "service_announcement", p_title: "Title", p_body: "Body", p_link_path: null, p_channels: ["inapp"], p_segment_key: "self_test", p_segment_params: {}, p_consent_line: null, ...over } as never);
beforeEach(() => {
  fake = new FakeNotificationBackend(new Date("2026-10-26T12:00:00Z"));
  fake.addAdmin(A2, "a2@example.test", ["user_messaging"]);
  fake.addAdmin(A3, "a3@example.test", ["user_messaging"]);
  fake.addAdmin(A4, "a4@example.test", ["operators"]);
  fake.addAdmin(NOBODY, "n@example.test", []);
  (["notifications_master", "admin_messaging", "admin_promotions", "admin_email"] as const).forEach((k) => fake.setFlag(k, true));
});

describe("the create-message function", () => {
  it("the caller is the creator: their id and address, a draft, approval required, one created event naming them", async () => {
    const id = await make(A2);
    const row = fake.messages.find((m) => m.id === id)!;
    expect([row.created_by, row.created_by_email, row.status, row.requires_approval]).toEqual([A2, "a2@example.test", "draft", true]);
    expect(fake.events.filter((e) => e.message_id === id && e.event === "created").map((e) => [e.actor_admin_id, e.actor_email])).toEqual([[A2, "a2@example.test"]]);
  });
  it("no permission, the operators permission alone, and no actor are 42501", async () => {
    for (const actor of [NOBODY, A4, null as unknown as string]) expect(await refusal(make(actor))).toBe("42501/-");
  });
  it.each([["a bad kind", { p_kind: "newsletter" }], ["no title", { p_title: "" }], ["a bad link", { p_link_path: "//evil.example" }], ["no channel", { p_channels: [] }], ["a bad segment", { p_segment_key: "admins" }], ["a null approval flag", { p_requires_approval: null }]])("%s is 22023", async (_n, over) => {
    expect(await refusal(make(A2, over))).toBe("22023/-");
  });
  it("the error carries none of the values", async () => {
    const e = await make(A2, { p_kind: "secret-kind-value" }).catch((x: Error) => x);
    expect((e as Error).message).not.toContain("secret-kind-value");
  });
});

describe("the approve function: independence", () => {
  const submitted = async (creator: string, preparer: string) => {
    const id = await make(creator);
    await fake.prepareAdminMessage({ p_message: id, p_actor: preparer, p_max_audience: 500 });
    await fake.submitAdminMessage({ p_message: id, p_actor: preparer });
    return id;
  };
  it("the creator cannot approve", async () => {
    const id = await submitted(A2, A2);
    expect(await refusal(fake.approveAdminMessage({ p_message: id, p_actor: A2, p_kind_confirmed: "service_announcement" }))).toBe("P0001/self_approval");
  });
  it("the preparer and the submitter (another operator) can approve", async () => {
    const id = await submitted(A2, A3);
    await fake.approveAdminMessage({ p_message: id, p_actor: A3, p_kind_confirmed: "service_announcement" });
    expect(fake.messages.find((m) => m.id === id)!.status).toBe("approved");
  });
  it("the actor of the created event cannot approve even if the row names someone else (a forged creator)", async () => {
    const id = await submitted(A2, A3);
    fake.messages.find((m) => m.id === id)!.created_by = A3;
    expect(await refusal(fake.approveAdminMessage({ p_message: id, p_actor: A2, p_kind_confirmed: "service_announcement" }))).toBe("P0001/self_approval");
    // and the creator NAMED on the row cannot approve either, whatever the events say
    expect(await refusal(fake.approveAdminMessage({ p_message: id, p_actor: A3, p_kind_confirmed: "service_announcement" }))).toBe("P0001/self_approval");
  });
  it("a message with no creator on the row and no created event cannot be approved; with the event, anyone but its actor can", async () => {
    const id = await submitted(A2, A2);
    const row = fake.messages.find((m) => m.id === id)!;
    row.created_by = null;
    fake.events = fake.events.filter((e) => !(e.message_id === id && e.event === "created"));
    expect(await refusal(fake.approveAdminMessage({ p_message: id, p_actor: A3, p_kind_confirmed: "service_announcement" }))).toBe("P0001/self_approval");
    fake.events.push({ id: fake.newId(), message_id: id, event: "created", detail: {}, actor_admin_id: A2, actor_email: "a2@example.test", at: fake.now().toISOString() });
    expect(await refusal(fake.approveAdminMessage({ p_message: id, p_actor: A2, p_kind_confirmed: "service_announcement" }))).toBe("P0001/self_approval");
    await fake.approveAdminMessage({ p_message: id, p_actor: A3, p_kind_confirmed: "service_announcement" });
    expect(row.status).toBe("approved");
  });
});

describe("the sender's two functions", () => {
  const sending = async () => {
    for (let i = 0; i < 3; i++) fake.addPerson({ id: fake.newId() });
    const id = await make(A2, { p_segment_key: "everyone", p_channels: ["inapp", "email"], p_requires_approval: false });
    await fake.prepareAdminMessage({ p_message: id, p_actor: A2, p_max_audience: 500 });
    await fake.startAdminMessageSend({ p_message: id, p_actor: A2 });
    return { id, row: fake.messages.find((m) => m.id === id)! };
  };
  it("progress adds to the counters and can never pass the audience times the channels", async () => {
    const { id, row } = await sending();
    expect(row.audience_count).toBe(3);
    await fake.recordAdminMessageProgress({ p_message: id, p_sent: 5, p_failed: 2, p_skipped: 1 });
    await fake.recordAdminMessageProgress({ p_message: id, p_sent: 1, p_failed: 0, p_skipped: 0 });
    expect([row.sent_count, row.failed_count, row.skipped_count]).toEqual([6, 2, 1]);
    expect(await refusal(fake.recordAdminMessageProgress({ p_message: id, p_sent: 1, p_failed: 0, p_skipped: 0 }))).toBe("22023/-");
  });
  it.each([[null], [-1], [1.5]])("a bad count (%s) is 22023", async (v) => {
    const { id } = await sending();
    expect(await refusal(fake.recordAdminMessageProgress({ p_message: id, p_sent: v as never, p_failed: 0, p_skipped: 0 }))).toBe("22023/-");
  });
  it("progress is invalid_state outside a running or paused send, accepted while paused; an unknown message is not_found", async () => {
    const { id } = await sending();
    await fake.pauseAdminMessageSend({ p_message: id, p_reason: "cap_24h" });
    await fake.recordAdminMessageProgress({ p_message: id, p_sent: 0, p_failed: 1, p_skipped: 0 });
    expect(await refusal(fake.finishAdminMessageSend({ p_message: id }))).toBe("P0001/invalid_state");
    await fake.resumeAdminMessageSend({ p_message: id, p_actor: A2 });
    await fake.finishAdminMessageSend({ p_message: id });
    expect(await refusal(fake.recordAdminMessageProgress({ p_message: id, p_sent: 1, p_failed: 0, p_skipped: 0 }))).toBe("P0001/invalid_state");
    expect(await refusal(fake.finishAdminMessageSend({ p_message: id }))).toBe("P0001/invalid_state");
    expect(await refusal(fake.recordAdminMessageProgress({ p_message: fake.newId(), p_sent: 1, p_failed: 0, p_skipped: 0 }))).toBe("P0001/not_found");
    expect(await refusal(fake.finishAdminMessageSend({ p_message: fake.newId() }))).toBe("P0001/not_found");
  });
  it("finish moves sending to sent and writes one send_finished event with no actor", async () => {
    const { id, row } = await sending();
    await fake.finishAdminMessageSend({ p_message: id });
    expect(row.status).toBe("sent");
    expect(fake.events.filter((e) => e.message_id === id && e.event === "send_finished").map((e) => e.actor_admin_id)).toEqual([null]);
  });
});
