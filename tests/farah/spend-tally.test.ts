/**
 * The real spend tally (src/lib/farah/spend-tally.ts): three thin functions over the 0223 counter, called by the chat route. Unit-tested here with the service-role client
 * replaced by a fake that records its rpc calls. Every other test is kept away from the real module by the tripwire in tests/setup.ts (a test that reaches it without the safe
 * mocks fails loudly); a test of the module itself says so explicitly, with `vi.importActual`. This file is one of the few allowed to (tests/farah/tally-isolation.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeTripwireTouches } from "../support/tripwire";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

interface Tally {
  readSpendNano(): Promise<number>;
  addSpendNano(nano: number): Promise<number>;
  markHalfwayWarned(): Promise<boolean>;
  claimAlertAttempt(level: "eighty" | "reached"): Promise<boolean>;
  markAlertSent(level: "eighty" | "reached"): Promise<boolean>;
}
// The explicit way around the tripwire: the actual module, not the unsafe default.
const actual = () => vi.importActual<Tally>("@/lib/farah/spend-tally");

beforeEach(() => {
  rpc.mockReset();
});

describe("the real tally module, reached on purpose with importActual", () => {
  it("reads today's total by adding zero to the spend bucket", async () => {
    rpc.mockResolvedValue({ data: 12_345, error: null });
    const t = await actual();
    expect(await t.readSpendNano()).toBe(12_345);
    expect(rpc).toHaveBeenCalledWith("add_llm_usage", { p_bucket: "farah_chat", p_nano: 0 });
  });

  it("adds an amount to the spend bucket and returns the running total", async () => {
    rpc.mockResolvedValue({ data: 642_000, error: null });
    const t = await actual();
    expect(await t.addSpendNano(642_000)).toBe(642_000);
    expect(rpc).toHaveBeenCalledWith("add_llm_usage", { p_bucket: "farah_chat", p_nano: 642_000 });
  });

  it("the halfway marker is true only for the caller whose add of 1 returns 1", async () => {
    const t = await actual();
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    expect(await t.markHalfwayWarned()).toBe(true);
    rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await t.markHalfwayWarned()).toBe(false);
    expect(rpc).toHaveBeenCalledWith("add_llm_usage", { p_bucket: "farah_chat_half_warned", p_nano: 1 });
  });

  it("claimAlertAttempt asks the counter for an attempt: the alert name, at most 3 attempts a day, a 10 second lease; true only when the database says true", async () => {
    const t = await actual();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await t.claimAlertAttempt("eighty")).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("claim_llm_alert_attempt", { p_alert: "eighty", p_max_attempts: 3, p_lease_seconds: 10 });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await t.claimAlertAttempt("reached")).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("claim_llm_alert_attempt", { p_alert: "reached", p_max_attempts: 3, p_lease_seconds: 10 });
  });

  it("claimAlertAttempt never turns an odd answer into permission to send: only the boolean true counts", async () => {
    const t = await actual();
    for (const data of [null, 1, "true", undefined]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(t.claimAlertAttempt("eighty")).rejects.toBeTruthy();
    }
  });

  it("markAlertSent records the send for that alert and returns whether this call was the one that recorded it", async () => {
    const t = await actual();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await t.markAlertSent("reached")).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("mark_llm_alert_sent", { p_alert: "reached" });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await t.markAlertSent("reached")).toBe(false);
  });

  it("an rpc error is thrown, never turned into a number (the caller fails closed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "PGRST202" } });
    const t = await actual();
    await expect(t.readSpendNano()).rejects.toBeTruthy();
    await expect(t.addSpendNano(5)).rejects.toBeTruthy();
    await expect(t.markHalfwayWarned()).rejects.toBeTruthy();
    await expect(t.claimAlertAttempt("eighty")).rejects.toBeTruthy();
    await expect(t.markAlertSent("eighty")).rejects.toBeTruthy();
  });

  it("a failure carries the database error code, and a missing function or table is flagged as a likely missing migration", async () => {
    const t = await actual();
    for (const code of ["PGRST202", "42883", "42P01", "PGRST205"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: "not found", code } });
      const err = (await t.readSpendNano().catch((e: unknown) => e)) as { code?: string; missingMigration?: boolean };
      expect(err.code).toBe(code);
      expect(err.missingMigration, `${code} should be flagged`).toBe(true);
    }
    rpc.mockResolvedValueOnce({ data: null, error: { message: "slow", code: "57014" } });
    const other = (await t.readSpendNano().catch((e: unknown) => e)) as { code?: string; missingMigration?: boolean };
    expect(other.code).toBe("57014");
    expect(other.missingMigration).toBe(false);
  });

  it("a reply that is not a number is thrown, not read as zero", async () => {
    const t = await actual();
    for (const data of [null, undefined, "abc", Number.NaN, {}]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(t.readSpendNano()).rejects.toBeTruthy();
    }
  });

  it("refuses to send a negative, fractional or non-finite amount (nothing reaches the database)", async () => {
    const t = await actual();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) await expect(t.addSpendNano(bad)).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the tripwire itself", () => {
  it("the default for the module is unsafe: calling it records a touch and throws, so a route test that forgot the safe mocks cannot pass quietly", async () => {
    const t = await import("@/lib/farah/spend-tally");
    await expect(t.readSpendNano()).rejects.toThrow(/safe route mocks/i);
    expect(consumeTripwireTouches()).toEqual(["readSpendNano"]); // consumed here so THIS test passes; any other test leaving a touch behind fails in afterEach
  });
});
