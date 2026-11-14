/**
 * Email-logging addendum: the mass-send path logs counts, the message id and the subject, and never an address.
 *
 * Three recipients with distinctive addresses (`zq7.*@example.test`) go through a success run and every failure shape; everything the run writes anywhere (the injected logger
 * and every console method) is collected and searched for the addresses and for the shared prefix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEmailSend } from "@/lib/notifications/admin-messages/run-email";
import type { ProviderSendResult } from "@/lib/email/mass-send";
import { addressOf, makeWorld, uuid } from "./mass-send-support";

const written: string[] = [];
const methods = ["log", "info", "warn", "error", "debug"] as const;

beforeEach(() => {
  written.length = 0;
  for (const m of methods) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void written.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

async function run(script: ProviderSendResult[], tweak?: (w: ReturnType<typeof makeWorld>) => void) {
  const w = makeWorld({ people: 3, script });
  tweak?.(w);
  const m = await w.startedMessage();
  const result = await runEmailSend(w.deps, m.id);
  return { w, m, result, all: [...w.logs, ...written] };
}

function expectNoAddress(lines: string[]) {
  const text = lines.join("\n");
  for (const n of [1, 2, 3]) expect(text).not.toContain(addressOf(n));
  expect(text).not.toContain("zq7.");
  expect(text).not.toContain("@example.test");
  expect(text).not.toMatch(/tok-\d/); // no unsubscribe token either
}

describe("a run never writes an address", () => {
  it("success: the logs carry the message id, the subject and counts", async () => {
    const { m, all, result } = await run([]);
    expect(result.status).toBe("finished");
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((l) => l.includes(m.id))).toBe(true);
    expect(all.some((l) => l.includes('subject="Platform notice"'))).toBe(true);
    expect(all.some((l) => /sent=3/.test(l))).toBe(true);
    expectNoAddress(all);
  });

  it("provider refuses the request", async () => {
    const { all, result } = await run([{ kind: "rejected" }]);
    expect(result.status).toBe("stopped_provider_rejected");
    expectNoAddress(all);
  });

  it("provider outcome unknown", async () => {
    const { all } = await run([{ kind: "unknown" }]);
    expectNoAddress(all);
  });

  it("provider rate-limits until the run gives up", async () => {
    const limited = { kind: "rate_limited", retryAfterSec: 1, quota: null } as const;
    const { all, result } = await run([limited, limited, limited, limited]);
    expect(result.status).toBe("stopped_rate_limit");
    expectNoAddress(all);
  });

  it("provider quota exceeded", async () => {
    const { all } = await run([{ kind: "quota_exceeded", scope: "daily" }]);
    expectNoAddress(all);
  });

  it("the daily cap pauses the run", async () => {
    const w = makeWorld({ people: 3, cap: 1 });
    const m = await w.startedMessage();
    const result = await runEmailSend(w.deps, m.id);
    expect(result.status).toBe("paused_email_cap");
    expectNoAddress([...w.logs, ...written]);
  });

  it("a recipient dropped at send time", async () => {
    const w = makeWorld({ people: 3 });
    const m = await w.startedMessage();
    w.backend.requestDeletion(uuid(2));
    const result = await runEmailSend(w.deps, m.id);
    expect(result).toMatchObject({ sent: 2, skipped: 1 });
    expectNoAddress([...w.logs, ...written]);
  });

  it("a refused start", async () => {
    const { all, result } = await run([], (w) => (w.deps.identity = null));
    expect(result.status).toBe("refused_start");
    expectNoAddress(all);
  });
});
