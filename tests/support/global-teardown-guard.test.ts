/**
 * The global teardown deletes only on a LOCAL database, unless a separate, explicitly named opt-in is typed for that one run.
 *
 * tests/support/global-teardown.ts runs once after every Vitest run and sweeps every `@talentrah.test` auth account older than two hours,
 * plus fixture organisations. tests/setup.ts's refuse-hosted guard runs inside each test FILE; this sweep is a Vitest `globalSetup`
 * teardown, outside any file, so it never saw that guard. On 2026-10-02 a DB-backed file run with ALLOW_TESTS_AGAINST_HOSTED=yes-i-mean-it
 * against talentrah-preview ended with the sweep deleting 547 accounts there. They were stale test accounts, and nobody had agreed to the write.
 *
 * What is pinned here, against a fake client that records every call:
 *   - a hosted, production or unrecognised target is refused BEFORE any client is built, so nothing can be listed or deleted;
 *   - a service-role key for PRODUCTION behind a local-looking URL is refused too (the URL and the key can disagree, CLAUDE.md);
 *   - the opt-in is its own variable, typed as the sentence, and the suite's escape hatch (ALLOW_TESTS_AGAINST_HOSTED) does NOT open it;
 *   - production is not reachable by that opt-in at all;
 *   - a local stack (what CI runs against) still sweeps exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_CI_REF, PRODUCTION_REF } from "../../scripts/db-target";

const calls = vi.hoisted(() => ({ created: [] as string[], listed: 0, deleted: [] as string[] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string) => {
    calls.created.push(url);
    const empty = { data: [], error: null };
    const auth = {
      admin: {
        listUsers: async () => {
          calls.listed += 1;
          return {
            data: { users: [{ id: "stale-user-1", email: "old-fixture@talentrah.test", created_at: "2020-01-01T00:00:00Z" }] },
            error: null,
          };
        },
        deleteUser: async (id: string) => {
          calls.deleted.push(id);
          return { error: null };
        },
      },
    };
    const chain: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "auth") return auth;
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(empty);
          return () => chain;
        },
      },
    );
    return chain;
  },
}));

import { teardown } from "./global-teardown";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
const LOCAL_KEY = jwt({ iss: "supabase-demo", role: "service_role" });
const LOCAL_URL = "http://127.0.0.1:54321";
const HOSTED_URL = `https://${HOSTED_CI_REF}.supabase.co`;
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const OPT_IN = "ALLOW_GLOBAL_SWEEP_ON_NON_LOCAL";

const saved = { ...process.env };
let stderr = "";
function target(url: string, key = LOCAL_KEY, extra: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  delete process.env[OPT_IN];
  delete process.env.TALENTRAH_SKIP_GLOBAL_SWEEP;
  Object.assign(process.env, extra);
}
function nothingTouched() {
  expect(calls.created, "no client may be constructed for a refused target").toEqual([]);
  expect(calls.listed).toBe(0);
  expect(calls.deleted).toEqual([]);
}

beforeEach(() => {
  calls.created.length = 0;
  calls.listed = 0;
  calls.deleted.length = 0;
  stderr = "";
  process.exitCode = undefined;
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    stderr += args.join(" ");
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr += args.join(" ");
  });
});
afterEach(() => {
  process.env = { ...saved };
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("global teardown refuses a target that is not a local database", () => {
  it("deletes nothing on the shared hosted project, says so loudly, and does not fail the run", async () => {
    target(HOSTED_URL);
    await teardown();
    nothingTouched();
    expect(stderr).toMatch(/refus/i);
    expect(stderr).toContain(OPT_IN);
    expect(process.exitCode, "a refusal is not a failed run").toBeUndefined();
  });

  it("deletes nothing on production", async () => {
    target(PROD_URL);
    await teardown();
    nothingTouched();
  });

  it("deletes nothing on a project this repo does not recognise", async () => {
    target("https://someotherproject.supabase.co");
    await teardown();
    nothingTouched();
  });

  it("deletes nothing when a PRODUCTION service-role key sits behind a local-looking URL", async () => {
    target(LOCAL_URL, jwt({ ref: PRODUCTION_REF, role: "service_role" }));
    await teardown();
    nothingTouched();
  });

  it("the suite's own hosted opt-in (ALLOW_TESTS_AGAINST_HOSTED) does NOT open the sweep", async () => {
    target(HOSTED_URL, LOCAL_KEY, { ALLOW_TESTS_AGAINST_HOSTED: "yes-i-mean-it" });
    await teardown();
    nothingTouched();
  });

  it("the opt-in is the exact sentence: 'true' and '1' do not open it", async () => {
    for (const v of ["true", "1", "yes"]) {
      target(HOSTED_URL, LOCAL_KEY, { [OPT_IN]: v });
      await teardown();
      nothingTouched();
    }
  });

  it("production is not reachable by the opt-in at all", async () => {
    target(PROD_URL, LOCAL_KEY, { [OPT_IN]: "yes-i-mean-it", ALLOW_TESTS_AGAINST_PRODUCTION: "yes-i-mean-it" });
    await teardown();
    nothingTouched();
  });
});

describe("global teardown still sweeps where it is allowed to", () => {
  it("sweeps a stale test account on a local stack with no opt-in (what CI runs)", async () => {
    target(LOCAL_URL);
    await teardown();
    expect(calls.created).toEqual([LOCAL_URL]);
    expect(calls.deleted).toEqual(["stale-user-1"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("sweeps on localhost too, whatever port the CLI assigned", async () => {
    target("http://localhost:54399");
    await teardown();
    expect(calls.deleted).toEqual(["stale-user-1"]);
  });

  it("sweeps the shared hosted project only on the named opt-in, typed as the sentence, and says it is doing so", async () => {
    target(HOSTED_URL, LOCAL_KEY, { [OPT_IN]: "yes-i-mean-it" });
    await teardown();
    expect(calls.deleted).toEqual(["stale-user-1"]);
    expect(stderr).toMatch(/on purpose/i);
  });

  it("with no credentials at all there is nothing to sweep and nothing is refused noisily", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await teardown();
    expect(calls.created).toEqual([]);
  });
});
