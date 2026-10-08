/**
 * Farah (C): the line under Farah's greeting about the free-message allowance, as a pure function of what S3's foundation
 * returns (`freeMessagesRemaining`, `nextFreeMessageAt` as an ISO instant or null). Rows refer to reports/S1/2026-10-06-0940-farah-c-panel-copy.md.
 *
 * Rules pinned here: the date appears only once the free messages are used up (row 4), and only while it is in the future; null,
 * unparseable and past all mean NO date and no date sentence (row 5); a Pass holder (null count) and an unknown count get no text
 * (row 8); "in the last 30 days" is gone (D7); the price comes from CREDIT_COSTS, never a literal; the date text is the one the
 * formatter writes, in the viewer's zone, with no zone label. Reached through loadModule so the file compiles before the code exists.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";
import { CREDIT_COSTS } from "@/lib/credits/costs";

interface Parts {
  lead: string;
  when: { iso: string; label: string } | null;
  tail: string;
  text: string;
}
interface Opts {
  freeRemaining: number | null | undefined;
  nextFreeMessageAt?: unknown;
  now?: Date;
  timeZone?: string;
}
interface Mod {
  farahAllowanceText?: (o: Opts) => Parts | null;
  farahAllowanceLine?: (n: number) => string;
  readNextFreeMessageAt?: (v: unknown) => string | null;
  farahFreeUsedAnnouncement?: (o: { freeRemaining: number | null | undefined; paid: boolean; nextFreeMessageAt?: unknown; now?: Date; timeZone?: string }) => string | null;
}
async function fn<K extends keyof Mod>(name: K): Promise<NonNullable<Mod[K]>> {
  const m = await loadModule<Mod>("@/lib/credits/price-labels");
  const f = m[name];
  if (!f) throw new Error(`price-labels.ts does not export ${String(name)}`);
  return f as NonNullable<Mod[K]>;
}

const NOW = new Date("2026-10-06T12:00:00.000Z");
const FUTURE = "2026-10-09T13:20:00.000Z"; // Fri 9 Oct, 14:20 in Lagos
const price = `${CREDIT_COSTS.farahChatMessage} credit${CREDIT_COSTS.farahChatMessage === 1 ? "" : "s"}`;

describe("farahAllowanceText: free messages left (rows 1 to 3)", () => {
  it.each([
    [3, "3 free messages left."],
    [2, "2 free messages left."],
    [1, "1 free message left."],
  ])("%i left reads %s, with no date even when one is supplied", async (n, text) => {
    const f = await fn("farahAllowanceText");
    const parts = f({ freeRemaining: n, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" });
    expect(parts?.text).toBe(text);
    expect(parts?.when).toBeNull();
  });
  it("never says 'in the last 30 days' (D7)", async () => {
    const f = await fn("farahAllowanceText");
    for (const n of [0, 1, 2, 3]) expect(f({ freeRemaining: n, now: NOW })?.text).not.toMatch(/30 days/);
  });
});

describe("farahAllowanceText: used up (rows 4 and 5)", () => {
  it("row 4: a future time names the date, in the viewer's zone, with the price, and offers the time for a <time> element", async () => {
    const f = await fn("farahAllowanceText");
    const lagos = f({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" });
    expect(lagos?.text).toBe(
      `You've used your free messages for now. Free messages come back 30 days after you use them; your next one is on Fri 9 Oct at 14:20 WAT. Until then, each message costs ${price}.`,
    );
    expect(lagos?.when).toEqual({ iso: FUTURE, label: "Fri 9 Oct at 14:20 WAT" });
    expect(`${lagos?.lead}${lagos?.when?.label}${lagos?.tail}`).toBe(lagos?.text);
    const toronto = f({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "America/Toronto" });
    expect(toronto?.text).toContain("Fri 9 Oct at 09:20 EDT");
  });
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a time one second in the past", "2026-10-06T11:59:59.000Z"],
    ["exactly now", "2026-10-06T12:00:00.000Z"],
    ["an unparseable string", "soon"],
    ["an empty string", ""],
    ["a number", 1760000000000],
    ["a calendar date with no time", "2026-10-09"],
  ])("row 5: %s gives no date at all, only the price", async (_label, value) => {
    const f = await fn("farahAllowanceText");
    const parts = f({ freeRemaining: 0, nextFreeMessageAt: value, now: NOW, timeZone: "Africa/Lagos" });
    expect(parts?.text).toBe(`You've used your free messages. Each message costs ${price}.`);
    expect(parts?.when).toBeNull();
    expect(parts?.text).not.toMatch(/available on|Until then/);
  });
  it("a time one second in the future still counts as a date", async () => {
    const f = await fn("farahAllowanceText");
    const parts = f({ freeRemaining: 0, nextFreeMessageAt: "2026-10-06T12:00:01.000Z", now: NOW, timeZone: "Africa/Lagos" });
    expect(parts?.when?.iso).toBe("2026-10-06T12:00:01.000Z");
  });
  it("names the viewer's own zone after the time, from the zone itself (never a hard-coded WAT), and says why the date is that far away", async () => {
    const f = await fn("farahAllowanceText");
    const text = (timeZone: string) => f({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone })?.text ?? "";
    expect(text("Africa/Lagos")).toContain("Fri 9 Oct at 14:20 WAT");
    expect(text("America/Toronto")).toContain("Fri 9 Oct at 09:20 EDT");
    expect(text("Europe/London")).toContain("Fri 9 Oct at 14:20 BST");
    expect(text("Asia/Kathmandu")).toContain("Fri 9 Oct at 19:05 Nepal time"); // only an offset name exists: the long generic name is the clean fallback
    expect(text("Africa/Lagos")).toContain("Free messages come back 30 days after you use them");
  });
  it("the 30 days in the sentence is the allowance window itself, so the sentence cannot drift from the rule", async () => {
    const { FARAH_CHAT_FREE_WINDOW_DAYS } = await import("@/lib/farah/free-allowance");
    const f = await fn("farahAllowanceText");
    expect(f({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" })?.text).toContain(`${FARAH_CHAT_FREE_WINDOW_DAYS} days after you use them`);
  });
  it("the date shown is the OLDEST counted message plus 30 days (nextFreeMessageAt, then the line, in the viewer's zone)", async () => {
    const { nextFreeMessageAt } = await import("@/lib/farah/free-allowance");
    const f = await fn("farahAllowanceText");
    const used = ["2026-09-12T05:01:00.000Z", "2026-09-20T10:00:00.000Z", "2026-09-30T08:30:00.000Z"]; // three counted free messages
    const next = nextFreeMessageAt(used, NOW);
    expect(next?.toISOString()).toBe("2026-10-12T05:01:00.000Z"); // 12 Sep 05:01Z + 30 days
    const line = f({ freeRemaining: 0, nextFreeMessageAt: next?.toISOString(), now: NOW, timeZone: "Africa/Lagos" });
    expect(line?.when?.label).toBe("Mon 12 Oct at 06:01 WAT");
  });
});

describe("farahAllowanceText: no text (row 8)", () => {
  it("an active Pass (null) and an unknown count (undefined) render nothing, even with a date supplied", async () => {
    const f = await fn("farahAllowanceText");
    expect(f({ freeRemaining: null, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
    expect(f({ freeRemaining: undefined, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
  });
});

describe("farahAllowanceLine keeps its one-argument form for existing callers", () => {
  it("is the same text as farahAllowanceText", async () => {
    const line = await fn("farahAllowanceLine");
    expect(line(2)).toBe("2 free messages left.");
    expect(line(0)).toBe(`You've used your free messages. Each message costs ${price}.`);
  });
});

describe("readNextFreeMessageAt: what the panel keeps from a response", () => {
  it("keeps a valid ISO instant and turns everything else into null", async () => {
    const r = await fn("readNextFreeMessageAt");
    expect(r(FUTURE)).toBe(FUTURE);
    for (const bad of [null, undefined, "", "soon", 5, {}, [], true, "2026-10-09", "2026-13-45T25:61:00Z"]) expect(r(bad)).toBeNull();
  });
});

describe("farahFreeUsedAnnouncement: row 11, the last free message was just used", () => {
  it("a free message that left 0 announces the date", async () => {
    const a = await fn("farahFreeUsedAnnouncement");
    expect(a({ freeRemaining: 0, paid: false, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" })).toBe(
      "No free messages left. Your next free message is available on Fri 9 Oct at 14:20 WAT.",
    );
  });
  it("with no usable date it says only the price, never a date", async () => {
    const a = await fn("farahFreeUsedAnnouncement");
    expect(a({ freeRemaining: 0, paid: false, nextFreeMessageAt: null, now: NOW })).toBe(`No free messages left. Each message costs ${price}.`);
  });
  it("says nothing when a paid message was sent (it did not use a free one), when free messages remain, for a Pass, or when unknown", async () => {
    const a = await fn("farahFreeUsedAnnouncement");
    expect(a({ freeRemaining: 0, paid: true, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
    expect(a({ freeRemaining: 1, paid: false, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
    expect(a({ freeRemaining: null, paid: false, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
    expect(a({ freeRemaining: undefined, paid: false, nextFreeMessageAt: FUTURE, now: NOW })).toBeNull();
  });
});
