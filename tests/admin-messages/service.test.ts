import { describe, expect, it } from "vitest";
import { createMessagingService, type ComposeInput } from "@/lib/admin/messages/service";
import { MessagingError } from "@/lib/admin/messages/errors";
import { COMPOSE, approver, creator, makeWorld, outsider, superAdmin, APPROVER, CREATOR, SUPER } from "./support";

/**
 * The admin messaging service (A1): permission and flags are checked BEFORE any database call, the acting admin comes only from the verified session's actor, the database's own refusals (the two-person rule, the kind
 * confirmation, the state graph) come back as reasons, and nothing the input carries can name another actor. The fake backend models the database's rules; the real database is proven in real-database.test.ts.
 */
function build(flags?: Parameters<typeof makeWorld>[0]) {
  const world = makeWorld(flags);
  const service = createMessagingService({ rpcs: world.rpcs, reads: world.reads, flags: world.flagReader, now: () => world.backend.now() });
  return { ...world, service };
}
async function failure(run: () => Promise<unknown>): Promise<MessagingError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(MessagingError);
    return error as MessagingError;
  }
  throw new Error("expected the call to be refused");
}
function seedPeople(world: ReturnType<typeof makeWorld>, n = 3) {
  for (let i = 1; i <= n; i++) world.backend.addPerson({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, unsubscribeToken: `tok${i}` });
}
/** compose, prepare and submit as the creator; returns the message id. */
async function submitted(world: ReturnType<typeof build>) {
  seedPeople(world);
  const id = await world.service.compose(creator(), COMPOSE);
  await world.service.prepare(creator(), id);
  await world.service.submit(creator(), id);
  return id;
}

describe("permission is checked before any database call", () => {
  const cases: Array<[string, (s: ReturnType<typeof build>) => Promise<unknown>]> = [
    ["compose", (w) => w.service.compose(outsider(), COMPOSE)],
    ["prepare", (w) => w.service.prepare(outsider(), "m")],
    ["submit", (w) => w.service.submit(outsider(), "m")],
    ["approve", (w) => w.service.approve(outsider(), "m", "service_announcement")],
    ["cancel", (w) => w.service.cancel(outsider(), "m")],
    ["start", (w) => w.service.start(outsider(), "m")],
    ["record a test send", (w) => w.service.recordTest(outsider(), "m")],
    ["resume", (w) => w.service.resume(outsider(), "m")],
    ["audit", (w) => w.service.audit(outsider(), "m")],
    ["list stale claims", (w) => w.service.staleEmailClaims(outsider())],
    ["resolve a stale claim", (w) => w.service.resolveStaleClaim(outsider(), "c", "mark_sent")],
    ["read the limits", (w) => w.service.limits(outsider())],
    ["list messages", (w) => w.service.list(outsider())],
  ];
  it.each(cases)("an operator without user_messaging cannot %s, and no database call is made", async (_name, run) => {
    const w = build();
    const error = await failure(() => run(w));
    expect(error.code).toBe("permission_denied");
    expect(w.calls).toEqual([]);
  });

  it("changing a limit needs the operators permission: user_messaging alone is refused with no call", async () => {
    const w = build();
    const error = await failure(() => w.service.setLimit(creator(), "mass_email_cap_24h", 10));
    expect(error.code).toBe("permission_denied");
    expect(w.calls).toEqual([]);
  });
});

describe("the acting admin is the session's, and nothing in the input can replace it", () => {
  it("the creator on the message is the actor, even when the input carries an actor or a creator of its own", async () => {
    const w = build();
    seedPeople(w);
    const sneaky = { ...COMPOSE, p_actor: APPROVER, created_by: APPROVER, actor: APPROVER, adminId: APPROVER } as ComposeInput;
    const id = await w.service.compose(creator(), sneaky);
    const row = w.backend.messages.find((m) => m.id === id)!;
    expect(row.created_by).toBe(CREATOR);
  });

  it("a send cannot be approved by its own sender: the database refuses and the service says self_approval", async () => {
    const w = build();
    const id = await submitted(w);
    const error = await failure(() => w.service.approve(creator(), id, "service_announcement"));
    expect(error.code).toBe("refused");
    expect(error.reason).toBe("self_approval");
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("submitted");
  });

  it("a different operator can approve; the approver on the row is that operator", async () => {
    const w = build();
    const id = await submitted(w);
    await w.service.approve(approver(), id, "service_announcement");
    const row = w.backend.messages.find((m) => m.id === id)!;
    expect(row.status).toBe("approved");
    expect(row.approved_by).toBe(APPROVER);
  });

  it("the preparer or the submitter may approve: only the creator is excluded", async () => {
    const w = build();
    seedPeople(w);
    const id = await w.service.compose(creator(), COMPOSE);
    await w.service.prepare(approver(), id);
    await w.service.submit(approver(), id);
    await w.service.approve(approver(), id, "service_announcement");
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("approved");
  });

  it("approval needs the kind confirmation: a wrong kind is refused (kind_not_confirmed) and nothing is approved", async () => {
    const w = build();
    const id = await submitted(w);
    const error = await failure(() => w.service.approve(approver(), id, "promotion"));
    expect(error.reason).toBe("kind_not_confirmed");
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("submitted");
  });
});

