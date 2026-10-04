/**
 * Message history is written by the server only. DATABASE-BACKED, CI only. Every write shape found by the reader scan, replayed through PostgREST as the signed-in user (and as the service role for the
 * shapes the server uses), plus the reads the app depends on. Writes by the signed-in role are refused at the grant level (42501); reads, the service role's writes, and the cascade are unaffected.
 *
 * (Local stand-in for this file: the same shapes replayed on an in-memory Postgres before and after the change; see the S3-92 report.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";

let user: Awaited<ReturnType<typeof createAuthedTestUser>>;
let rowId: string;
beforeAll(async () => {
  user = await createAuthedTestUser("farah-shapes");
  const { data, error } = await admin.from("farah_messages").insert({ user_id: user.id, role: "user", content: "mine" }).select("id").single();
  if (error) throw error;
  rowId = data!.id;
}, 60_000);
afterAll(async () => {
  await admin.from("farah_messages").delete().eq("user_id", user.id);
  await deleteTestUsers([user.id]);
}, 60_000);

describe("signed-in writes to farah_messages are refused at the grant level", () => {
  it("insert (no returning)", async () => {
    expect((await user.client.from("farah_messages").insert({ user_id: user.id, role: "user", content: "x" })).error?.code).toBe("42501");
  });
  it("insert with returning", async () => {
    expect((await user.client.from("farah_messages").insert({ user_id: user.id, role: "farah", content: "x" }).select("id, created_at").single()).error?.code).toBe("42501");
  });
  it("upsert", async () => {
    expect((await user.client.from("farah_messages").upsert({ id: rowId, user_id: user.id, role: "user", content: "y" }).select("id")).error?.code).toBe("42501");
  });
  it("update", async () => {
    expect((await user.client.from("farah_messages").update({ content: "z" }).eq("id", rowId)).error?.code).toBe("42501");
  });
  it("delete, and delete with returning", async () => {
    expect((await user.client.from("farah_messages").delete().eq("id", rowId)).error?.code).toBe("42501");
    expect((await user.client.from("farah_messages").delete().eq("id", rowId).select("id")).error?.code).toBe("42501");
  });
  it("nothing changed: the row is intact and no row was added", async () => {
    const { data } = await admin.from("farah_messages").select("id, content").eq("user_id", user.id);
    expect(data).toEqual([{ id: rowId, content: "mine" }]);
  });
});

describe("what the app depends on still works", () => {
  it("the signed-in user reads its own rows: the hourly count shape and the history shape", async () => {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const count = await user.client.from("farah_messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("role", "user").gte("created_at", since);
    expect(count.error).toBeNull();
    expect(count.count).toBe(1);
    const history = await user.client.from("farah_messages").select("role, content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(12);
    expect(history.error).toBeNull();
    expect(history.data).toEqual([{ role: "user", content: "mine" }]);
  });

  it("the service role writes and deletes (what the chat route and the e2e fixtures do)", async () => {
    const inserted = await admin.from("farah_messages").insert({ user_id: user.id, role: "farah", content: "server-written" }).select("id").single();
    expect(inserted.error).toBeNull();
    expect((await admin.from("farah_messages").delete().eq("id", inserted.data!.id)).error).toBeNull();
  });

  it("the session events table stays server-written: a signed-in insert is refused, the service role's works", async () => {
    expect((await user.client.from("farah_session_events").insert({ user_id: user.id, session_id: crypto.randomUUID(), event_type: "started" } as never)).error?.code).toBe("42501");
    const ok = await admin.from("farah_session_events").insert({ user_id: user.id, session_id: crypto.randomUUID(), event_type: "started", entry_point: "free_text" } as never);
    expect(ok.error).toBeNull();
    await admin.from("farah_session_events").delete().eq("user_id", user.id);
  });
});
