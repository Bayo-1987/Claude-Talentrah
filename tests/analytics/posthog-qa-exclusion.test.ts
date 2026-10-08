/**
 * QA-EXCL, surface 6: product analytics (PostHog). `captureEvent` is the single choke point (9 call sites), and it only receives a userId, so the QA check
 * is a lookup by id INSIDE its deferred callback (after the response, never on the request path): a QA account's events are dropped, a normal account's
 * still reach PostHog. The lookup fails OPEN (a read error must never drop a real user's event) and is cached, so a burst of events from one user costs one select.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSecret } from "../support/fake-secret";

const sdk = vi.hoisted(() => ({ capture: vi.fn(), flush: vi.fn(async () => {}) }));
const lookups = vi.hoisted(() => ({
  profiles: {} as Record<string, { email: string | null; first_name: string | null; last_name: string | null } | "error" | "throws">,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
}));

vi.mock("posthog-node", () => ({ PostHog: class { capture = sdk.capture; flush = sdk.flush; } }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void pending.push(Promise.resolve().then(fn)) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      if (Object.values(lookups.profiles).includes("throws") && table === "profiles" && throwNext.value) throw new Error("client could not be built");
      const entry = { table, ops: [] as Array<[string, unknown[]]> };
      lookups.calls.push(entry);
      const result = () => {
        const id = (entry.ops.find(([op]) => op === "eq")?.[1] as unknown[] | undefined)?.[1] as string | undefined;
        const row = id ? lookups.profiles[id] : undefined;
        if (row === "error") return { data: null, error: { message: "boom" } };
        return { data: row ?? null, error: null };
      };
      const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result());
          return (...args: unknown[]) => { entry.ops.push([String(prop), args]); return chain; };
        },
      });
      return chain;
    },
  }),
}));

const pending: Array<Promise<unknown>> = [];
const throwNext = { value: false };
async function capture(userId: string, event = "signup") {
  const { captureEvent } = await import("@/lib/analytics/posthog");
  captureEvent(userId, event as never);
  await Promise.all(pending.splice(0));
}

beforeEach(() => {
  vi.resetModules();
  process.env.POSTHOG_API_KEY = fakeSecret("token");
  sdk.capture.mockClear();
  lookups.calls.length = 0;
  lookups.profiles = {
    "qa-by-email": { email: "hello+qa-seeker@talentrah.com", first_name: "Ada", last_name: "L" },
    "qa-by-name": { email: "someone@example.com", first_name: "QA", last_name: "Employer" },
    "normal": { email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" },
    "erroring": "error",
  };
  throwNext.value = false;
});

describe("captureEvent and QA accounts", () => {
  it("drops the events of an account whose EMAIL contains +qa-", async () => {
    await capture("qa-by-email");
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("drops the events of an account whose NAME starts with 'QA '", async () => {
    await capture("qa-by-name");
    expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("still sends a normal account's event, to the same distinct id", async () => {
    await capture("normal", "tailoring_run");
    expect(sdk.capture).toHaveBeenCalledTimes(1);
    expect(sdk.capture.mock.calls[0][0]).toMatchObject({ distinctId: "normal", event: "tailoring_run" });
  });
  it("fails OPEN: a lookup error never drops a real user's event", async () => {
    await capture("erroring");
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });
  it("fails OPEN when the lookup itself THROWS (a client that cannot be built): the event is still sent", async () => {
    lookups.profiles = { thrower: "throws" };
    throwNext.value = true;
    await capture("thrower");
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });
  it("an id with no profile row is not a QA account (the event is sent)", async () => {
    await capture("no-such-profile");
    expect(sdk.capture).toHaveBeenCalledTimes(1);
  });
  it("looks the account up by primary key, reading only the three identifying columns, once per user (cached)", async () => {
    await capture("normal");
    await capture("normal", "resume_uploaded");
    await capture("normal", "application_submitted");
    expect(sdk.capture).toHaveBeenCalledTimes(3);
    const selects = lookups.calls.filter((c) => c.table === "profiles");
    expect(selects).toHaveLength(1);
    expect(selects[0].ops).toEqual(expect.arrayContaining([["select", ["email, first_name, last_name"]], ["eq", ["id", "normal"]]]));
  });
  it("a QA verdict is cached too (a QA account's burst costs one select, and all its events stay dropped)", async () => {
    await capture("qa-by-email");
    await capture("qa-by-email", "resume_uploaded");
    expect(lookups.calls.filter((c) => c.table === "profiles")).toHaveLength(1);
    expect(sdk.capture).not.toHaveBeenCalled();
  });
});
