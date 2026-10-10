/**
 * updateStageAction (src/lib/applications/tracker-actions.ts) — no existing
 * test file covered this Server Action directly before send-465 (checked:
 * `grep -rl updateStageAction tests/` returned nothing, and
 * tests/tracker/tracker-and-farah.test.ts exercises the same table's RLS
 * policies through direct DB writes, never through this action). This file
 * is new, added alongside send-465's one change to this action.
 *
 * Everything here is mocked — no real database, no real mailer — matching
 * this project's standing rule for notification-pipeline-adjacent code (see
 * tests/notifications/proactive-match-alert-gates.test.ts's own header) and
 * chosen deliberately over the real-RLS-session pattern
 * (tests/resume-builder/create-resume-action.test.ts) for this action
 * specifically: the guarded UPDATE, the optimistic-lock zero-rows case and
 * the 0037 trigger's error code are all things `updateStageAction` itself
 * reacts to based on what Postgres reports back, not things that need a real
 * trigger firing to prove — a mock that returns the same shapes Postgres
 * would proves the same branches. `sendHiredMomentEmail` is mocked directly
 * so this file tests exactly one thing about it: that tracker-actions.ts's
 * own call site can never let it block or fail the redirect. What the email
 * itself sends is tests/notifications/hired-moment-send.test.ts's job, not
 * this file's.
 *
 * SCOPE: send-465 added exactly one call, inside the existing
 * `if (stage === "hired")` branch, after `revalidatePath` and before
 * `redirect(...)`. Every other branch of this action — the guard, the
 * optimistic lock, the 23514 error mapping, the zero-rows early return — is
 * untouched, and the tests below prove that by exercising them the same way
 * they'd have needed to be exercised before this change existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const idle = { status: "idle" } as const;
const testUserId = "user-123";
const testApplicationId = "app-456";

const hiredMomentMock = vi.hoisted(() => ({ impl: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("@/lib/notifications/hired-moment/send", () => ({
  sendHiredMomentEmail: (...args: unknown[]) => hiredMomentMock.impl(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface ExistingRow {
  applied_at: string | null;
  stage: string;
}

interface UpdateResult {
  data: { id: string }[] | null;
  error: { code?: string; message: string } | null;
}

/**
 * A minimal fake of the chain `updateStageAction` actually calls:
 *   .from("applications").select(...).eq(...).eq(...).single()
 *   .from("applications").update(...).eq(...).eq(...)[.eq(...)].select("id")
 *
 * Each `.from("applications")` call gets its own fresh builder (matching
 * real supabase-js), and the builder tells the two shapes apart by whether
 * `.update()` has been called on it yet — exactly the two shapes this
 * action's own body produces, nothing more.
 */
function makeSupabaseMock(opts: { existing: ExistingRow | null; updateResult: UpdateResult }) {
  const eqCalls: Array<[string, unknown]> = [];

  function makeApplicationsBuilder() {
    let isUpdate = false;
    const builder: Record<string, unknown> = {
      update: () => {
        isUpdate = true;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return builder;
      },
      select: () => {
        if (isUpdate) {
          // Terminal for the update path — awaited directly, same as
          // supabase-js's own thenable filter builder.
          return {
            then: (resolve: (v: UpdateResult) => void) => resolve(opts.updateResult),
          };
        }
        return builder;
      },
      single: async () => ({ data: opts.existing, error: null }),
    };
    return builder;
  }

  return {
    client: {
      auth: {
        getUser: async () => ({ data: { user: { id: testUserId } } }),
      },
      from: (table: string) => {
        if (table !== "applications") throw new Error(`unexpected table: ${table}`);
        return makeApplicationsBuilder();
      },
    },
    eqCalls,
  };
}

const testClientRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));

const { updateStageAction } = await import("@/lib/applications/tracker-actions");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** redirect() outside of Next's request context throws a plain Error whose
 * `.digest` carries `NEXT_REDIRECT;<type>;<url>;<status>;` — same convention
 * tests/resume-builder/create-resume-action.test.ts's own header documents. */
function redirectedUrl(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  return digest.split(";")[2];
}

