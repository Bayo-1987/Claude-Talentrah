/**
 * send-507 — an e2e fixture that DELETES must never be able to run against production.
 *
 * tests/setup.ts guards the Vitest suites with the refuse-production rule (scripts/db-target.ts). The Playwright side had no guard at all:
 * e2e/fixtures/authed.ts built its admin client straight from the environment, 18 spec files build their own service-role clients, and the
 * fixture added with send-504 (clearDemoFarahThread) runs a bare DELETE on farah_messages. A `.env.local` pointed at production would have
 * run all of it.
 *
 * Three layers, each proven here:
 *   1. Playwright's globalSetup refuses before any spec loads (covers every spec, including the 17 that build their own clients).
 *   2. The shared admin factory refuses before it constructs a client (the fixtures that delete go through it).
 *   3. The URL is not the only thing checked: the service-role KEY names the project it belongs to (its `ref` claim), and the two can
 *      disagree (CLAUDE.md), so a production key behind a local-looking URL is refused too.
 * Escape hatches are typed on the command line, are named for e2e (the Vitest ones do not open them), and accept only the sentence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_CI_REF, PRODUCTION_REF } from "../../scripts/db-target";

const calls = vi.hoisted(() => ({ created: [] as string[], ops: [] as string[] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string) => {
    calls.created.push(url);
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: { id: "demo-id" }, error: null });
          return (...args: unknown[]) => {
            calls.ops.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(",")})`);
            return chain;
          };
        },
      },
    );
    return chain;
  },
}));

import { assertE2eDbTarget, serviceKeyProjectRef } from "../../e2e/fixtures/db-guard";
import { createGuardedAdmin } from "../../e2e/fixtures/guarded-admin";
import { clearDemoFarahThread } from "../../e2e/fixtures/farah-thread";
import globalSetup from "../../e2e/global-setup";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
const LOCAL_KEY = jwt({ iss: "supabase-demo", role: "service_role" });

const saved = { ...process.env };
function target(url: string, key = LOCAL_KEY, extra: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  delete process.env.ALLOW_E2E_AGAINST_PRODUCTION;
  delete process.env.ALLOW_E2E_AGAINST_HOSTED;
  Object.assign(process.env, extra);
}
beforeEach(() => {
  calls.created.length = 0;
  calls.ops.length = 0;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const HOSTED_URL = `https://${HOSTED_CI_REF}.supabase.co`;

describe("serviceKeyProjectRef", () => {
  it("reads the project a service-role key belongs to from its ref claim", () => {
    expect(serviceKeyProjectRef(jwt({ ref: PRODUCTION_REF, role: "service_role" }))).toBe(PRODUCTION_REF);
  });
  it("is null for a local-stack key, a malformed key, or nothing", () => {
    expect(serviceKeyProjectRef(LOCAL_KEY)).toBeNull();
    expect(serviceKeyProjectRef("not-a-jwt")).toBeNull();
    expect(serviceKeyProjectRef("")).toBeNull();
    expect(serviceKeyProjectRef(undefined)).toBeNull();
  });
});

describe("assertE2eDbTarget", () => {
  it("allows a local ephemeral stack (what CI runs against) with no opt-in", () => {
    target("http://127.0.0.1:54321");
    expect(assertE2eDbTarget().kind).toBe("local");
  });

  it("REFUSES production by URL", () => {
    target(PROD_URL);
    expect(() => assertE2eDbTarget()).toThrow(/Refusing to run the e2e suite against PRODUCTION/);
  });

  it("REFUSES a production KEY behind a local-looking URL (the URL and the key can disagree)", () => {
    target("http://127.0.0.1:54321", jwt({ ref: PRODUCTION_REF, role: "service_role" }));
    expect(() => assertE2eDbTarget()).toThrow(/service-role key .* production/i);
  });

  it("REFUSES the shared hosted project", () => {
    target(HOSTED_URL);
    expect(() => assertE2eDbTarget()).toThrow(/shared hosted project/);
  });

  it("the Vitest opt-ins do not open the e2e guard", () => {
    target(PROD_URL, LOCAL_KEY, { ALLOW_TESTS_AGAINST_PRODUCTION: "yes-i-mean-it" });
    expect(() => assertE2eDbTarget()).toThrow(/PRODUCTION/);
    target(HOSTED_URL, LOCAL_KEY, { ALLOW_TESTS_AGAINST_HOSTED: "yes-i-mean-it" });
    expect(() => assertE2eDbTarget()).toThrow(/shared hosted project/);
  });

  it("opens only on the e2e opt-in, typed as the sentence", () => {
    target(HOSTED_URL, LOCAL_KEY, { ALLOW_E2E_AGAINST_HOSTED: "yes-i-mean-it" });
    expect(assertE2eDbTarget().kind).toBe("hosted-ci");
    target(HOSTED_URL, LOCAL_KEY, { ALLOW_E2E_AGAINST_HOSTED: "true" });
    expect(() => assertE2eDbTarget()).toThrow(/shared hosted project/);
  });
});

describe("layer 1: Playwright globalSetup", () => {
  it("is wired in playwright.config.ts", () => {
    const cfg = readFileSync(join(__dirname, "../../playwright.config.ts"), "utf8");
    expect(cfg).toMatch(/globalSetup:\s*["']\.\/e2e\/global-setup\.ts["']/);
  });

  it("throws on production before any spec could run, and passes locally", async () => {
    target(PROD_URL);
    await expect(globalSetup()).rejects.toThrow(/PRODUCTION/);
    target("http://localhost:54321");
    await expect(globalSetup()).resolves.toBeUndefined();
  });
});

describe("layer 2: the admin factory", () => {
  it("refuses production BEFORE constructing a client", () => {
    target(PROD_URL);
    expect(() => createGuardedAdmin()).toThrow(/PRODUCTION/);
    expect(calls.created, "no client may be constructed for a refused target").toEqual([]);
  });

  it("builds a client for a local stack", () => {
    target("http://127.0.0.1:54321");
    createGuardedAdmin();
    expect(calls.created).toEqual(["http://127.0.0.1:54321"]);
  });
});

describe("the fixture that deletes (clearDemoFarahThread)", () => {
  it("throws when pointed at the production ref, and issues no query at all", async () => {
    target(PROD_URL);
    await expect(clearDemoFarahThread()).rejects.toThrow(/PRODUCTION/);
    expect(calls.created).toEqual([]);
    expect(calls.ops, "not even a SELECT may run").toEqual([]);
  });

  it("throws for a production key behind a local URL, with no query", async () => {
    target("http://127.0.0.1:54321", jwt({ ref: PRODUCTION_REF }));
    await expect(clearDemoFarahThread()).rejects.toThrow(/production/i);
    expect(calls.ops).toEqual([]);
  });

  it("against a local stack it deletes the demo user's messages (and only through the guarded client)", async () => {
    target("http://127.0.0.1:54321");
    await clearDemoFarahThread();
    expect(calls.created).toHaveLength(1);
    expect(calls.ops.some((o) => o.startsWith("delete("))).toBe(true);
    expect(calls.ops).toContain('eq("user_id","demo-id")');
  });

  it("no e2e fixture builds a service-role client except through the guarded factory", () => {
    for (const f of ["authed.ts", "farah-thread.ts"]) {
      const src = readFileSync(join(__dirname, "../../e2e/fixtures", f), "utf8");
      expect(src, f).not.toMatch(/createClient\(/);
    }
  });
});