describe("the flags gate the whole send path, before any database call", () => {
  const off = { master: false, adminMessaging: false, adminPromotions: false, adminEmail: false };
  const operations: Array<[string, (s: ReturnType<typeof build>) => Promise<unknown>]> = [
    ["compose", (w) => w.service.compose(creator(), COMPOSE)],
    ["prepare", (w) => w.service.prepare(creator(), "m")],
    ["submit", (w) => w.service.submit(creator(), "m")],
    ["approve", (w) => w.service.approve(approver(), "m", "service_announcement")],
    ["start", (w) => w.service.start(creator(), "m")],
    ["record a test send", (w) => w.service.recordTest(creator(), "m")],
    ["resume", (w) => w.service.resume(creator(), "m")],
  ];
  it.each(operations)("with admin_messaging, admin_promotions and admin_email OFF, %s is refused as switched off and makes no database call", async (_name, run) => {
    const w = build(off);
    const error = await failure(() => run(w));
    expect(error.code).toBe("switched_off");
    expect(w.calls).toEqual([]);
  });

  it("switches() reports the send path closed with admin_messaging off and open with it on; promotions and email are reported on their own flags", async () => {
    expect(await build(off).service.switches(creator())).toEqual({ sendPathOpen: false, promotionsOn: false, emailOn: false });
    expect((await build({ master: true, adminMessaging: false, adminEmail: true, adminPromotions: true }).service.switches(creator())).sendPathOpen).toBe(false);
    expect(await build({ master: false, adminMessaging: true, adminEmail: true, adminPromotions: false }).service.switches(creator())).toEqual({ sendPathOpen: true, promotionsOn: false, emailOn: true });
    expect(await build({ master: true, adminMessaging: true, adminEmail: true, adminPromotions: true }).service.switches(creator())).toEqual({ sendPathOpen: true, promotionsOn: true, emailOn: true });
  });

  it("a flag is asked only where it applies: a plain in-app announcement needs neither admin_promotions nor admin_email", async () => {
    const w = build({ master: true, adminMessaging: true, adminPromotions: false, adminEmail: false });
    const id = await w.service.compose(creator(), { ...COMPOSE, channels: ["inapp"] });
    expect(typeof id).toBe("string");
  });

  it("when the database finds a flag off that this service did not (the master switch), the answer is 'switched off', not an error", async () => {
    const w = build({ master: false, adminMessaging: true, adminPromotions: false, adminEmail: true });
    seedPeople(w);
    const id = await w.service.compose(creator(), COMPOSE);
    const error = await failure(() => w.service.prepare(creator(), id));
    expect(error.code).toBe("switched_off");
    expect(error.reason).toBe("flag_off");
  });

  it("a promotion is refused while admin_promotions is off", async () => {
    const w = build({ master: true, adminMessaging: true, adminPromotions: false, adminEmail: true });
    const error = await failure(() => w.service.compose(creator(), { ...COMPOSE, kind: "promotion", consentLine: "You asked for offers." }));
    expect(error.code).toBe("switched_off");
    expect(error.message).toMatch(/promotion/i);
    expect(w.calls).toEqual([]);
  });

  it("the email channel is refused while admin_email is off, in the words 'admin email is switched off'", async () => {
    const w = build({ master: true, adminMessaging: true, adminPromotions: false, adminEmail: false });
    const error = await failure(() => w.service.compose(creator(), COMPOSE));
    expect(error.code).toBe("switched_off");
    expect(error.message).toBe("admin email is switched off");
    expect(w.calls).toEqual([]);
    // an in-app only message is not an email send, so it is allowed with admin_email off
    const inappOnly = await w.service.compose(creator(), { ...COMPOSE, channels: ["inapp"] });
    expect(typeof inappOnly).toBe("string");
  });

  it("start is refused as switched off when the email channel's flag was turned off after approval", async () => {
    const w = build();
    const id = await submitted(w);
    await w.service.approve(approver(), id, "service_announcement");
    w.setFlags({ master: true, adminMessaging: true, adminEmail: false });
    const error = await failure(() => w.service.start(creator(), id));
    expect(error.code).toBe("switched_off");
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("approved");
  });
});

