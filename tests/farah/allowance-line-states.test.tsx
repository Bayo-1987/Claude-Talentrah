/**
 * The allowance line, one EXACT sentence per state, as the component renders it (the panel's own piece, not the pure function alone).
 * The price and its wording come from the same constant and helper the page uses (CREDIT_COSTS.farahChatMessage through creditsPhrase), never a literal,
 * so a price change moves the page and these expectations together and a swapped state cannot hide behind a loose match.
 *
 * - dated state (the free messages are used and the next one has a future time): "You've used your free messages. Your next free message is available on <date>. Until then, each message costs <price>." with the date in a <time>.
 * - undated state (used, and no date, or a date that has passed): "You've used your free messages. Each message costs <price>." with no <time> and no date sentence.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FarahAllowanceNote } from "@/components/app-shell/farah-quick-actions";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { creditsPhrase } from "@/lib/credits/price-labels";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const FUTURE = "2026-10-09T13:20:00.000Z"; // Fri 9 Oct at 14:20 in Lagos
const PRICE = creditsPhrase(CREDIT_COSTS.farahChatMessage);

type NoteProps = Parameters<typeof FarahAllowanceNote>[0] & { nextFreeMessageAt?: string | null; now?: Date; timeZone?: string };
const Note = FarahAllowanceNote as (p: NoteProps) => ReturnType<typeof FarahAllowanceNote>;
const html = (p: NoteProps) => renderToStaticMarkup(<>{Note(p)}</>);
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("the dated state", () => {
  const h = html({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" });
  it("reads exactly: used, next free message on the date, until then each message costs the price", () => {
    expect(text(h)).toBe(`You've used your free messages for now. Free messages come back 30 days after you use them; your next one is on Fri 9 Oct at 14:20 WAT. Until then, each message costs ${PRICE}.`);
  });
  it("has the date line: a <time> with the instant", () => {
    expect(h).toContain(`<time dateTime="${FUTURE}">Fri 9 Oct at 14:20 WAT</time>`);
  });
});

describe("the undated state (no date, a past date, or junk)", () => {
  it.each([null, "2026-10-01T00:00:00.000Z", "soon"])("reads exactly: used, each message costs the price; no date line (%s)", (v) => {
    const h = html({ freeRemaining: 0, nextFreeMessageAt: v, now: NOW, timeZone: "Africa/Lagos" });
    expect(text(h)).toBe(`You've used your free messages. Each message costs ${PRICE}.`);
    expect(h).not.toContain("<time");
    expect(h).not.toMatch(/your next one is on|Until then|come back/);
  });
});

describe("the two states are not interchangeable", () => {
  it("the wording that belongs to one state never appears in the other", () => {
    const dated = text(html({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" }));
    const undated = text(html({ freeRemaining: 0, nextFreeMessageAt: null, now: NOW }));
    expect(dated).not.toContain("Each message costs");
    expect(undated).not.toContain("each message costs");
    expect(dated).not.toBe(undated);
  });
});
