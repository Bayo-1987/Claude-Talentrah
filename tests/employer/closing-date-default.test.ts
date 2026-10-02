/**
 * EMP-1 / E3 — a NEW employer posting closes in 30 days unless the employer says otherwise, and the 30 days count from
 * the moment candidates can first see the job.
 *
 * Every closing date carries where it came from, `job_postings.closing_date_source` (migration 0207):
 *
 *   'default'   the server applied the 30 days (the form said nothing, or its preselected "30 days" was left as it was)
 *   'chosen'    the employer picked a date, or an EDIT changed it
 *   null        no closing date at all, or a legacy row that predates the column. A legacy row COUNTS AS CHOSEN.
 *
 * Publishing a draft restarts ONLY a 'default' date. A date the employer chose is never moved: if it has passed the
 * publish is refused, and if it is under 3 days away the employer is warned and may publish anyway.
 *
 * Nothing here needs a database. The Server Actions run against recording fakes of the session and service clients.
 * The column is not writable by `authenticated`, so every write to it goes through the service role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSING_DATE_PASSED_MESSAGE,
  DEFAULT_NEW_POSTING_EXPIRY_DAYS,
  closesSoonMessage,
  readExpiry,
} from "@/lib/employer/expiry-input";

const DAY = 86_400_000;

type Filter = [string, string];
type Write = { payload: Record<string, unknown>; filters: Filter[] };

const captured = vi.hoisted(() => ({
  insert: null as Record<string, unknown> | null,
  update: null as null | { payload: Record<string, unknown>; filters: Array<[string, string]> },
  updateCalls: 0,
  /** What the draft row looks like to the publish action's read. null = no such row. */
  draftRow: null as null | {
    id: string;
    status: string;
    source_type: string;
    expires_at: string | null;
    closing_date_source: string | null;
  },
  updateReturns: [{ id: "job-1" }] as Array<{ id: string }>,
  adminUpdates: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, string]> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ organization: { id: "org-1", name: "Acme Ltd", verified: true } }),
}));

function chain(result: () => unknown, onFilter?: (op: string, col: string) => void) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "not", "lt", "lte", "gt", "gte", "in", "or", "order", "limit"]) {
    b[m] = (col?: string) => {
      onFilter?.(m, String(col));
      return b;
    };
  }
  b.single = async () => result();
  b.maybeSingle = async () => result();
  b.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        captured.insert = payload;
        return chain(() => ({ data: { id: "job-1" }, error: null }));
      },
      update: (payload: Record<string, unknown>) => {
        const rec = { payload, filters: [] as Filter[] };
        captured.update = rec;
        captured.updateCalls++;
        return chain(
          () => ({ data: captured.updateReturns, error: null }),
          (op, col) => rec.filters.push([op, col]),
        );
      },
      select: () => chain(() => ({ data: captured.draftRow, error: null })),
      delete: () => chain(() => ({ data: [], error: null })),
    }),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const rec = { payload, filters: [] as Filter[] };
        captured.adminUpdates.push(rec);
        return chain(
          () => ({ data: [{ id: "job-1" }], error: null }),
          (op, col) => rec.filters.push([op, col]),
        );
      },
    }),
  }),
}));

const { postJobAction, updateJobAction, publishJobAction, publishDraftFormAction } = await import(
  "@/lib/employer/actions"
);

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  f.set("title", "Backend Engineer");
  f.set("location", "Lagos");
  f.set("description", "A real job description, long enough to pass the form's forty-character minimum.");
  f.append("skills", "sql");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function runAndCatchRedirect(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string } | undefined)?.digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
  }
}

/** Every write to closing_date_source, whichever table call made it. */
const sourceWrites = () =>
  captured.adminUpdates.filter((u) => "closing_date_source" in u.payload).map((u) => u.payload.closing_date_source);

beforeEach(() => {
  captured.insert = null;
  captured.update = null;
  captured.updateCalls = 0;
  captured.draftRow = null;
  captured.updateReturns = [{ id: "job-1" }];
  captured.adminUpdates.length = 0;
});

