/**
 * Regression test for QA audit bug #5: POST /api/tailoring called
 * `await request.json()` unguarded, so a malformed JSON body threw and fell
 * through to Next's generic 500 instead of a clear 400. See the try/catch
 * around the parse in src/app/api/tailoring/route.ts.
 *
 * Auth is mocked out (not exercised by this bug) so this can hit the route
 * handler directly without a real Next request/cookie context — everything
 * downstream of the JSON parse (credits, Claude, Supabase writes) is never
 * reached for a malformed body, so nothing else needs mocking.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "test-user-id" } } }),
    },
  }),
}));

const { POST } = await import("@/app/api/tailoring/route");

describe("POST /api/tailoring — malformed request body", () => {
  it("returns 400 with a clear error instead of throwing/500ing", async () => {
    const request = new Request("http://localhost/api/tailoring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not valid json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Malformed request body.");
  });

  it("still returns 401 for an unauthenticated request, before the body is even read", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    }));
    const { POST: PostUnauthed } = await import("@/app/api/tailoring/route");

    const request = new Request("http://localhost/api/tailoring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not valid json",
    });

    const response = await PostUnauthed(request);
    expect(response.status).toBe(401);

    vi.doUnmock("@/lib/supabase/server");
  });
});
