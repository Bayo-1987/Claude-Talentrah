/**
 * The date must reach the panel, end to end, and keep reaching it whoever owns each link.
 *
 * The foundation puts `nextFreeMessageAt` on two responses; the stream reader rebuilds the `done` event field by field (it once dropped the new field, so no client could read it); the panel keeps it through
 * `readNextFreeMessageAt` and hands it to the note. Effects do not run in this project's Node test environment, so the panel's own handlers are pinned by source wiring (tests/farah/farah-panel-allowance-wiring.test.tsx);
 * this chain runs the REAL reader and the REAL text function on a `done` line shaped like the route's, and scans the two routes for the field. It fails if the route stops sending it, the reader stops passing it, or the
 * panel's reading function stops accepting it, wherever that change is made.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFarahChatStream } from "@/lib/farah/read-chat-stream";
import { farahAllowanceText, readNextFreeMessageAt } from "@/lib/credits/price-labels";

const read = (p: string) => readFileSync(join(__dirname, "../../", p), "utf8");
const NOW = new Date("2026-10-06T12:00:00.000Z");
const FUTURE = "2026-11-02T13:20:00.000Z";

async function doneFrom(done: object) {
  const body = [{ type: "delta", text: "Hi" }, { type: "done", id: "m1", createdAt: "t", ...done }].map((l) => `${JSON.stringify(l)}\n`).join("");
  for await (const e of readFarahChatStream(new Response(body))) if (e.type === "done") return e;
  throw new Error("no done event");
}

describe("nextFreeMessageAt reaches the allowance note, link by link", () => {
  it("a done line shaped like the route's becomes the dated sentence the panel shows", async () => {
    const event = await doneFrom({ freeMessagesRemaining: 0, nextFreeMessageAt: FUTURE, creditsBalance: null });
    const kept = readNextFreeMessageAt(event.nextFreeMessageAt);
    expect(kept).toBe(FUTURE);
    const parts = farahAllowanceText({ freeRemaining: event.freeMessagesRemaining, nextFreeMessageAt: kept, now: NOW, timeZone: "Africa/Lagos" });
    expect(parts?.when).toEqual({ iso: FUTURE, label: "Mon 2 Nov at 14:20" });
    expect(parts?.text).toContain("Your next free message is available on Mon 2 Nov at 14:20.");
  });
  it("a done line whose field is null, or absent (an older server), reaches the panel as no date", async () => {
    for (const done of [{ freeMessagesRemaining: 0, nextFreeMessageAt: null }, { freeMessagesRemaining: 0 }]) {
      const event = await doneFrom(done);
      const parts = farahAllowanceText({ freeRemaining: event.freeMessagesRemaining, nextFreeMessageAt: readNextFreeMessageAt(event.nextFreeMessageAt), now: NOW });
      expect(parts?.when).toBeNull();
    }
  });
  it("the chat route sends the field on both done events (saved and not saved)", () => {
    const route = read("src/app/api/farah/chat/route.ts").replace(/\s+/g, " ");
    expect(route.match(/persisted: (true|false), freeMessagesRemaining, nextFreeMessageAt,/g)?.length).toBe(2);
  });
  it("the history route sends the field beside freeMessagesRemaining", () => {
    const route = read("src/app/api/farah/history/route.ts").replace(/\s+/g, " ");
    expect(route).toMatch(/freeMessagesRemaining, nextFreeMessageAt, hasUnreadNotification/);
  });
  it("the panel reads the field from the history response and from the done event", () => {
    const panel = read("src/components/app-shell/farah-panel.tsx").replace(/\s+/g, " ");
    expect(panel).toMatch(/readNextFreeMessageAt\(data\.nextFreeMessageAt\)/);
    expect(panel).toMatch(/readNextFreeMessageAt\(event\.nextFreeMessageAt\)/);
  });
});
