/**
 * EMP-1 / E3 — a NEW employer posting closes in 30 days unless the employer says otherwise.
 *
 * The default is computed on the SERVER at creation (now + 30 days), never taken from a date the browser sent, and it is
 * applied to CREATION only: editing an existing posting keeps whatever it has, and external postings (ingested, following
 * their source) never go through this path at all.
 *
 * Nothing here needs a database. The Server Action runs against a recording fake of the session client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NEW_POSTING_EXPIRY_DAYS, readExpiry } from "@/lib/employer/expiry-input";

const DAY = 86_400_000;

const captured = vi.hoisted(() => ({
  insert: null as Record<string, unknown> | null,
  update: null as Record<string, unknown> | null,
  adminUpdates: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, string]> }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ organization: { id: "org-1", name: "Acme Ltd", verified: true } }),
}));

function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "not", "lt", "in", "order", "limit"]) b[m] = () => b;
  b.single = async () => result;
  b.maybeSingle = async () => result;
  b.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        captured.insert = payload;
        return chain({ data: { id: "job-1" }, error: null });
      },
      update: (payload: Record<string, unknown>) => {
        captured.update = payload;
        return chain({ data: [{ id: "job-1" }], error: null });
      },
      select: () => chain({ data: [], error: null }),
      delete: () => chain({ data: [], error: null }),
    }),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        const rec = { payload, filters: [] as Array<[string, string]> };
        captured.adminUpdates.push(rec);
        const b: Record<string, unknown> = {};
        for (const op of ["eq", "neq", "is", "not", "lt"]) {
          b[op] = (col: string) => {
            rec.filters.push([op, col]);
            return b;
          };
        }
        b.select = () => b;
        b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return b;
      },
    }),
  }),
}));

const { postJobAction, updateJobAction, publishJobAction } = await import("@/lib/employer/actions");

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

  it("ignores a hand-posted DATE for the default: only the duration choice or the custom date field are read", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expires_at: "2020-01-01T00:00:00.000Z" })));
    const at = new Date(captured.insert!.expires_at as string).getTime();
    expect(at).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("'No expiry' stays selectable and writes null", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ expiresIn: "" })));
    expect(captured.insert!.expires_at).toBeNull();
  });

  it("a draft gets the same default", async () => {
    await runAndCatchRedirect(() => postJobAction(null, form({ intent: "draft" })));
    expect(captured.insert!.status).toBe("draft");
    expect(new Date(captured.insert!.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });
});

describe("updateJobAction: an existing posting keeps what it has", () => {
  it("'keep' does not write the column", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "keep" })));
    expect(captured.update).not.toBeNull();
    expect("expires_at" in captured.update!).toBe(false);
  });

  it("an edit that carries no closing field does NOT receive the 30-day default", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({})));
    expect(captured.update!.expires_at ?? null).toBeNull();
  });

  it("an existing 'No expiry' posting stays no-expiry when saved with that choice", async () => {
    await runAndCatchRedirect(() => updateJobAction("job-1", null, form({ expiresIn: "" })));
    expect(captured.update!.expires_at).toBeNull();
  });
});

describe("publishJobAction: a draft published after its default already passed does not close at once", () => {
  it("restarts an already-past closing date from now + 30 days, and only ever for an internal posting", async () => {
    await publishJobAction("job-1");
    const restart = captured.adminUpdates.find((u) => "expires_at" in u.payload);
    expect(restart, "expected a write that restarts a past closing date").toBeDefined();
    expect(new Date(restart!.payload.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    const cols = restart!.filters.map(([op, col]) => `${op}:${col}`);
    expect(cols).toContain("eq:source_type");
    expect(cols).toContain("lt:expires_at"); // only when it is already in the past
  });
});
