/**
 * readHasSession (src/lib/supabase/read-has-session.ts): the one place the marketing components ask "is there a session?" and the one place they load the Supabase browser client.
 * It loads the client by dynamic import, so the client stays out of the importing route's static chunk list (see tests/ui/no-static-supabase-client-import.test.ts).
 * Effects do not run in this project's node test environment, so the components' own wiring is covered by the ratchet and by the browser specs; this pins the helper.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const factoryRuns = vi.fn();
const getSession = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/supabase/client", () => {
  factoryRuns();
  return { createClient: () => createClient() };
});

beforeEach(() => {
  getSession.mockReset();
  createClient.mockReset();
  createClient.mockImplementation(() => ({ auth: { getSession } }));
});

describe("readHasSession", () => {
  it("does not load the Supabase client when the helper module is imported, only when it is called", async () => {
    factoryRuns.mockClear();
    vi.resetModules();
    const { readHasSession } = await import("@/lib/supabase/read-has-session");
    expect(factoryRuns).not.toHaveBeenCalled();
    getSession.mockResolvedValue({ data: { session: null } });
    await readHasSession();
    expect(factoryRuns).toHaveBeenCalledTimes(1);
  });

  it("is true with a session and false without one", async () => {
    const { readHasSession } = await import("@/lib/supabase/read-has-session");
    getSession.mockResolvedValueOnce({ data: { session: { access_token: "x" } } });
    expect(await readHasSession()).toBe(true);
    getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await readHasSession()).toBe(false);
  });

  it("rejects when the client cannot be built or the read fails, so each caller chooses its own fallback", async () => {
    const { readHasSession } = await import("@/lib/supabase/read-has-session");
    createClient.mockImplementationOnce(() => {
      throw new Error("missing url");
    });
    await expect(readHasSession()).rejects.toThrow("missing url");
    getSession.mockRejectedValueOnce(new Error("offline"));
    await expect(readHasSession()).rejects.toThrow("offline");
  });
});
