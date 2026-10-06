/**
 * The client's stream parser hands `nextFreeMessageAt` through from the `done` event. The chat route sends it (an ISO time, or null; see docs/farah-foundation.md), and the reader is the other half of that
 * contract: it rebuilds the `done` event field by field, so a field it does not copy never reaches any client. A time is the moment the next free message comes back; `null` means "show no date"; and an
 * absent field (an older server) also means "show no date", so the parser must not turn any of the three into another.
 */
import { describe, expect, it } from "vitest";
import { readFarahChatStream, type FarahChatStreamEvent } from "@/lib/farah/read-chat-stream";

function responseOf(lines: object[]): Response {
  return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
async function collect(res: Response) {
  const out: FarahChatStreamEvent[] = [];
  for await (const e of readFarahChatStream(res)) out.push(e);
  return out;
}
const doneOf = (events: FarahChatStreamEvent[]) => events.find((e): e is Extract<FarahChatStreamEvent, { type: "done" }> => e.type === "done")!;

describe("readFarahChatStream: done.nextFreeMessageAt", () => {
  it("passes an ISO time through, unchanged and still a string", async () => {
    const events = await collect(responseOf([{ type: "delta", text: "Hi" }, { type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 0, nextFreeMessageAt: "2026-11-05T12:00:00.000Z", creditsBalance: null }]));
    expect(doneOf(events).nextFreeMessageAt).toBe("2026-11-05T12:00:00.000Z");
    expect(typeof doneOf(events).nextFreeMessageAt).toBe("string");
  });

  it("passes null through as null (show no date), not as absent and not as a string", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 2, nextFreeMessageAt: null }]));
    expect(doneOf(events).nextFreeMessageAt).toBeNull();
    expect("nextFreeMessageAt" in doneOf(events)).toBe(true);
  });

  it("leaves it absent when an older server never sent it (the key is not added)", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 2 }]));
    expect(doneOf(events).nextFreeMessageAt).toBeUndefined();
    expect("nextFreeMessageAt" in doneOf(events)).toBe(false);
  });

  it("hands the panel nothing but a string, null or absent: any other value from a misbehaving server is dropped, never passed on or turned into a string", async () => {
    for (const bad of [0, 1_793_880_000_000, true, false, {}, [], ["2026-11-05T12:00:00.000Z"]]) {
      const events = await collect(responseOf([{ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 0, nextFreeMessageAt: bad }]));
      expect("nextFreeMessageAt" in doneOf(events), JSON.stringify(bad)).toBe(false);
    }
  });

  it("works on the not-saved variant of the event too (id null, persisted false)", async () => {
    const events = await collect(responseOf([{ type: "done", id: null, createdAt: "t", persisted: false, freeMessagesRemaining: 0, nextFreeMessageAt: "2026-11-05T12:00:00.000Z", creditsBalance: 4 }]));
    expect(doneOf(events)).toMatchObject({ id: null, nextFreeMessageAt: "2026-11-05T12:00:00.000Z", creditsBalance: 4 });
  });

  it("leaves every other field exactly as before: the free count, the balance, a cut-off flag, the id and the time", async () => {
    const events = await collect(responseOf([{ type: "done", id: "m9", createdAt: "2026-01-01T00:00:00.000Z", freeMessagesRemaining: 1, creditsBalance: 40, truncated: true, nextFreeMessageAt: null }]));
    expect(doneOf(events)).toEqual({ type: "done", id: "m9", createdAt: "2026-01-01T00:00:00.000Z", freeMessagesRemaining: 1, creditsBalance: 40, truncated: true, nextFreeMessageAt: null });
  });

  it("is carried on the event the callback receives when the line is split across network chunks", async () => {
    const line = `${JSON.stringify({ type: "done", id: "m1", createdAt: "t", freeMessagesRemaining: 0, nextFreeMessageAt: "2026-11-05T12:00:00.000Z" })}\n`;
    const half = Math.floor(line.length / 2);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(line.slice(0, half)));
        c.enqueue(encoder.encode(line.slice(half)));
        c.close();
      },
    });
    const events = await collect(new Response(body));
    expect(doneOf(events).nextFreeMessageAt).toBe("2026-11-05T12:00:00.000Z");
  });
});
