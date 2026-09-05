/**
 * logFarahSessionMessage — the counter behind Stage 21's second follow-up:
 * which entry point starts a Farah session, and whether that session ever
 * gets a second user message. Tested against the real database (migration
 * 0097), the same way tracker-and-farah.test.ts tests real `farah_messages`
 * rows.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { logFarahSessionMessage } from "@/lib/farah/session-events";

const createdUserIds: string[] = [];

afterAll(async () => {
  await admin.from("farah_session_events").delete().in("user_id", createdUserIds);
  await deleteTestUsers(createdUserIds);
});

async function freshUser() {
  const user = await createAuthedTestUser("farah-session-events");
  createdUserIds.push(user.id);
  return user;
}

describe("the first message of a session logs 'started' with its entry point", () => {
  it("inserts exactly one 'started' row, carrying the entry point passed in", async () => {
    const user = await freshUser();
    const sessionId = randomUUID();

    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "career-advisor" });

    const { data, error } = await admin
      .from("farah_session_events")
      .select("event_type, entry_point, user_id")
      .eq("session_id", sessionId);

    expect(error).toBeNull();
    expect(data).toEqual([
      { event_type: "started", entry_point: "career-advisor", user_id: user.id },
    ]);
  });

  it("free-text (no quick action) logs entry_point 'free_text'", async () => {
    const user = await freshUser();
    const sessionId = randomUUID();

    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "free_text" });

    const { data } = await admin
      .from("farah_session_events")
      .select("entry_point")
      .eq("session_id", sessionId)
      .single();
    expect(data?.entry_point).toBe("free_text");
  });
});

describe("a second message logs 'reached_second_message', at most once", () => {
  it("logs it on the second call and NOT again on a third", async () => {
    const user = await freshUser();
    const sessionId = randomUUID();

    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "interview-prep" });
    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "interview-prep" });
    await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "interview-prep" });

    const { data } = await admin
      .from("farah_session_events")
      .select("event_type")
      .eq("session_id", sessionId)
      .eq("event_type", "reached_second_message");

    // A third and fourth message must not insert duplicate rows — the
    // question this answers is "did this session ever reach a second
    // message", not "how many messages did it have".
    expect(data).toHaveLength(1);
  });

  it(
    "SABOTAGE-PROOF TARGET: a second message's own entry point is IGNORED — the ORIGINAL is what's recorded",
    async () => {
      // A session's second-plus message never carries its own quick action
      // (the user is just typing by then); resolveEntryPoint in
      // chat/route.ts would always resolve that to 'free_text'. If this
      // function trusted a freshly-passed value instead of looking up the
      // session's own 'started' row, every second-plus message would
      // misattribute the session to 'free_text' regardless of how it
      // actually began.
      const user = await freshUser();
      const sessionId = randomUUID();

      await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "salary-negotiation" });
      // A later call passes a DIFFERENT entry point on purpose, simulating
      // what a buggy caller (or a route that trusted the request body
      // instead of looking the session up) might send.
      await logFarahSessionMessage({ userId: user.id, sessionId, entryPoint: "free_text" });

      const { data } = await admin
        .from("farah_session_events")
        .select("entry_point")
        .eq("session_id", sessionId)
        .eq("event_type", "reached_second_message")
        .single();

      expect(data?.entry_point).toBe("salary-negotiation");
    },
  );
});

describe("two different sessions never interfere with each other", () => {
  it("keeps each session's own 'started' row independent", async () => {
    const user = await freshUser();
    const sessionA = randomUUID();
    const sessionB = randomUUID();

    await logFarahSessionMessage({ userId: user.id, sessionId: sessionA, entryPoint: "career-advisor" });
    await logFarahSessionMessage({ userId: user.id, sessionId: sessionB, entryPoint: "interview-prep" });

    const { data } = await admin
      .from("farah_session_events")
      .select("session_id, entry_point")
      .in("session_id", [sessionA, sessionB])
      .eq("event_type", "started");

    expect(data).toHaveLength(2);
    expect(data?.find((r) => r.session_id === sessionA)?.entry_point).toBe("career-advisor");
    expect(data?.find((r) => r.session_id === sessionB)?.entry_point).toBe("interview-prep");
  });
});