describe("readExpiry: the default is a server-side duration", () => {
  const NOW = new Date("2026-10-02T12:00:00.000Z");
  const f = (fields: Record<string, string>) => {
    const x = new FormData();
    for (const [k, v] of Object.entries(fields)) x.set(k, v);
    return x;
  };

  it("is 30 days", () => {
    expect(DEFAULT_NEW_POSTING_EXPIRY_DAYS).toBe(30);
  });

  it("a creation form that never mentions the field closes in exactly 30 days from the server's clock", () => {
    const out = readExpiry(f({}), NOW, { defaultDays: DEFAULT_NEW_POSTING_EXPIRY_DAYS });
    expect(out).toEqual({ ok: true, value: new Date(NOW.getTime() + 30 * DAY).toISOString() });
  });

  it("an explicit 'No expiry' (the field posted empty) is still honoured", () => {
    expect(readExpiry(f({ expiresIn: "" }), NOW, { defaultDays: 30 })).toEqual({ ok: true, value: null });
  });

  it("an explicit choice beats the default", () => {
    const out = readExpiry(f({ expiresIn: "7" }), NOW, { defaultDays: 30 });
    expect(out).toEqual({ ok: true, value: new Date(NOW.getTime() + 7 * DAY).toISOString() });
  });

  it("without the option nothing changes: a missing field is still 'no expiry' (the edit path)", () => {
    expect(readExpiry(f({}), NOW)).toEqual({ ok: true, value: null });
    expect(readExpiry(f({ expiresIn: "keep" }), NOW, undefined)).toEqual({ ok: true, value: undefined });
  });
});

describe("postJobAction: new employer postings", () => {
  it("defaults to closing in 30 days when the form says nothing, and the date is computed here", async () => {
    const before = Date.now();
    await runAndCatchRedirect(() => postJobAction(null, form({})));
    const after = Date.now();

    expect(captured.insert).not.toBeNull();
    expect(captured.insert!.source_type).toBe("internal");
    const at = new Date(captured.insert!.expires_at as string).getTime();
    expect(at).toBeGreaterThanOrEqual(before + 30 * DAY - 5);
    expect(at).toBeLessThanOrEqual(after + 30 * DAY + 5);
  });

  it("a direct create-and-publish is open at once with creation + 30 days", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ intent: "publish" })));
    expect(captured.insert!.status).toBe("open");
    expect(new Date(captured.insert!.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("ignores a hand-posted DATE for the default: only the duration choice or the custom date field are read", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expires_at: "2020-01-01T00:00:00.000Z" })));
    const at = new Date(captured.insert!.expires_at as string).getTime();
    expect(at).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("'No expiry' stays selectable and writes null", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "" })));
    expect(captured.insert!.expires_at).toBeNull();
  });

  it("a draft gets the same default (it is restarted from first publish; see below)", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ intent: "draft" })));
    expect(captured.insert!.status).toBe("draft");
    expect(new Date(captured.insert!.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });
});

describe("closing_date_source: where the date came from, recorded on the server", () => {
  it("never travels in the INSERT the employer's session makes (the column is not theirs to write)", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({})));
    expect("closing_date_source" in captured.insert!).toBe(false);
  });

  it("DEFAULT APPLIED: a form that never mentioned the closing date records 'default'", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({})));
    expect(sourceWrites()).toEqual(["default"]);
    // …through the service role, scoped to the row that was just created.
    const w = captured.adminUpdates.find((u) => "closing_date_source" in u.payload)!;
    expect(w.filters.map(([op, col]) => `${op}:${col}`)).toContain("eq:id");
  });

  it("DEFAULT APPLIED: the form's preselected '30 days', left as it was, records 'default' too", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "30" })));
    expect(sourceWrites()).toEqual(["default"]);
  });

  it("CHOSEN: any other duration records 'chosen'", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "7" })));
    expect(sourceWrites()).toEqual(["chosen"]);
  });

  it("CHOSEN: a custom date records 'chosen'", async () => {
    const day = new Date(Date.now() + 21 * DAY).toISOString().slice(0, 10);
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "custom", expiresOn: day })));
    expect(sourceWrites()).toEqual(["chosen"]);
  });

  it("NO EXPIRY: the date AND the source both stay null (nothing is written for the source)", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "" })));
    expect(captured.insert!.expires_at).toBeNull();
    expect(sourceWrites()).toEqual([]);
  });

  it("EDIT THAT CHANGES THE DATE: records 'chosen', even when the new date is '30 days'", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "14" })));
    expect(sourceWrites()).toEqual(["chosen"]);
    captured.adminUpdates.length = 0;
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "30" })));
    expect(sourceWrites()).toEqual(["chosen"]);
  });

  it("EDIT TO 'No expiry': clears the source along with the date", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "" })));
    expect(captured.update!.payload.expires_at).toBeNull();
    expect(sourceWrites()).toEqual([null]);
  });

  it("EDIT THAT LEAVES THE DATE ('Keep current'): neither the date nor the source is written", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "keep" })));
    expect("expires_at" in captured.update!.payload).toBe(false);
    expect(sourceWrites()).toEqual([]);
  });

  it("an edit's session write never carries the source column", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "14" })));
    expect("closing_date_source" in captured.update!.payload).toBe(false);
  });
});

