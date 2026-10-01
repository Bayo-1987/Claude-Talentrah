/**
 * send-500 — the client's stream parser hands `truncated` through from the `done` event, so the panel can say
 * the reply was cut off and was not charged. Absent (an older server, or any finished reply) must stay absent,
 * never become `true`.
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

describe("readFarahChatStream — done.truncated", () => {
  it("passes truncated: true through", async () => {
    const events = await collect(
      responseOf([{ type: "delta", text: "I'm a FinTech Product Manager with" }, { type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 3, creditsBalance: null, truncated: true }]),
    );
    expect(events.find((e) => e.type === "done")!.truncated).toBe(true);
  });

  it("is absent on a finished reply and on an older server", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 2, creditsBalance: 40 }]));
    expect(events[0].truncated).toBeUndefined();
  });
});