beforeEach(() => {
  hiredMomentMock.impl = vi.fn(async () => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateStageAction — behavior unchanged by send-465", () => {
  it("a non-hired stage change updates and returns normally, without calling the hired-moment email", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: null, stage: "saved" },
      updateResult: { data: [{ id: testApplicationId }], error: null },
    });
    testClientRef.current = client;

    await updateStageAction(testApplicationId, idle, formData({ stage: "applied", expectedStage: "saved" }));

    expect(hiredMomentMock.impl).not.toHaveBeenCalled();
  });

  it("zero rows from the guarded UPDATE (optimistic-lock loss) returns early — no redirect, no email", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: null, stage: "saved" },
      updateResult: { data: [], error: null },
    });
    testClientRef.current = client;

    // Would throw on a redirect; a plain return means no exception at all.
    await expect(
      updateStageAction(testApplicationId, idle, formData({ stage: "hired", expectedStage: "interviewing" })),
    ).resolves.toEqual({ status: "idle" });

    expect(hiredMomentMock.impl).not.toHaveBeenCalled();
  });

  it("the 0037 trigger's check_violation (23514) still maps to the friendly 'can only be archived' message", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: new Date().toISOString(), stage: "hired" },
      updateResult: { data: null, error: { code: "23514", message: "hired application cannot transition" } },
    });
    testClientRef.current = client;

    // TRACKER-HIRED-1: RETURNED as a message (a throw replaced the whole page with "This page couldn't load"), and it says why.
    const result = await updateStageAction(testApplicationId, idle, formData({ stage: "interviewing", expectedStage: "hired" }));
    expect(result.status).toBe("error");
    expect(result.message).toContain("A hired application can only be archived.");
    expect(result.message).toMatch(/final/i);

    expect(hiredMomentMock.impl).not.toHaveBeenCalled();
  });

  it("a generic update error is a plain message in place, with the raw text only in the log", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: null, stage: "saved" },
      updateResult: { data: null, error: { code: "23503", message: "some other constraint" } },
    });
    testClientRef.current = client;

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await updateStageAction(testApplicationId, idle, formData({ stage: "applied", expectedStage: "saved" }));
    expect(result.status).toBe("error");
    expect(result.message).toBe("Couldn't update that application; nothing was changed. The error is in the server log.");
    expect(result.message).not.toContain("some other constraint"); // the raw database text goes to the server log
    expect(log).toHaveBeenCalledWith(expect.stringContaining("some other constraint"));
    log.mockRestore();

    expect(hiredMomentMock.impl).not.toHaveBeenCalled();
  });

  it("a successful transition to 'hired' calls the hired-moment email with the right ids, then redirects with justHired", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: null, stage: "interviewing" },
      updateResult: { data: [{ id: testApplicationId }], error: null },
    });
    testClientRef.current = client;

    let caught: unknown;
    try {
      await updateStageAction(testApplicationId, idle, formData({ stage: "hired", expectedStage: "interviewing" }));
    } catch (err) {
      caught = err;
    }

    expect(hiredMomentMock.impl).toHaveBeenCalledTimes(1);
    expect(hiredMomentMock.impl).toHaveBeenCalledWith({ userId: testUserId, applicationId: testApplicationId });
    expect(redirectedUrl(caught)).toBe(`/tracker?justHired=${testApplicationId}`);
  });
});

describe("updateStageAction — the load-bearing 'best-effort, never blocks' property", () => {
  it("SABOTAGE-PROOF TARGET: a throwing sendHiredMomentEmail does not prevent the redirect or the already-successful stage update", async () => {
    const { client } = makeSupabaseMock({
      existing: { applied_at: null, stage: "interviewing" },
      updateResult: { data: [{ id: testApplicationId }], error: null },
    });
    testClientRef.current = client;
    hiredMomentMock.impl = vi.fn(async () => {
      throw new Error("Resend is down");
    });

    let caught: unknown;
    try {
      await updateStageAction(testApplicationId, idle, formData({ stage: "hired", expectedStage: "interviewing" }));
    } catch (err) {
      caught = err;
    }

    // The redirect must still be the thing that was thrown — not the
    // email's own "Resend is down" error propagating in its place.
    expect(redirectedUrl(caught)).toBe(`/tracker?justHired=${testApplicationId}`);
  });
});
