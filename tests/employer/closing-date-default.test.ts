/**
 * EMP-1 / E3 — a NEW employer posting closes in 30 days unless the employer says otherwise, and the 30 days count from
 * the moment candidates can first see the job.
 *
 * The default is computed on the SERVER (now + 30 days), never taken from a date the browser sent. It is applied to
 * CREATION only: editing an existing posting keeps whatever it has, and external postings (ingested, following their
 * source) never go through this path at all. Publishing a draft restarts a DEFAULT date from the publish moment, and
 * refuses to silently move a date the employer CHOSE.
 *
 * Nothing here needs a database. The Server Actions run against a recording fake of the session client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSING_DATE_PASSED_MESSAGE,
  CLOSING_DATE_TOO_SOON_MESSAGE,
  DEFAULT_NEW_POSTING_EXPIRY_DAYS,
  closingDateOrigin,
  readExpiry,
} from "@/lib/employer/expiry-input";

const DAY = 86_400_000;

type Filter = [string, string];
const captured = vi.hoisted(() => ({
  insert: null as Record<string, unknown> | null,
  update: null as { payload: Record<string, unknown>; filters: Array<[string, string]> } | null,
  updateCalls: 0,
  /** What the draft row looks like to the publish action's read. null = no such row. */
  draftRow: null as null | {
    id: string;
    status: string;
    source_type: string;
    created_at: string;
    expires_at: string | null;
  },
  updateReturns: [{ id: "job-1" }] as Array<{ id: string }>,
  adminUpdates: [] as Array<{ payload: Record<string, unknown> }>,
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
        captured.adminUpdates.push({ payload });
        return chain(() => ({ data: [], error: null }));
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

describe("closingDateOrigin: was this date the default, or did the employer choose it?", () => {
  const created = "2026-09-01T10:00:00.000Z";
  const at = (ms: number) => new Date(new Date(created).getTime() + ms).toISOString();

  it("created + 30 days (to within the seconds between computing it and inserting the row) is the default", () => {
    expect(closingDateOrigin(created, at(30 * DAY))).toBe("default");
    expect(closingDateOrigin(created, at(30 * DAY - 800))).toBe("default");
    expect(closingDateOrigin(created, at(30 * DAY + 45_000))).toBe("default");
  });

  it("any other distance from creation is a chosen date", () => {
    for (const days of [1, 3, 7, 14, 60]) expect(closingDateOrigin(created, at(days * DAY))).toBe("chosen");
    expect(closingDateOrigin(created, at(30 * DAY + 5 * 60_000))).toBe("chosen");
    expect(closingDateOrigin(created, at(-DAY))).toBe("chosen");
  });

  it("a custom date (always the END of its day, UTC) is chosen even if it lands on created + 30 days", () => {
    const createdAtEndOfDay = "2026-09-01T23:59:59.500Z";
    const exactly = new Date(new Date(createdAtEndOfDay).getTime() + 30 * DAY);
    exactly.setUTCMilliseconds(999);
    expect(exactly.toISOString()).toMatch(/T23:59:59\.999Z$/);
    expect(closingDateOrigin(createdAtEndOfDay, exactly.toISOString())).toBe("chosen");
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

  it("a direct create-and-publish is open at once with creation + 30 days (unchanged by the publish rules)", async () => {
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

describe("updateJobAction: an existing posting keeps what it has", () => {
  it("'keep' does not write the column", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "keep" })));
    expect(captured.update).not.toBeNull();
    expect("expires_at" in captured.update!.payload).toBe(false);
  });

  it("an edit that carries no closing field does NOT receive the 30-day default", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({})));
    expect(captured.update!.payload.expires_at ?? null).toBeNull();
  });

  it("an existing 'No expiry' posting stays no-expiry when saved with that choice", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "" })));
    expect(captured.update!.payload.expires_at).toBeNull();
  });
});

