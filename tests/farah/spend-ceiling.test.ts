/**
 * Farah's daily spend ceiling (S3-82/83): an app-level safeguard that trips long before Groq's own monthly limit ($15 for the organisation, which
 * disables every key until the next billing cycle). Spend is an ESTIMATE: provider-reported token counts times the provider's published price for the
 * model in use. The Groq console is the source of truth.
 *
 * This file pins the pure parts: the setting (a missing or invalid value falls back to the default, never to "no limit"), the price table
 * (value-pinned, with each row's source and the date it was read; an unknown model is priced at the MOST expensive known row), the three flat
 * estimates, the estimate arithmetic in whole nano-dollars, and the content-free 50% warning. The module does not exist when this file is first
 * committed, so it is loaded at runtime.
 *
 * The default ceiling lives in ONE constant (DEFAULT_DAILY_CEILING_USD). Nothing below hardcodes its value: every expectation is derived from the
 * constant, so changing the owner's number is a one-line change. The only check on the value itself is a sanity range.
 *
 * The day key is NOT in this module: the counter's day comes from the database clock (migration 0223), so the app and the counter cannot disagree
 * about which day it is. The app only needs "seconds until the next UTC midnight" for a Retry-After header.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_MAX_OUTPUT_TOKENS, REQUEST_TOKEN_CEILING } from "@/lib/farah/token-budget";
import { loadModule } from "../support/load-module";

interface Tally {
  read(): Promise<number>;
  markWarned(): Promise<boolean>;
}
interface Mod {
  DEFAULT_DAILY_CEILING_USD: number;
  NANO_PER_USD: number;
  FAILED_ATTEMPT_ESTIMATE_NANO: number;
  NO_COUNTS_REPLY_ESTIMATE_NANO: number;
  GROQ_PRICE_SOURCE: { url: string; readOn: string };
  GEMINI_PRICE_SOURCE: { url: string; readOn: string };
  dailyCeilingUsd(env?: Record<string, string | undefined>): number;
  secondsUntilUtcMidnight(d: Date): number;
  estimateSpendNano(u: { provider?: string; model?: string; inputTokens: number; outputTokens: number }): number;
  checkSpendCeiling(tally: Tally, env?: Record<string, string | undefined>): Promise<{ status: "ok" | "blocked"; spentNano: number; ceilingNano: number }>;
}
const load = () => loadModule<Mod>("@/lib/farah/spend-ceiling");
const ENV = "FARAH_DAILY_SPEND_CEILING_USD";
const GROQ = { provider: "groq", model: "openai/gpt-oss-120b" };
const GEMINI = { provider: "gemini", model: "gemini-3.6-flash" };

describe("the ceiling setting", () => {
  it("has ONE default constant; the environment variable is named FARAH_DAILY_SPEND_CEILING_USD", async () => {
    const m = await load();
    const d = m.DEFAULT_DAILY_CEILING_USD;
    // The value is the owner's decision (recorded in the plan); this only guards against a typo (0, negative, NaN, or above Groq's $15 monthly cap).
    expect(Number.isFinite(d) && d > 0 && d <= 15).toBe(true);
    expect(m.dailyCeilingUsd({})).toBe(d);
    expect(m.dailyCeilingUsd({ [ENV]: "2.5" })).toBe(2.5);
    expect(m.dailyCeilingUsd({ [ENV]: " 0.5 " })).toBe(0.5);
  });

  for (const bad of ["", "   ", "abc", "-1", "0", "NaN", "Infinity", "-Infinity", "1,5", "$1"]) {
    it(`a missing or invalid value (${JSON.stringify(bad)}) falls back to the default, never to "no limit"`, async () => {
      const m = await load();
      expect(m.dailyCeilingUsd({ [ENV]: bad })).toBe(m.DEFAULT_DAILY_CEILING_USD);
    });
  }

  it("reads process.env at call time (changing it needs no code change)", async () => {
    const m = await load();
    const saved = process.env[ENV];
    try {
      process.env[ENV] = "3";
      expect(m.dailyCeilingUsd()).toBe(3);
      delete process.env[ENV];
      expect(m.dailyCeilingUsd()).toBe(m.DEFAULT_DAILY_CEILING_USD);
    } finally {
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    }
  });
});

describe("Retry-After for the ceiling response", () => {
  it("secondsUntilUtcMidnight is whole seconds, at least 1, at most a day, and does not depend on the machine's timezone", async () => {
    const m = await load();
    expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T23:59:30Z"))).toBe(30);
    expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T00:00:00Z"))).toBe(86400);
    expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T23:59:59.900Z"))).toBe(1);
    const saved = process.env.TZ;
    try {
      process.env.TZ = "Africa/Lagos";
      expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T23:30:00Z"))).toBe(1800);
      process.env.TZ = "Pacific/Auckland";
      expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T23:30:00Z"))).toBe(1800);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe("the price table is pinned, with each row's source and the date it was read", () => {
  it("openai/gpt-oss-120b on Groq: $0.15 per 1M input tokens and $0.60 per 1M output tokens, in whole nano-dollars", async () => {
    const m = await load();
    expect(m.NANO_PER_USD).toBe(1_000_000_000);
    expect(m.estimateSpendNano({ ...GROQ, inputTokens: 1_000_000, outputTokens: 0 })).toBe(150_000_000);
    expect(m.estimateSpendNano({ ...GROQ, inputTokens: 0, outputTokens: 1_000_000 })).toBe(600_000_000);
    // a typical completed attempt: 2,400 in + 470 out = $0.000642
    expect(m.estimateSpendNano({ ...GROQ, inputTokens: 2400, outputTokens: 470 })).toBe(642_000);
  });

  it("gemini-3.6-flash (the failover): priced at the published 2027 rate, $1.50 in and $7.50 out per 1M, even while the 2026 rate is lower", async () => {
    const m = await load();
    expect(m.estimateSpendNano({ ...GEMINI, inputTokens: 1_000_000, outputTokens: 0 })).toBe(1_500_000_000);
    expect(m.estimateSpendNano({ ...GEMINI, inputTokens: 0, outputTokens: 1_000_000 })).toBe(7_500_000_000);
    expect(m.estimateSpendNano({ ...GEMINI, inputTokens: 2400, outputTokens: 470 })).toBe(7_125_000);
  });

  it("names where each price was read and when", async () => {
    const m = await load();
    expect(m.GROQ_PRICE_SOURCE).toEqual({ url: "https://console.groq.com/docs/model/openai/gpt-oss-120b", readOn: "2026-10-04" });
    expect(m.GEMINI_PRICE_SOURCE).toEqual({ url: "https://ai.google.dev/gemini-api/docs/pricing", readOn: "2026-10-04" });
  });

  it("an unknown model or provider is priced at the MOST expensive known row, never at zero and never below any known row", async () => {
    const m = await load();
    for (const shape of [
      { inputTokens: 1000, outputTokens: 1000 },
      { inputTokens: 1_000_000, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 1_000_000 },
      { inputTokens: 2400, outputTokens: 470 },
    ]) {
      const unknown = m.estimateSpendNano({ provider: "someone-else", model: "x-1", ...shape });
      expect(unknown).toBeGreaterThanOrEqual(m.estimateSpendNano({ ...GROQ, ...shape }));
      expect(unknown).toBeGreaterThanOrEqual(m.estimateSpendNano({ ...GEMINI, ...shape }));
      expect(m.estimateSpendNano({ ...shape })).toBe(unknown); // no provider and no model at all
    }
    expect(m.estimateSpendNano({ provider: "someone-else", model: "x-1", inputTokens: 1000, outputTokens: 1000 })).toBe(9_000_000);
  });

  it("a known provider with an unknown model is also priced at the most expensive row (a model swap cannot silently lower the estimate)", async () => {
    const m = await load();
    expect(m.estimateSpendNano({ provider: "groq", model: "some-new-model", inputTokens: 1000, outputTokens: 1000 })).toBe(9_000_000);
  });

  it("rounds a fractional cost UP to a whole nano-dollar, and never returns a negative or NaN for bad counts", async () => {
    const m = await load();
    expect(Number.isInteger(m.estimateSpendNano({ inputTokens: 3, outputTokens: 7 }))).toBe(true);
    expect(m.estimateSpendNano({ inputTokens: -5, outputTokens: Number.NaN })).toBe(0);
  });
});

describe("the flat estimates (used only when the provider reported no token counts)", () => {
  it("a failed or aborted model call is 2,400 in + 500 out at the Groq row = 660,000 nano-dollars", async () => {
    const m = await load();
    expect(m.FAILED_ATTEMPT_ESTIMATE_NANO).toBe(660_000);
    expect(m.FAILED_ATTEMPT_ESTIMATE_NANO).toBe(m.estimateSpendNano({ ...GROQ, inputTokens: 2400, outputTokens: 500 }));
  });

  it("a completed reply with no counts is the worst the request caps allow, at the most expensive row = 18,180,000 nano-dollars", async () => {
    const m = await load();
    expect(m.NO_COUNTS_REPLY_ESTIMATE_NANO).toBe(18_180_000);
    // 7,000 in (REQUEST_TOKEN_CEILING) + 1,024 out (CHAT_MAX_OUTPUT_TOKENS) at $1.50 / $7.50 per 1M
    expect(m.NO_COUNTS_REPLY_ESTIMATE_NANO).toBe(m.estimateSpendNano({ inputTokens: REQUEST_TOKEN_CEILING, outputTokens: CHAT_MAX_OUTPUT_TOKENS }));
  });

  it("the request caps the derivation rests on are themselves pinned here, so a changed cap cannot move the estimate silently", () => {
    expect(REQUEST_TOKEN_CEILING).toBe(7000);
    expect(CHAT_MAX_OUTPUT_TOKENS).toBe(1024);
  });
});

describe("checkSpendCeiling", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const tally = (spent: number, firstWarn = true): Tally => ({ read: async () => spent, markWarned: async () => firstWarn });
  const ceiling = (m: Mod) => Math.round(m.DEFAULT_DAILY_CEILING_USD * m.NANO_PER_USD);

  it("(a) under the ceiling: ok, and reports the ceiling it used", async () => {
    const m = await load();
    const r = await m.checkSpendCeiling(tally(ceiling(m) - 1), {});
    expect(r.status).toBe("ok");
    expect(r.ceilingNano).toBe(ceiling(m));
  });

  it("(b) at the ceiling, and over it: blocked", async () => {
    const m = await load();
    expect((await m.checkSpendCeiling(tally(ceiling(m)), {})).status).toBe("blocked");
    expect((await m.checkSpendCeiling(tally(ceiling(m) * 5), {})).status).toBe("blocked");
  });

  it("(d) a missing or invalid setting uses the default: one nano-dollar under passes, exactly at it blocks", async () => {
    const m = await load();
    for (const env of [{}, { [ENV]: "garbage" }, { [ENV]: "-3" }]) {
      expect((await m.checkSpendCeiling(tally(ceiling(m) - 1), env)).status).toBe("ok");
      expect((await m.checkSpendCeiling(tally(ceiling(m)), env)).status).toBe("blocked");
    }
  });

  it("a valid setting moves the line (half the default blocks at half; double the default passes at the default)", async () => {
    const m = await load();
    const d = m.DEFAULT_DAILY_CEILING_USD;
    expect((await m.checkSpendCeiling(tally(ceiling(m) / 2), { [ENV]: String(d / 2) })).status).toBe("blocked");
    expect((await m.checkSpendCeiling(tally(ceiling(m)), { [ENV]: String(d * 2) })).status).toBe("ok");
  });

  it("(e) a failure reading the tally THROWS (the caller fails closed); it is never swallowed into ok", async () => {
    const m = await load();
    const broken: Tally = { read: async () => { throw new Error("db down"); }, markWarned: async () => true };
    await expect(m.checkSpendCeiling(broken, {})).rejects.toThrow();
  });

  it("the 50% warning: one content-free line, only for the first caller of the day, nothing below 50%", async () => {
    const m = await load();
    const half = ceiling(m) / 2;
    await m.checkSpendCeiling(tally(half - 1), {});
    expect(warn).not.toHaveBeenCalled();
    await m.checkSpendCeiling(tally(half, true), {});
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toMatch(/^\[farah-spend:half\] .*50%/);
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    await m.checkSpendCeiling(tally(half + 1, false), {});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a failure to mark the warning never blocks and never throws (the warning is a convenience, the ceiling is the safeguard)", async () => {
    const m = await load();
    const flaky: Tally = { read: async () => ceiling(m) / 2, markWarned: async () => { throw new Error("db down"); } };
    await expect(m.checkSpendCeiling(flaky, {})).resolves.toMatchObject({ status: "ok" });
  });
});