describe("updateJobAction: an existing posting keeps what it has", () => {
  it("'keep' does not write the column", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "keep" })));
    expect(captured.update).not.toBeNull();
    expect("expires_at" in captured.update!.payload).toBe(false);
  });

  it("an edit that carries no closing field does NOT receive the 30-day default", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({})));
    expect(captured.update!.payload.expires_at ?? null).toBeNull();
    expect(sourceWrites()).not.toContain("default");
  });

  it("an existing 'No expiry' posting stays no-expiry when saved with that choice", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "" })));
    expect(captured.update!.payload.expires_at).toBeNull();
  });
});

describe("publishing a draft: the 30 days count from FIRST PUBLISH, and only a 'default' date is restarted", () => {
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const draft = (source: string | null, expiresOffsetMs: number | null, over: Record<string, unknown> = {}) => ({
    id: "job-1",
    status: "draft",
    source_type: "internal",
    expires_at: expiresOffsetMs === null ? null : iso(expiresOffsetMs),
    closing_date_source: source,
    ...over,
  });
  const nothingChanged = () => {
    expect(captured.updateCalls, "a refused publish must not change the status").toBe(0);
    expect(captured.adminUpdates, "a refused publish must not write anything else either").toHaveLength(0);
  };
  const resetWrite = () => captured.adminUpdates.find((u) => "expires_at" in u.payload);

  it("a 'default' date that has passed is restarted to now + 30 days, then the job is published", async () => {
    captured.draftRow = draft("default", -10 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: true });
    const reset = resetWrite()!;
    expect(reset, "expected a reset of the default date").toBeDefined();
    const at = new Date(reset.payload.expires_at as string).getTime();
    expect(at).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(at).toBeLessThan(Date.now() + 31 * DAY);
    // The reset is itself conditional on the source, so a date edited to 'chosen' in between cannot be moved.
    const cols = reset.filters.map(([op, col]) => `${op}:${col}`);
    expect(cols).toContain("eq:closing_date_source");
    expect(cols).toContain("eq:source_type");
    expect(captured.update!.payload.status).toBe("open");
  });

  it("a 'default' date that has NOT passed yet is restarted too: the clock is first publish, not creation", async () => {
    captured.draftRow = draft("default", 25 * DAY);
    await publishJobAction("job-1");
    expect(new Date(resetWrite()!.payload.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("a LEGACY row (a date and a null source) counts as chosen: it is never reset on publish", async () => {
    captured.draftRow = draft(null, 20 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: true });
    expect(resetWrite()).toBeUndefined();
    expect("expires_at" in captured.update!.payload).toBe(false);
  });

  it("a LEGACY row whose date has passed is refused like any chosen date, and nothing changes", async () => {
    captured.draftRow = draft(null, -10 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: false, kind: "past", error: "This closing date has passed. Pick a new one" });
    expect(CLOSING_DATE_PASSED_MESSAGE).toBe("This closing date has passed. Pick a new one");
    nothingChanged();
  });

  it("a CHOSEN date that has passed is refused with the exact message, and NOTHING changes", async () => {
    captured.draftRow = draft("chosen", -3 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: false, kind: "past", error: CLOSING_DATE_PASSED_MESSAGE });
    nothingChanged();
  });

  it("a CHOSEN date 3 or more days out is left exactly as it is, and the publish refuses a date that slips into the past", async () => {
    captured.draftRow = draft("chosen", 20 * DAY);
    await publishJobAction("job-1");
    expect(captured.update!.payload.status).toBe("open");
    expect("expires_at" in captured.update!.payload).toBe(false);
    expect(resetWrite()).toBeUndefined();
    expect(captured.update!.filters.map(([op, col]) => `${op}:${col}`)).toContain("gt:expires_at");
  });

  it("'No expiry' (a null date) stays null through publish: no date write, no source write", async () => {
    captured.draftRow = draft(null, null);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: true });
    expect(captured.update!.payload.status).toBe("open");
    expect("expires_at" in captured.update!.payload).toBe(false);
    expect(captured.adminUpdates.some((u) => "expires_at" in u.payload || "closing_date_source" in u.payload)).toBe(false);
  });

  it("an external posting, or one that is not a draft, is never touched", async () => {
    captured.draftRow = draft("default", -10 * DAY, { source_type: "external" });
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    captured.draftRow = draft("default", -10 * DAY, { status: "open" });
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    captured.draftRow = null;
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    nothingChanged();
  });

  describe("a chosen date under 3 days away WARNS and does not block", () => {
    it("the first click is refused with a warning naming the real number of days, and nothing changes", async () => {
      captured.draftRow = draft("chosen", 2 * DAY + 5 * 3_600_000);
      const out = await publishJobAction("job-1");
      expect(out).toEqual({
        ok: false,
        kind: "soon",
        error: "This job closes in 2 days, so you may not get a reminder before it closes",
      });
      nothingChanged();
    });

    it("rounds DOWN to whole days: 1 day, and 'less than a day' under 24 hours", () => {
      expect(closesSoonMessage(2 * DAY + 23 * 3_600_000)).toBe(
        "This job closes in 2 days, so you may not get a reminder before it closes",
      );
      expect(closesSoonMessage(DAY + 3_600_000)).toBe("This job closes in 1 day, so you may not get a reminder before it closes");
      expect(closesSoonMessage(5 * 3_600_000)).toBe(
        "This job closes in less than a day, so you may not get a reminder before it closes",
      );
    });

    it("'Publish anyway' publishes with the chosen date untouched", async () => {
      captured.draftRow = draft("chosen", 2 * DAY);
      const f = new FormData();
      f.set("confirmShortNotice", "1");
      const out = await publishDraftFormAction("job-1", null, f);
      expect(out).toEqual({ ok: true });
      expect(captured.update!.payload).toEqual({ status: "open" }); // the date is not part of the write
      expect(resetWrite()).toBeUndefined();
    });

    it("'Publish anyway' still refuses a date that has already PASSED", async () => {
      captured.draftRow = draft("chosen", -DAY);
      const f = new FormData();
      f.set("confirmShortNotice", "1");
      expect(await publishDraftFormAction("job-1", null, f)).toMatchObject({ ok: false, kind: "past" });
      nothingChanged();
    });

    it("'Change date' is not a submit: it publishes nothing (the view test pins the button type; the server saw no call)", async () => {
      captured.draftRow = draft("chosen", 2 * DAY);
      await publishJobAction("job-1"); // the first click: warned, nothing written
      nothingChanged();
    });
  });

  describe("after a refusal, the employer picks a new date (the form re-posts with expiresIn)", () => {
    const pick = (expiresIn: string) => {
      const f = new FormData();
      f.set("expiresIn", expiresIn);
      return f;
    };

    it("'30 days' publishes with now + 30 days even though the old chosen date had passed, and records 'chosen'", async () => {
      captured.draftRow = draft("chosen", -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, pick("30"));
      expect(out).toEqual({ ok: true });
      const w = resetWrite()!;
      expect(new Date(w.payload.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
      expect(w.payload.closing_date_source).toBe("chosen");
      expect(captured.update!.payload.status).toBe("open");
    });

    it("'No expiry' is a choice too: the date AND the source are written as null", async () => {
      captured.draftRow = draft("chosen", -3 * DAY);
      await publishDraftFormAction("job-1", null, pick(""));
      expect(resetWrite()!.payload).toEqual({ expires_at: null, closing_date_source: null });
      expect(captured.update!.payload.status).toBe("open");
    });

    it("a new date under 3 days warns too, and nothing changes until confirmed", async () => {
      captured.draftRow = draft("chosen", -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, pick("1"));
      expect(out).toMatchObject({ ok: false, kind: "soon" });
      nothingChanged();
    });

    it("the first click (no choice yet) behaves exactly like publishJobAction", async () => {
      captured.draftRow = draft("chosen", -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, new FormData());
      expect(out).toEqual({ ok: false, kind: "past", error: CLOSING_DATE_PASSED_MESSAGE });
      nothingChanged();
    });
  });
});
