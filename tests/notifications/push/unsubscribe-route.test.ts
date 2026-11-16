/**
 * U7: POST /api/push/unsubscribe removes THIS device's subscription row on sign-out. The service-role delete is filtered by the session user's id (from the verified session, never the
 * request body) AND the endpoint, so a person can never delete another person's row. The database is a small in-memory fake of the one query chain the real deps use; every id is invented.
 */
import { describe, expect, it } from "vitest";
import { handleUnsubscribe, type UnsubscribeDeps } from "@/lib/notifications/push/unsubscribe-route";
import { removeByEndpointWith } from "@/lib/notifications/push/unsubscribe-deps";

type Row = { user_id: string; endpoint: string };
const EP_A = "https://push.example.test/send/AAAA";
const EP_B = "https://push.example.test/send/BBBB";
const EP_B2 = "https://push.example.test/send/BBB2";

/** Just enough of the query builder: from().delete().eq().eq() applied over rows, so a dropped filter really deletes more. */
function fakeService(rows: Row[]) {
  return {
    rows,
    from() {
      return {
        delete() {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return builder;
            },
            then(resolve: (v: { error: null }) => void) {
              for (let i = rows.length - 1; i >= 0; i--) if (filters.every(([c, v]) => (rows[i] as Record<string, unknown>)[c] === v)) rows.splice(i, 1);
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

function depsFor(userId: string | null, rows: Row[]): UnsubscribeDeps {
  const service = fakeService(rows);
  return {
    session: async () => (userId ? { userId } : null),
    removeByEndpoint: (uid, endpoint) => removeByEndpointWith(service as never, uid, endpoint),
  };
}
const post = (body: unknown, origin = "https://www.example.test") =>
  new Request("https://www.example.test/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json", origin, host: "www.example.test" }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/push/unsubscribe", () => {
  it("sign-out removes this device's subscription row", async () => {
    const rows: Row[] = [{ user_id: "user-a", endpoint: EP_A }];
    const res = await handleUnsubscribe(post({ endpoint: EP_A }), depsFor("user-a", rows));
    expect(res.status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("person B posting person A's endpoint deletes nothing: A's row stays and B's own rows are untouched", async () => {
    const rows: Row[] = [{ user_id: "user-a", endpoint: EP_A }, { user_id: "user-b", endpoint: EP_B }, { user_id: "user-b", endpoint: EP_B2 }];
    const res = await handleUnsubscribe(post({ endpoint: EP_A }), depsFor("user-b", rows));
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.user_id === "user-a" && r.endpoint === EP_A)).toBe(true);
  });

  it("a user id in the body is ignored: the session decides whose row", async () => {
    const rows: Row[] = [{ user_id: "user-a", endpoint: EP_A }, { user_id: "user-b", endpoint: EP_B }];
    await handleUnsubscribe(post({ endpoint: EP_A, user_id: "user-a", userId: "user-a" }), depsFor("user-b", rows));
    expect(rows).toHaveLength(2);
  });

  it("removes only the posted endpoint of the person: their other devices stay", async () => {
    const rows: Row[] = [{ user_id: "user-b", endpoint: EP_B }, { user_id: "user-b", endpoint: EP_B2 }];
    await handleUnsubscribe(post({ endpoint: EP_B }), depsFor("user-b", rows));
    expect(rows).toEqual([{ user_id: "user-b", endpoint: EP_B2 }]);
  });

  it("nobody signed in: 401, nothing deleted", async () => {
    const rows: Row[] = [{ user_id: "user-a", endpoint: EP_A }];
    const res = await handleUnsubscribe(post({ endpoint: EP_A }), depsFor(null, rows));
    expect(res.status).toBe(401);
    expect(rows).toHaveLength(1);
  });

  it("refuses another origin, a missing or non-string endpoint, an oversize endpoint and a bad body, deleting nothing", async () => {
    const rows: Row[] = [{ user_id: "user-a", endpoint: EP_A }];
    const d = depsFor("user-a", rows);
    expect((await handleUnsubscribe(post({ endpoint: EP_A }, "https://evil.example.test"), d)).status).toBe(403);
    for (const body of [{}, { endpoint: 5 }, { endpoint: "" }, { endpoint: "x".repeat(2049) }, "not json", "[]"]) {
      expect((await handleUnsubscribe(post(body), d)).status, JSON.stringify(body).slice(0, 30)).toBe(400);
    }
    expect(rows).toHaveLength(1);
  });

  it("a database failure answers a generic error code and never the database's words", async () => {
    const deps: UnsubscribeDeps = { session: async () => ({ userId: "user-a" }), removeByEndpoint: async () => { throw new Error("secret detail relation x"); } };
    const res = await handleUnsubscribe(post({ endpoint: EP_A }), deps);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toBe('{"error":"unknown"}');
  });
});
