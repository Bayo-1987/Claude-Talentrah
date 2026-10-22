import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RpcKey } from "@/lib/notifications/contract";
import { NOTIFICATION_RPCS, NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";
import { FakeNotificationBackend } from "@/lib/notifications/fakes";

/**
 * PINS THE NAMES WITHOUT SPELLING THEM. A test outside the database folders
 * may not quote a table or function name, so the exact spelling is pinned as a
 * hash of the key=name map. Renaming one database name (or one key) changes the
 * hash and turns this red; the change then has to be made on purpose, in a
 * contract change the CTO approves, and the database PR's conformance test
 * checks the same names against the real catalogue.
 */
const digest = (map: Readonly<Record<string, string>>) =>
  createHash("sha256")
    .update(
      Object.entries(map)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, name]) => `${key}=${name}`)
        .join("\n"),
    )
    .digest("hex");

const TABLES_SHA256 = "164285951b91046aa5edac205a049910d49e6e86f921505a87eec553471e4760";
const RPCS_SHA256 = "e920401d47ab1c947349bb4c4cb1cd52e3009f6134f1c667c887df121fee77d7";

describe("notification object names", () => {
  it("the table names are exactly the reviewed set (7 tables)", () => {
    expect(Object.keys(NOTIFICATION_TABLES)).toHaveLength(7);
    expect(digest(NOTIFICATION_TABLES)).toBe(TABLES_SHA256);
  });

  it("the function names are exactly the reviewed set (24 functions: the 20 of the contract, the retention function and the three of N1B-0273: create a message, record progress, finish a send)", () => {
    expect(Object.keys(NOTIFICATION_RPCS)).toHaveLength(24);
    expect(digest(NOTIFICATION_RPCS)).toBe(RPCS_SHA256);
  });

  it("every name is a plain lowercase identifier and no name is used twice", () => {
    const all = [...Object.values(NOTIFICATION_TABLES), ...Object.values(NOTIFICATION_RPCS)];
    for (const name of all) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the fake covers every function in the accessor module", () => {
  const fake = new FakeNotificationBackend();
  const keys = Object.keys(NOTIFICATION_RPCS) as RpcKey[];

  it("has an implementation for each service-role function key", () => {
    for (const key of keys) {
      if (key === "registerPushSubscription") continue;
      expect(typeof fake[key], key).toBe("function");
    }
  });

  it("has the session-bound function on forCaller", () => {
    expect(typeof fake.forCaller("someone").registerPushSubscription).toBe("function");
  });

  it("dispatches every database name to its own function and to no other", async () => {
    for (const key of keys) {
      const backend = new FakeNotificationBackend();
      const args = { marker: key };
      const spies = (Object.keys(NOTIFICATION_RPCS) as RpcKey[])
        .filter((k) => k !== "registerPushSubscription")
        .map((k) => [k, vi.spyOn(backend, k as Exclude<RpcKey, "registerPushSubscription">).mockResolvedValue(undefined as never)] as const);
      const session = vi.fn().mockResolvedValue("device");
      vi.spyOn(backend, "forCaller").mockReturnValue({ registerPushSubscription: session });

      await backend.invoke(NOTIFICATION_RPCS[key], args, "someone");

      if (key === "registerPushSubscription") {
        expect(session).toHaveBeenCalledWith(args);
        for (const [, spy] of spies) expect(spy).not.toHaveBeenCalled();
      } else {
        for (const [k, spy] of spies) expect(spy).toHaveBeenCalledTimes(k === key ? 1 : 0);
        expect(session).not.toHaveBeenCalled();
      }
    }
  });
});
