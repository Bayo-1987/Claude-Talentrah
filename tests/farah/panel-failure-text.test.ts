/**
 * Farah (C): the "nothing was charged" note is HIDDEN BY DEFAULT.
 *
 * The note is a money claim. It is shown only for (a) an HTTP status that S3 has proven charge-free by test and listed in NOTHING_CHARGED_STATUSES, or (b) a stream `error` event whose `kind` S3 has proven
 * charge-free and listed in NOTHING_CHARGED_ERROR_KINDS (both in src/lib/farah/failure-note.ts), and nowhere else: an unlisted status, an unlisted or missing kind, and a dropped connection (which never
 * reaches this function) all show the existing wording WITHOUT the claim. Allowlists, not denylists, so a status or kind nobody has proven can never show it by accident. Adding to a list is the only way to
 * show the note. The tests swap both lists (vi.doMock), so they keep passing whatever S3 puts in them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOTE = "That reply didn't go through, and nothing was charged.";
const GENERIC = "Something went wrong — try again.";

async function withLists(statuses: readonly number[], kinds: readonly string[] = []) {
  vi.resetModules();
  const real = await vi.importActual<typeof import("@/lib/farah/failure-note")>("@/lib/farah/failure-note");
  vi.doMock("@/lib/farah/failure-note", () => ({ ...real, NOTHING_CHARGED_STATUSES: statuses, NOTHING_CHARGED_ERROR_KINDS: kinds }));
  const m = await import("@/lib/farah/panel-failure-text");
  return m.serverFailureText as (status: number | null, message?: string, kind?: string) => string;
}
const withList = (statuses: readonly number[]) => withLists(statuses, []);
afterEach(() => {
  vi.doUnmock("@/lib/farah/failure-note");
  vi.resetModules();
});

describe("with an EMPTY list (today's default) the note is hidden everywhere", () => {
  it.each([400, 401, 402, 403, 404, 429, 499, 500, 502, 503, 504])("status %i: the server's own words, no claim", async (status) => {
    const f = await withList([]);
    expect(f(status, "The server's words.")).toBe("The server's words.");
  });
  it("a missing status (the error event inside the stream) shows the server's words with no claim", async () => {
    const f = await withList([]);
    expect(f(null, "The server's words.")).toBe("The server's words.");
  });
  it("a failure with no message shows the generic line with no claim", async () => {
    const f = await withList([]);
    expect(f(500, undefined)).toBe(GENERIC);
    expect(f(null, undefined)).toBe(GENERIC);
  });
  it("nothing it returns ever mentions a charge", async () => {
    const f = await withList([]);
    for (const status of [null, 0, 200, 400, 401, 402, 429, 500, 503]) expect(f(status, undefined)).not.toMatch(/charged/i);
  });
});

describe("adding a status to the list is the ONLY way to show the note", () => {
  it("a listed status gets the server's words followed by the note", async () => {
    const f = await withList([429, 503]);
    expect(f(429, "Too many requests.")).toBe(`Too many requests. ${NOTE}`);
    expect(f(503, "Resting.")).toBe(`Resting. ${NOTE}`);
  });
  it("a listed status with no message gets the generic line and the note", async () => {
    const f = await withList([500]);
    expect(f(500, undefined)).toBe(`${GENERIC} ${NOTE}`);
  });
  it("a message that already says nothing was charged is not told twice", async () => {
    const f = await withList([503]);
    const busy = "Farah is busy right now. Please try again in a few minutes. You haven't been charged for this message.";
    expect(f(503, busy)).toBe(busy);
  });
  it("an UNLISTED status stays hidden even though others are listed", async () => {
    const f = await withList([429, 503]);
    for (const status of [400, 401, 402, 403, 404, 500, 502, 504, 499]) expect(f(status, "Words.")).toBe("Words.");
  });
  it("a missing status stays hidden however long the list is (the list holds statuses, never 'any')", async () => {
    const f = await withList([400, 401, 429, 500, 503]);
    expect(f(null, "Words.")).toBe("Words.");
  });
});

describe("a stream error event: shown only for a kind on the proven list", () => {
  it("with BOTH lists empty, no kind shows the note", async () => {
    const f = await withLists([], []);
    for (const kind of ["rate_limited", "unavailable", "empty_reply", "fallback_declined", "anything", undefined]) expect(f(null, "Words.", kind)).toBe("Words.");
  });
  it("a listed kind gets the server's words followed by the note", async () => {
    const f = await withLists([], ["unavailable", "empty_reply"]);
    expect(f(null, "Words.", "unavailable")).toBe(`Words. ${NOTE}`);
    expect(f(null, "Words.", "empty_reply")).toBe(`Words. ${NOTE}`);
  });
  it("a listed kind with no message gets the generic line and the note", async () => {
    const f = await withLists([], ["unavailable"]);
    expect(f(null, undefined, "unavailable")).toBe(`${GENERIC} ${NOTE}`);
  });
  it("an UNLISTED kind stays hidden even though others are listed", async () => {
    const f = await withLists([], ["unavailable"]);
    for (const kind of ["rate_limited", "empty_reply", "fallback_declined", "Unavailable", " unavailable", "", "unknown_kind"]) expect(f(null, "Words.", kind)).toBe("Words.");
  });
  it("a MISSING kind stays hidden however long the kind list is", async () => {
    const f = await withLists([], ["rate_limited", "unavailable", "empty_reply", "fallback_declined"]);
    expect(f(null, "Words.", undefined)).toBe("Words.");
    expect(f(null, "Words.")).toBe("Words.");
  });
  it("a kind never makes an HTTP failure show the note, and a status never makes a kind-less stream event show it", async () => {
    const f = await withLists([500], ["unavailable"]);
    expect(f(502, "Words.", "unavailable")).toBe("Words.");
    expect(f(500, "Words.", undefined)).toBe(`Words. ${NOTE}`);
    expect(f(null, "Words.", undefined)).toBe("Words.");
  });
  it("a message that already says nothing was charged is not told twice, for a listed kind either", async () => {
    const f = await withLists([], ["fallback_declined"]);
    const busy = "Farah is busy right now. Please try again in a few minutes. You haven't been charged for this message.";
    expect(f(null, busy, "fallback_declined")).toBe(busy);
  });
});

describe("the real lists and the panel", () => {
  it("the exported list holds only whole HTTP error statuses (400 to 599), with no duplicates", async () => {
    vi.doUnmock("@/lib/farah/failure-note");
    vi.resetModules();
    const { NOTHING_CHARGED_STATUSES = undefined } = (await import("@/lib/farah/failure-note")) as { NOTHING_CHARGED_STATUSES?: readonly number[] };
    if (!NOTHING_CHARGED_STATUSES) throw new Error("failure-note.ts does not export NOTHING_CHARGED_STATUSES");
    expect(Array.isArray(NOTHING_CHARGED_STATUSES)).toBe(true);
    for (const s of NOTHING_CHARGED_STATUSES) expect(Number.isInteger(s) && s >= 400 && s <= 599, `bad status ${s}`).toBe(true);
    expect(new Set(NOTHING_CHARGED_STATUSES).size).toBe(NOTHING_CHARGED_STATUSES.length);
  });
  it("the exported kind list holds only strings, with no duplicates, and none is blank", async () => {
    vi.doUnmock("@/lib/farah/failure-note");
    vi.resetModules();
    const { NOTHING_CHARGED_ERROR_KINDS = undefined } = (await import("@/lib/farah/failure-note")) as { NOTHING_CHARGED_ERROR_KINDS?: readonly string[] };
    if (!NOTHING_CHARGED_ERROR_KINDS) throw new Error("failure-note.ts does not export NOTHING_CHARGED_ERROR_KINDS");
    for (const k of NOTHING_CHARGED_ERROR_KINDS) expect(typeof k === "string" && k.trim() === k && k.length > 0, `bad kind ${k}`).toBe(true);
    expect(new Set(NOTHING_CHARGED_ERROR_KINDS).size).toBe(NOTHING_CHARGED_ERROR_KINDS.length);
  });
  it("a dropped connection never goes through the note: the panel's catch block keeps its own text and does not call serverFailureText", () => {
    const flat = readFileSync(join(__dirname, "../../src/components/app-shell/farah-panel.tsx"), "utf8").replace(/\s+/g, " ");
    expect(flat).toMatch(/\} catch \{ setError\("Couldn't reach Farah — check your connection and try again\."\);/);
    expect(flat).not.toMatch(/Couldn't reach Farah[^;]*(NOTHING_CHARGED|withNothingChargedNote|serverFailureText)/);
  });
  it("the panel sends every server-reported failure through the one function: the status for a failed request, and null with the event's kind for a stream error event", () => {
    const flat = readFileSync(join(__dirname, "../../src/components/app-shell/farah-panel.tsx"), "utf8").replace(/\s+/g, " ");
    expect(flat).toMatch(/setError\(serverFailureText\(res\.status, data\.error\)\)/);
    expect(flat).toMatch(/setError\(serverFailureText\(null, event\.message, event\.kind\)\)/);
  });
});
