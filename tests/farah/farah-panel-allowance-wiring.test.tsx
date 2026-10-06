/**
 * Farah (C): the panel's side of the allowance note and its failures.
 *
 * Effects and event handlers do not run under this project's Node test environment (see farah-panel-transcript.test.tsx), so what
 * can be pinned is (1) the note component itself, rendered statically with the same inputs the panel passes it, and (2) the wiring
 * in the panel's source: the error banner announces itself, the history and done paths keep `nextFreeMessageAt`, and the "nothing
 * was charged" note is used for server-reported failures and NOT for a dropped connection. Each source check asserts both halves,
 * so "always" and "never" fail alike.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FarahAllowanceNote } from "@/components/app-shell/farah-quick-actions";

const src = readFileSync(join(__dirname, "../../src/components/app-shell/farah-panel.tsx"), "utf8");
const flat = src.replace(/\s+/g, " ");
const NOW = new Date("2026-10-06T12:00:00.000Z");
const FUTURE = "2026-10-09T13:20:00.000Z";
type NoteProps = Parameters<typeof FarahAllowanceNote>[0] & { nextFreeMessageAt?: string | null; now?: Date; timeZone?: string };
const Note = FarahAllowanceNote as (p: NoteProps) => ReturnType<typeof FarahAllowanceNote>;
const render = (p: NoteProps) => renderToStaticMarkup(<>{Note(p)}</>);

describe("FarahAllowanceNote", () => {
  it("while free messages remain: one plain paragraph, no <time>", () => {
    const html = render({ freeRemaining: 2, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" });
    expect(html).toContain("2 free messages left.");
    expect(html).not.toContain("<time");
  });
  it("used up with a future time: the sentence reads in order and the date is a <time> with the ISO instant", () => {
    const html = render({ freeRemaining: 0, nextFreeMessageAt: FUTURE, now: NOW, timeZone: "Africa/Lagos" });
    expect(html).toContain(`<time dateTime="${FUTURE}">Fri 9 Oct at 14:20</time>`);
    expect(html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'")).toMatch(/^You've used your free messages\. Your next free message is available on Fri 9 Oct at 14:20\. Until then, each message costs \d+ credits?\.$/);
  });
  it("used up with null, a past time or junk: no <time>, no date sentence", () => {
    for (const v of [null, "2026-10-01T00:00:00.000Z", "soon"]) {
      const html = render({ freeRemaining: 0, nextFreeMessageAt: v, now: NOW, timeZone: "Africa/Lagos" });
      expect(html).not.toContain("<time");
      expect(html).not.toMatch(/available on/);
    }
  });
  it("an active Pass (null) and an unknown count (undefined) render nothing", () => {
    expect(render({ freeRemaining: null, nextFreeMessageAt: FUTURE, now: NOW })).toBe("");
    expect(render({ freeRemaining: undefined, now: NOW })).toBe("");
  });
});

describe("the panel's wiring", () => {
  it("the error banner is announced to a screen reader (role=alert)", () => {
    expect(flat).toMatch(/\{error && \( <p role="alert"[^>]*>\{error\}<\/p> \)\}/);
  });
  it("the history fetch keeps nextFreeMessageAt through readNextFreeMessageAt and hands it to the note", () => {
    expect(flat).toMatch(/readNextFreeMessageAt\(data\.nextFreeMessageAt\)/);
    expect(flat).toMatch(/<FarahAllowanceNote freeRemaining=\{freeRemaining\} nextFreeMessageAt=\{nextFreeMessageAt\} \/>/);
  });
  it("the done event keeps it too, and the last-free-message announcement is built from the event", () => {
    expect(flat).toMatch(/readNextFreeMessageAt\(event\.nextFreeMessageAt\)/);
    expect(flat).toMatch(/farahFreeUsedAnnouncement\(/);
  });
  it("server-reported failures (a failed request, a stream error event) go through serverFailureText", () => {
    expect(flat).toMatch(/setError\(serverFailureText\(res\.status, data\.error\)\)/);
    expect(flat).toMatch(/event\.type === "error"\) \{ setError\(serverFailureText\(null, event\.message\)\)/);
  });
  it("a dropped connection keeps its own text and gets no 'nothing was charged' claim", () => {
    const catchBlock = /\} catch \{ setError\("Couldn't reach Farah — check your connection and try again\."\);/;
    expect(flat).toMatch(catchBlock);
    expect(flat).not.toMatch(/Couldn't reach Farah[^;]*(NOTHING_CHARGED|withNothingChargedNote|serverFailureText)/);
  });
});