describe("compose checks the input before it asks the database", () => {
  const bad: Array<[string, Partial<ComposeInput>]> = [
    ["an empty title", { title: "" }],
    ["a title over 80 characters", { title: "x".repeat(81) }],
    ["an empty body", { body: "" }],
    ["a body over 500 characters", { body: "y".repeat(501) }],
    ["a link that is not a same-origin path", { linkPath: "https://elsewhere.example/phish" }],
    ["a protocol-relative link", { linkPath: "//elsewhere.example" }],
    ["no channel", { channels: [] }],
    ["a repeated channel", { channels: ["email", "email"] }],
    ["an unknown segment", { segmentKey: "nobody-in-particular" as unknown as "everyone" }],
    ["a promotion with no consent line", { kind: "promotion" }],
  ];
  it.each(bad)("%s is refused as invalid input with no database call", async (_name, patch) => {
    const w = build({ master: true, adminMessaging: true, adminPromotions: true, adminEmail: true });
    const error = await failure(() => w.service.compose(creator(), { ...COMPOSE, ...patch }));
    expect(error.code).toBe("invalid_input");
    expect(w.calls).toEqual([]);
  });

  it("a valid message is created as a draft by the actor", async () => {
    const w = build();
    const id = await w.service.compose(creator(), COMPOSE);
    const row = w.backend.messages.find((m) => m.id === id)!;
    expect(row.status).toBe("draft");
    expect(row.requires_approval).toBe(true);
  });
});

describe("start, repeat and resume", () => {
  it("start returns the message id once; a repeat or a double submit sends nothing extra (null)", async () => {
    const w = build();
    const id = await submitted(w);
    await w.service.approve(approver(), id, "service_announcement");
    expect(await w.service.start(creator(), id)).toBe(id);
    expect(await w.service.start(creator(), id)).toBeNull();
  });

  it("resume is an explicit action on a paused message; a limit raised by a Super Admin never resumes it by itself", async () => {
    const w = build();
    const id = await submitted(w);
    await w.service.approve(approver(), id, "service_announcement");
    await w.service.start(creator(), id);
    await w.backend.pauseAdminMessageSend({ p_message: id, p_reason: "cap_24h" });
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("paused_email_cap");
    await w.service.setLimit(superAdmin(), "mass_email_cap_24h", 500);
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("paused_email_cap");
    expect(w.calls.filter((c) => c === "resumeAdminMessageSend")).toEqual([]);
    await w.service.resume(creator(), id);
    expect(w.backend.messages.find((m) => m.id === id)!.status).toBe("sending");
    expect(w.calls.filter((c) => c === "resumeAdminMessageSend")).toHaveLength(1);
  });
});

describe("the limits", () => {
  it("a Super Admin changes a limit through the database function with the session's actor, and the change is in the change log", async () => {
    const w = build();
    await w.service.setLimit(superAdmin(), "mass_email_cap_24h", 80);
    expect(w.backend.settings.find((s) => s.key === "mass_email_cap_24h")!.int_value).toBe(80);
    expect(w.backend.settingChanges.at(-1)).toMatchObject({ key: "mass_email_cap_24h", old_value: 50, new_value: 80, actor_admin_id: SUPER });
  });

  it("a value the database refuses (out of range) comes back as a refusal with its reason", async () => {
    const w = build();
    const error = await failure(() => w.service.setLimit(superAdmin(), "mass_email_ceiling_month", 10_001));
    expect(error.code).toBe("refused");
    expect(error.reason).toBe("setting_value_out_of_range");
  });

  it("limits() reports the cap, the ceiling, the last-24-hour count and the this-month count", async () => {
    const w = build();
    for (let i = 0; i < 4; i++) await w.backend.claimNotification({ p_user: `00000000-0000-4000-8000-00000000000${i}`, p_kind: "admin_message", p_subject: "99999999-9999-4999-8999-999999999999", p_channel: "email" });
    const l = await w.service.limits(creator());
    expect(l).toEqual({ cap24h: 50, ceilingMonth: 2000, sentLast24h: 4, sentThisMonth: 4 });
  });
});

describe("stale email claims (Fix 2)", () => {
  async function oneStaleClaim(w: ReturnType<typeof build>) {
    const claim = await w.backend.claimNotification({ p_user: "00000000-0000-4000-8000-000000000001", p_kind: "admin_message", p_subject: "99999999-9999-4999-8999-999999999999", p_channel: "email" });
    w.backend.advance(31 * 60_000);
    return claim.id!;
  }

  it("the stale-claim actions need the permission and appear in the audit", async () => {
    const w = build();
    const claim = await oneStaleClaim(w);
    const listed = await w.service.staleEmailClaims(creator());
    expect(listed.map((c) => c.id)).toContain(claim);
    expect((await failure(() => w.service.resolveStaleClaim(outsider(), claim, "mark_sent"))).code).toBe("permission_denied");
    await w.service.resolveStaleClaim(creator(), claim, "mark_sent");
    const events = w.backend.events.filter((e) => e.event === "claim_resolved");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_admin_id: CREATOR, detail: { resolution: "mark_sent" } });
  });

  it("only the two closed resolutions are accepted", async () => {
    const w = build();
    const claim = await oneStaleClaim(w);
    const error = await failure(() => w.service.resolveStaleClaim(creator(), claim, "delete_it" as unknown as "mark_sent"));
    expect(error.code).toBe("invalid_input");
  });
});
