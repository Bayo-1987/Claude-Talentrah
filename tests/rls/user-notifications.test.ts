/**
 * 0128 — `user_notifications`, the in-app half of send-138's proactive
 * alert. First in-app notification table this app has, so nothing else
 * pins its RLS shape yet: owner-readable, owner may write ONLY `read_at`
 * (0030's own column-grant-vs-row-policy lesson, applied here), and
 * unreachable for INSERT from anywhere but service_role.
 *
 * The isolation bar is this repo's standing one: prove the cross-user case
 * fails before trusting the owner case works.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let seekerA: AuthedTestUser;
let seekerB: AuthedTestUser;
let notificationIdA: string;
let notificationIdB: string;

beforeAll(async () => {
  [seekerA, seekerB] = await Promise.all([
    createAuthedTestUser("un-seeker-a"),
    createAuthedTestUser("un-seeker-b"),
  ]);

  const [{ data: notifA, error: errA }, { data: notifB, error: errB }] = await Promise.all([
    admin
      .from("user_notifications")
      .insert({
        user_id: seekerA.id,
        type: "proactive_match_alert",
        title: "An exceptional match just for you",
        body: "Fixture notification for seeker A.",
        link: "/jobs/fixture-a",
      })
      .select("id")
      .single(),
    admin
      .from("user_notifications")
      .insert({
        user_id: seekerB.id,
        type: "proactive_match_alert",
        title: "An exceptional match just for you",
        body: "Fixture notification for seeker B.",
        link: "/jobs/fixture-b",
      })
      .select("id")
      .single(),
  ]);
  if (errA || !notifA) throw new Error(`fixture notification A: ${errA?.message}`);
  if (errB || !notifB) throw new Error(`fixture notification B: ${errB?.message}`);
  notificationIdA = notifA.id;
  notificationIdB = notifB.id;
});

afterAll(async () => {
  const { error: delErr } = await admin
    .from("user_notifications")
    .delete()
    .in("id", [notificationIdA, notificationIdB]);
  if (delErr) throw new Error(`cleanup notifications: ${delErr.message}`);
  await deleteTestUsers([seekerA.id, seekerB.id]);
});

describe("user_notifications — owner-only read and read_at-only write", () => {
  it("the owner can read their own notification", async () => {
    const { data, error } = await seekerA.client
      .from("user_notifications")
      .select("id, title, body")
      .eq("id", notificationIdA)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(notificationIdA);
  });

  it("a different signed-in user cannot read it — the cross-user case, checked first", async () => {
    const { data, error } = await seekerB.client
      .from("user_notifications")
      .select("id")
      .eq("id", notificationIdA)
      .maybeSingle();
    // RLS makes an unauthorized row invisible, not an error — same shape as
    // every other owner-scoped table in this app.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("the owner can mark their own notification read", async () => {
    const { error } = await seekerA.client
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationIdA);
    expect(error).toBeNull();

    const { data } = await admin
      .from("user_notifications")
      .select("read_at")
      .eq("id", notificationIdA)
      .single();
    expect(data?.read_at).not.toBeNull();
  });

  it("a different signed-in user's update has no effect on someone else's notification", async () => {
    // Not a permission ERROR — the row is simply outside their RLS-visible
    // set, so the update matches zero rows, exactly like the read case.
    const { error } = await seekerB.client
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationIdA);
    expect(error).toBeNull();

    const { data } = await admin.from("user_notifications").select("title").eq("id", notificationIdA).single();
    // Title is untouched — the only thing the owner-update test above
    // legitimately changed on this row was read_at.
    expect(data?.title).toBe("An exceptional match just for you");
  });

  it("0030's own lesson: the owner cannot rewrite title/body on their own row, only read_at", async () => {
    const { error } = await seekerA.client
      .from("user_notifications")
      .update({ title: "Rewritten by the owner" })
      .eq("id", notificationIdA);
    // A row policy permits touching the ROW; the column grant is what
    // actually decides which columns. This must be refused at the column
    // level even though the row-level UPDATE policy would allow it.
    expect(error).not.toBeNull();

    const { data } = await admin.from("user_notifications").select("title").eq("id", notificationIdA).single();
    expect(data?.title).toBe("An exceptional match just for you");
  });

  it("a signed-in user cannot INSERT a notification for themselves directly", async () => {
    const { error } = await seekerA.client.from("user_notifications").insert({
      user_id: seekerA.id,
      type: "proactive_match_alert",
      title: "Self-inserted",
      body: "Should never land — only service_role writes this table.",
    });
    expect(error).not.toBeNull();
  });

  it("a signed-in user cannot INSERT a notification claiming to be someone else", async () => {
    const { error } = await seekerA.client.from("user_notifications").insert({
      user_id: seekerB.id,
      type: "proactive_match_alert",
      title: "Forged",
      body: "Should never land.",
    });
    expect(error).not.toBeNull();
  });
});
