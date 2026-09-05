/**
 * The guard that keeps local runs off shared databases.
 *
 * This is the piece that has to keep working after the reason for it is
 * forgotten. The failure it prevents is not loud: a run against the shared
 * hosted project succeeds, passes, and quietly deletes another session's
 * fixtures — so the only thing standing between "we fixed the sharing" and
 * drifting straight back is a refusal that fires without being asked.
 *
 * NOTE ON IMPORTING THE MODULE UNDER TEST. `tests/setup.ts` calls the guard for
 * real, so by the time this file runs the process has already satisfied it.
 * These tests call `describeDbTarget`/`assertAllowedDbTarget` directly with
 * explicit inputs rather than mutating `process.env` and re-importing, which
 * keeps them independent of whatever database the run itself is using.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  describeDbTarget,
  assertAllowedDbTarget,
  PRODUCTION_REF,
  HOSTED_CI_REF,
} from "../../scripts/db-target";

const GUARD = {
  context: "test suite",
  productionEscapeHatch: "ALLOW_TESTS_AGAINST_PRODUCTION",
  hostedEscapeHatch: "ALLOW_TESTS_AGAINST_HOSTED",
} as const;

/** Run the guard against a chosen URL, whatever the real environment is. */
function guardAgainst(url: string, env: Record<string, string> = {}) {
  const saved = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    prod: process.env.ALLOW_TESTS_AGAINST_PRODUCTION,
    hosted: process.env.ALLOW_TESTS_AGAINST_HOSTED,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  delete process.env.ALLOW_TESTS_AGAINST_PRODUCTION;
  delete process.env.ALLOW_TESTS_AGAINST_HOSTED;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return assertAllowedDbTarget(GUARD);
  } finally {
    restore(saved);
  }
}

function restore(saved: { url?: string; prod?: string; hosted?: string }) {
  const put = (k: string, v?: string) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  put("NEXT_PUBLIC_SUPABASE_URL", saved.url);
  put("ALLOW_TESTS_AGAINST_PRODUCTION", saved.prod);
  put("ALLOW_TESTS_AGAINST_HOSTED", saved.hosted);
}

afterEach(() => {
  // Belt and braces: the helper restores in a finally, but a throw inside
  // `describe` setup would otherwise leave the real env pointing somewhere else
  // for every later file in this worker.
  expect(typeof process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("string");
});

describe("which database is this", () => {
  it("recognises a local stack on any loopback host or port", () => {
    for (const url of [
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "http://127.0.0.1:9999",
      "https://localhost",
    ]) {
      expect(describeDbTarget(url).kind, url).toBe("local");
    }
  });

  it("recognises the two hosted projects by ref", () => {
    expect(describeDbTarget(`https://${PRODUCTION_REF}.supabase.co`).kind).toBe("production");
    expect(describeDbTarget(`https://${HOSTED_CI_REF}.supabase.co`).kind).toBe("hosted-ci");
  });

  it("calls an unset URL unset rather than guessing", () => {
    // An empty string must not read as "local" — that would turn a
    // misconfiguration into a silent pass.
    expect(describeDbTarget("").kind).toBe("unset");
    expect(describeDbTarget("   ").kind).toBe("unset");
  });

  it("does not mistake a fourth project for one it knows", () => {
    expect(describeDbTarget("https://someotherref.supabase.co").kind).toBe("unknown");
  });

  it("never puts a key in the label it prints", () => {
    // The label is written to stderr on every run. A URL is fine; anything
    // resembling a JWT is not.
    const label = describeDbTarget(`https://${HOSTED_CI_REF}.supabase.co`).label;
    expect(label).toContain(HOSTED_CI_REF);
    expect(label).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe("what a local run is allowed to write to", () => {
  it("allows a local stack with no opt-in at all", () => {
    expect(guardAgainst("http://127.0.0.1:54321").kind).toBe("local");
  });

  it("REFUSES the shared hosted project", () => {
    // The whole point. Several sessions share this one, and a run that reaches
    // it deletes their fixtures while reporting success.
    expect(() => guardAgainst(`https://${HOSTED_CI_REF}.supabase.co`)).toThrow(
      /Refusing to run the test suite against the shared hosted project/,
    );
  });

  it("REFUSES production", () => {
    expect(() => guardAgainst(`https://${PRODUCTION_REF}.supabase.co`)).toThrow(
      /Refusing to run the test suite against PRODUCTION/,
    );
  });

  it("tells you how to fix it, in the refusal itself", () => {
    // A guard that only says no sends people to find the workaround. This one
    // names the one command that makes it unnecessary.
    let message = "";
    try {
      guardAgainst(`https://${HOSTED_CI_REF}.supabase.co`);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("npm run db:local");
  });

  it("lets each hosted target through only on its OWN opt-in", () => {
    expect(
      guardAgainst(`https://${HOSTED_CI_REF}.supabase.co`, {
        ALLOW_TESTS_AGAINST_HOSTED: "yes-i-mean-it",
      }).kind,
    ).toBe("hosted-ci");

    // The production hatch must not open the hosted one, or the narrower
    // permission would silently grant the wider one.
    expect(() =>
      guardAgainst(`https://${HOSTED_CI_REF}.supabase.co`, {
        ALLOW_TESTS_AGAINST_PRODUCTION: "yes-i-mean-it",
      }),
    ).toThrow(/shared hosted project/);

    expect(() =>
      guardAgainst(`https://${PRODUCTION_REF}.supabase.co`, {
        ALLOW_TESTS_AGAINST_HOSTED: "yes-i-mean-it",
      }),
    ).toThrow(/PRODUCTION/);
  });

  it("does not accept a merely truthy opt-in", () => {
    // "1", "true" and "yes" are what someone types when they are guessing.
    // The value has to be the sentence, so it cannot be set by reflex.
    for (const value of ["1", "true", "yes", ""]) {
      expect(() =>
        guardAgainst(`https://${HOSTED_CI_REF}.supabase.co`, {
          ALLOW_TESTS_AGAINST_HOSTED: value,
        }),
        `opt-in should not accept ${JSON.stringify(value)}`,
      ).toThrow(/shared hosted project/);
    }
  });
});