describe("publishing a draft: the 30 days count from FIRST PUBLISH", () => {
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const draft = (createdAgoDays: number, expiresOffsetMs: number | null, over: Record<string, unknown> = {}) => ({
    id: "job-1",
    status: "draft",
    source_type: "internal",
    created_at: iso(-createdAgoDays * DAY),
    expires_at: expiresOffsetMs === null ? null : iso(expiresOffsetMs),
    ...over,
  });
  const nothingChanged = () => {
    expect(captured.updateCalls, "a refused publish must not write anything").toBe(0);
    expect(captured.adminUpdates, "a refused publish must not stamp posted_at either").toHaveLength(0);
  };

  it("a draft past its DEFAULT date publishes with now + 30 days", async () => {
    // Created 40 days ago, so its default date (created + 30d) is 10 days in the past.
    captured.draftRow = draft(40, -10 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toMatchObject({ ok: true });
    expect(captured.update!.payload.status).toBe("open");
    const at = new Date(captured.update!.payload.expires_at as string).getTime();
    expect(at).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(at).toBeLessThan(Date.now() + 31 * DAY);
  });

  it("a draft whose DEFAULT date has not passed yet is restarted too: the clock is first publish, not creation", async () => {
    captured.draftRow = draft(5, 25 * DAY);
    await publishJobAction("job-1");
    const at = new Date(captured.update!.payload.expires_at as string).getTime();
    expect(at).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("a draft with a CHOSEN date that has passed is refused with the exact message, and NOTHING changes", async () => {
    captured.draftRow = draft(40, -3 * DAY); // created+30d would be -10d, so -3d was typed in by the employer
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: false, error: "This closing date has passed. Pick a new one" });
    expect(CLOSING_DATE_PASSED_MESSAGE).toBe("This closing date has passed. Pick a new one");
    nothingChanged();
  });

  it("a draft with a CHOSEN date under 3 days away is refused too, and NOTHING changes", async () => {
    captured.draftRow = draft(2, 2 * DAY);
    const out = await publishJobAction("job-1");
    expect(out).toEqual({ ok: false, error: CLOSING_DATE_TOO_SOON_MESSAGE });
    expect(CLOSING_DATE_TOO_SOON_MESSAGE).toBe("This job would close in under 3 days. Pick a later date");
    nothingChanged();
  });

  it("a CHOSEN date that is fine is left alone, and the publish itself is guarded against the date moving under it", async () => {
    captured.draftRow = draft(2, 20 * DAY);
    await publishJobAction("job-1");
    expect(captured.update!.payload.status).toBe("open");
    expect("expires_at" in captured.update!.payload).toBe(false);
    expect(captured.update!.filters.map(([op, col]) => `${op}:${col}`)).toContain("gt:expires_at");
  });

  it("'No expiry' stays null through publish", async () => {
    captured.draftRow = draft(60, null);
    const out = await publishJobAction("job-1");
    expect(out).toMatchObject({ ok: true });
    expect(captured.update!.payload.status).toBe("open");
    expect("expires_at" in captured.update!.payload).toBe(false);
  });

  it("an external posting, or one that is not a draft, is never touched", async () => {
    captured.draftRow = draft(40, -10 * DAY, { source_type: "external" });
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    captured.draftRow = draft(40, -10 * DAY, { status: "open" });
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    captured.draftRow = null;
    expect(await publishJobAction("job-1")).toMatchObject({ ok: false });
    nothingChanged();
  });

  describe("after a refusal, the employer picks a new date (the form re-posts with expiresIn)", () => {
    const pick = (expiresIn: string) => {
      const f = new FormData();
      f.set("expiresIn", expiresIn);
      return f;
    };

    it("'30 days' publishes with now + 30 days even though the old chosen date had passed", async () => {
      captured.draftRow = draft(40, -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, pick("30"));
      expect(out).toMatchObject({ ok: true });
      expect(captured.update!.payload.status).toBe("open");
      expect(new Date(captured.update!.payload.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    });

    it("'No expiry' is a choice too, and is written as null", async () => {
      captured.draftRow = draft(40, -3 * DAY);
      await publishDraftFormAction("job-1", null, pick(""));
      expect(captured.update!.payload).toMatchObject({ status: "open", expires_at: null });
    });

    it("a new date under 3 days is refused with the same message, and nothing changes", async () => {
      captured.draftRow = draft(40, -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, pick("1"));
      expect(out).toEqual({ ok: false, error: CLOSING_DATE_TOO_SOON_MESSAGE });
      nothingChanged();
    });

    it("the first click (no choice yet) behaves exactly like publishJobAction", async () => {
      captured.draftRow = draft(40, -3 * DAY);
      const out = await publishDraftFormAction("job-1", null, new FormData());
      expect(out).toEqual({ ok: false, error: CLOSING_DATE_PASSED_MESSAGE });
      nothingChanged();
    });
  });
});
