/**
 * EMPLOYER-ACTIONS-RAW-DB-ERRORS-1 (Auto-Apply part): the Auto-Apply toggle and dismiss actions (neither charges anything) must not show the database's own error text. The real text goes to the server log with the
 * action name and the user id; the person reads what failed and what to do. Supabase is faked; the actions are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ upsertError: null as null | { message: string }, updateError: null as null | { message: string } }));

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: () => {
      const c: Record<string, unknown> = new Proxy({}, {
        get: (_t, p) => {
          if (p === "upsert") return async () => ({ error: h.upsertError });
          if (p === "then") return (res: (v: unknown) => unknown) => res({ error: h.updateError });
          return () => c;
        },
      });
      return c;
    },
  }),
}));
vi.mock("@/lib/auto-apply/queue", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auto-apply/queue")>()), scanAndQueue: vi.fn(async () => undefined) }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

import { dismissAutoApplyAction, setAutoApplyEnabledAction } from "@/lib/auto-apply/actions";

const MARKER = 'duplicate key value violates unique constraint "zz_marker_6620"';
const TRY = "Please try again, or contact support if it keeps happening.";
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

beforeEach(() => {
  h.upsertError = null;
  h.updateError = null;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  errorLog.mockClear();
});

describe("the Auto-Apply toggle and dismiss", () => {
  it("the toggle's settings write fails: a plain sentence, the real text and the user id in the log", async () => {
    h.upsertError = { message: MARKER };
    const out = await setAutoApplyEnabledAction(true);
    expect(out).toEqual({ ok: false, error: `Couldn't update Auto-Apply. ${TRY}` });
    expect(JSON.stringify(out)).not.toContain("zz_marker_6620");
    expect(logged()).toContain("zz_marker_6620");
    expect(logged()).toContain("setAutoApplyEnabledAction");
    expect(logged()).toContain("user-1");
  });
  it("the dismiss write fails: a plain sentence, the real text, the user id and the queue id in the log", async () => {
    h.updateError = { message: MARKER };
    const out = await dismissAutoApplyAction("queue-5");
    expect(out).toEqual({ ok: false, error: `Couldn't dismiss. ${TRY}` });
    expect(JSON.stringify(out)).not.toContain("zz_marker_6620");
    expect(logged()).toContain("zz_marker_6620");
    expect(logged()).toContain("dismissAutoApplyAction");
    expect(logged()).toContain("user-1");
    expect(logged()).toContain("queue-5");
  });
  it("a successful toggle and dismiss still answer ok and log nothing", async () => {
    expect((await setAutoApplyEnabledAction(false)).ok).toBe(true);
    expect((await dismissAutoApplyAction("queue-5")).ok).toBe(true);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
