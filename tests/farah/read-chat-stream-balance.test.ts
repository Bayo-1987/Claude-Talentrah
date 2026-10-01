/**
 * send-485 (issue #605) — the client's stream parser hands `creditsBalance` through from the `done`
 * event. A number updates the masthead; `null` (free/Pass-covered) and an absent field (an older
 * server) both mean "leave it alone", so the parser must not turn either into a number.
 */
import { describe, expect, it } from "vitest";
import { readFarahChatStream } from "@/lib/farah/read-chat-stream";

function responseOf(lines: object[]): Response {
  return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
async function collect(res: Response) {
  const out: Array<Record<string, unknown>> = [];
  for await (const e of readFarahChatStream(res)) out.push(e as unknown as Record<string, unknown>);
  return out;
}

describe("readFarahChatStream — done.creditsBalance", () => {
  it("passes a numeric balance through", async () => {
    const events = await collect(responseOf([{ type: "delta", text: "Hi" }, { type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 0, creditsBalance: 40 }]));
    expect(events.find((e) => e.type === "done")!.creditsBalance).toBe(40);
  });

  it("passes null through as null (free or Pass-covered message)", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 2, creditsBalance: null }]));
    expect(events[0].creditsBalance).toBeNull();
  });

  it("leaves it undefined when an older server never sent it", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 2 }]));
    expect(events[0].creditsBalance).toBeUndefined();
  });

  it("still carries the free-message counter alongside it", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 1, creditsBalance: 40 }]));
    expect(events[0].freeMessagesRemaining).toBe(1);
  });
});
