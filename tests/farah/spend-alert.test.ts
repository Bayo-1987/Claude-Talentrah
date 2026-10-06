/**
 * The early warning on Farah's daily spend ceiling.
 *
 * The ceiling stops Farah when the day's estimated spend reaches the limit; until now the only earlier sign was a log line at 50%. This adds an email to the operator
 * (the existing admin alert, ADMIN_ALERT_EMAIL) at 80% of the ceiling and again when the ceiling is reached.
 *
 * WHEN AN ALERT COUNTS AS DONE. Only after a send SUCCEEDED. A request that crosses the line asks the counter for an attempt (claimAlertAttempt); if it gets one it sends, and only a successful
 * send is recorded (markAlertSent). A failed send is logged (content-free) and the day's alert stays open, so a later request the same day can try again; the counter, not this code's memory,
 * bounds that to a few attempts a day and to one attempt in flight at a time (tests/farah/llm-alert-attempts.test.ts, against the real database). The 80% and "reached" alerts are claimed and
 * recorded separately: if one covered both, a day that sent the 80% alert would never send the one that matters more.
 *
 * The alert is a convenience and the ceiling is the safeguard: nothing here may block or throw out of the check, change its answer, or wait on the mail provider for more than the sender's own cap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSpendCeiling, DEFAULT_DAILY_CEILING_USD, NANO_PER_USD } from "@/lib/farah/spend-ceiling";

const sendAdminAlert = vi.fn();
vi.mock("@/lib/admin/alert-email", () => ({ sendAdminAlert }));

type Level = "eighty" | "reached";
interface Tally {
  read(): Promise<number>;
  markWarned(): Promise<boolean>;
  claimAlertAttempt?(level: Level): Promise<boolean>;
  markAlertSent?(level: Level): Promise<unknown>;
}
type Notify = (level: Level, spentNano: number, ceilingNano: number) => Promise<boolean>;
type Check = (tally: Tally, env?: Record<string, string | undefined>, notify?: Notify) => Promise<{ status: "ok" | "blocked"; spentNano: number; ceilingNano: number }>;
const check = checkSpendCeiling as unknown as Check;

const CEILING = Math.round(DEFAULT_DAILY_CEILING_USD * NANO_PER_USD);
const EIGHTY = CEILING * 0.8;

/** A tally whose counter answers `claim` per level (true = this caller may try now) and records every call in order. */
function tally(spent: number, o: { claim?: Partial<Record<Level, boolean | Error>>; mark?: Error } = {}) {
  const calls: string[] = [];
  const t = {
    calls,
    read: async () => spent,
    markWarned: async () => false,
    claimAlertAttempt: async (level: Level) => {
      calls.push(`claim:${level}`);
      const v = o.claim?.[level] ?? true;
      if (v instanceof Error) throw v;
      return v;
    },
    markAlertSent: async (level: Level) => {
      calls.push(`mark:${level}`);
      if (o.mark) throw o.mark;
      return true;
    },
  };
  return t;
}

let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  errorSpy.mockRestore();
});
const errorLines = (): string[] => (errorSpy.mock.calls as unknown[][]).map((c) => String(c[0]));

describe("checkSpendCeiling: when the alerts are attempted", () => {
  it("below 80%: no alert, and the counter is not asked at all (no extra counter call on ordinary messages)", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(EIGHTY - 1);
    expect((await check(t, {}, notify)).status).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
    expect(t.calls).toEqual([]);
  });

  it("at 80% exactly (and above, below the ceiling): the caller that gets the attempt sends the 80% alert, with the figures, and records it", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(EIGHTY);
    expect((await check(t, {}, notify)).status).toBe("ok");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("eighty", EIGHTY, CEILING);
    expect(t.calls).toEqual(["claim:eighty", "mark:eighty"]);
    await check(tally(CEILING - 1), {}, notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("a caller that does not get the attempt (already sent today, attempts used up, or another attempt in flight) sends and records nothing", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(EIGHTY + 5, { claim: { eighty: false } });
    await check(t, {}, notify);
    expect(notify).not.toHaveBeenCalled();
    expect(t.calls).toEqual(["claim:eighty"]);
  });

  it("at the ceiling: blocked, and the caller that gets the attempt sends the 'reached' alert, not the 80% one", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(CEILING);
    expect((await check(t, {}, notify)).status).toBe("blocked");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("reached", CEILING, CEILING);
    expect(t.calls, "a jump straight past the ceiling does not also claim the 80% alert").toEqual(["claim:reached", "mark:reached"]);
  });

  it("blocked and no attempt available for 'reached': no alert, still blocked", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    expect((await check(tally(CEILING * 3, { claim: { reached: false } }), {}, notify)).status).toBe("blocked");
    expect(notify).not.toHaveBeenCalled();
  });

  it("the 80% alert already being done today does not stop the 'reached' alert: they are claimed separately", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(CEILING, { claim: { eighty: false, reached: true } });
    await check(t, {}, notify);
    expect(notify).toHaveBeenCalledWith("reached", CEILING, CEILING);
    expect(t.calls).toContain("claim:reached");
    expect(t.calls).toContain("mark:reached");
  });

  it("the alert follows the configured ceiling, not the default", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const env = { FARAH_DAILY_SPEND_CEILING_USD: "5" };
    const ceiling = 5 * NANO_PER_USD;
    await check(tally(ceiling * 0.8 - 1), env, notify);
    expect(notify).not.toHaveBeenCalled();
    await check(tally(ceiling * 0.8), env, notify);
    expect(notify).toHaveBeenCalledWith("eighty", ceiling * 0.8, ceiling);
  });
});

describe("an alert counts as done only after a send SUCCEEDED", () => {
  it("the order is: ask for the attempt, send, and only then record it (never before the send)", async () => {
    const t = tally(EIGHTY);
    const notify = vi.fn(async () => {
      t.calls.push("send");
      return true;
    });
    await check(t, {}, notify);
    expect(t.calls).toEqual(["claim:eighty", "send", "mark:eighty"]);
  });

  it("a send that reports it did not go out records NOTHING, logs one content-free error line, and leaves the answer unchanged", async () => {
    const notify = vi.fn().mockResolvedValue(false);
    const t = tally(EIGHTY);
    await expect(check(t, {}, notify)).resolves.toMatchObject({ status: "ok" });
    expect(t.calls).toEqual(["claim:eighty"]);
    const lines = errorLines().filter((l) => l.startsWith("[farah-spend:alert-not-sent]"));
    expect(lines).toEqual(["[farah-spend:alert-not-sent] level=eighty"]);
  });

  it("a send that throws is the same as one that did not go out (reached: still blocked)", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("mail down: smtp.internal-host.example refused"));
    const t = tally(CEILING);
    await expect(check(t, {}, notify)).resolves.toMatchObject({ status: "blocked" });
    expect(t.calls).toEqual(["claim:reached"]);
    expect(errorLines().filter((l) => l.startsWith("[farah-spend:alert-not-sent]"))).toEqual(["[farah-spend:alert-not-sent] level=reached"]);
    expect(errorLines().join("\n")).not.toMatch(/smtp|internal-host|mail down/);
  });

  it("the day's alert stays open after a failed send: the next request that gets an attempt sends it again, and a success closes it", async () => {
    // A model of the counter's own rule (the real one is SQL, tested against the database): one attempt at a time, three at most, none once sent.
    let attempts = 0;
    let sent = false;
    const model: Tally & { calls: string[] } = {
      calls: [],
      read: async () => EIGHTY,
      markWarned: async () => false,
      claimAlertAttempt: async () => (sent || attempts >= 3 ? false : ((attempts += 1), true)),
      markAlertSent: async () => ((sent = true), true),
    };
    const results = [false, false, true];
    const notify = vi.fn(async () => results.shift() ?? true);
    for (let i = 0; i < 6; i += 1) await check(model, {}, notify);
    expect(notify).toHaveBeenCalledTimes(3); // two failures, then the success; nothing after it
    expect(sent).toBe(true);
    expect(errorLines().filter((l) => l.startsWith("[farah-spend:alert-not-sent]"))).toHaveLength(2);
  });

  it("and if every send fails, the counter's bound stops it: no more than the allowed attempts, whatever the traffic", async () => {
    let attempts = 0;
    const model: Tally = {
      read: async () => EIGHTY,
      markWarned: async () => false,
      claimAlertAttempt: async () => (attempts >= 3 ? false : ((attempts += 1), true)),
      markAlertSent: async () => true,
    };
    const notify = vi.fn().mockResolvedValue(false);
    for (let i = 0; i < 20; i += 1) await check(model, {}, notify);
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("a failing record of the send does not change the answer either, and logs one content-free line", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const t = tally(EIGHTY, { mark: Object.assign(new Error("connection to db-7 lost"), { code: "08006" }) });
    await expect(check(t, {}, notify)).resolves.toMatchObject({ status: "ok" });
    const lines = errorLines().filter((l) => l.startsWith("[farah-spend:alert-mark-failed]"));
    expect(lines).toEqual(["[farah-spend:alert-mark-failed] level=eighty code=08006"]);
    expect(errorLines().join("\n")).not.toMatch(/db-7/);
  });
});

describe("checkSpendCeiling: the alert never blocks and never throws", () => {
  it("a failing counter (the attempt cannot be asked for) does not change the answer either way, sends nothing, and logs one content-free line", async () => {
    const notify = vi.fn().mockResolvedValue(true);
    const err = Object.assign(new Error("relation public.some_internal_table does not exist"), { code: "42P01" });
    await expect(check(tally(EIGHTY, { claim: { eighty: err } }), {}, notify)).resolves.toMatchObject({ status: "ok" });
    await expect(check(tally(CEILING, { claim: { reached: err } }), {}, notify)).resolves.toMatchObject({ status: "blocked" });
    expect(notify).not.toHaveBeenCalled();
    const lines = errorLines().filter((l) => l.startsWith("[farah-spend:alert-counter-failed]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("level=eighty");
    expect(lines[0]).toContain("code=42P01");
    expect(errorLines().join("\n")).not.toMatch(/some_internal_table|does not exist/);
  });

  it("no sender supplied (the existing callers): nothing happens and nothing throws", async () => {
    await expect(check(tally(EIGHTY), {})).resolves.toMatchObject({ status: "ok" });
    await expect(check(tally(CEILING), {})).resolves.toMatchObject({ status: "blocked" });
  });

  it("a tally that has no alert functions (an old caller) is fine", async () => {
    const bare: Tally = { read: async () => EIGHTY, markWarned: async () => false };
    await expect(check(bare, {}, vi.fn())).resolves.toMatchObject({ status: "ok" });
  });
});

describe("sendSpendAlert: what the operator is told, and whether it went out", () => {
  beforeEach(() => {
    sendAdminAlert.mockReset().mockResolvedValue({ sent: true });
  });

  async function load() {
    return (await import("@/lib/farah/spend-alert")) as { sendSpendAlert(level: Level, spentNano: number, ceilingNano: number): Promise<boolean> };
  }

  it("80%: the subject names the 80%, the body has the figures in dollars and what happens at 100%", async () => {
    const { sendSpendAlert } = await load();
    expect(await sendSpendAlert("eighty", 0.82 * NANO_PER_USD, NANO_PER_USD)).toBe(true);
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    const m = sendAdminAlert.mock.calls[0][0] as { subject: string; text: string };
    expect(m.subject).toBe("Farah has used 80% of today's budget");
    expect(m.text).toContain("$0.82 of $1.00");
    expect(m.text).toMatch(/stops replying/i);
    expect(m.text).toContain("00:00 UTC");
    expect(m.text).toContain("FARAH_DAILY_SPEND_CEILING_USD");
  });

  it("reached: the subject says the budget is used and Farah is not replying until 00:00 UTC", async () => {
    const { sendSpendAlert } = await load();
    await sendSpendAlert("reached", 1.0003 * NANO_PER_USD, NANO_PER_USD);
    const m = sendAdminAlert.mock.calls[0][0] as { subject: string; text: string };
    expect(m.subject).toBe("Farah has used today's whole budget");
    expect(m.text).toContain("$1.00 of $1.00");
    expect(m.text).toMatch(/not replying/i);
    expect(m.text).toContain("00:00 UTC");
  });

  it("the figures follow the configured ceiling ($2.50), rounded to cents", async () => {
    const { sendSpendAlert } = await load();
    await sendSpendAlert("eighty", 2.0 * NANO_PER_USD + 4_000_000, 2.5 * NANO_PER_USD);
    expect((sendAdminAlert.mock.calls[0][0] as { text: string }).text).toContain("$2.00 of $2.50");
  });

  it("it carries no personal data: no email address, no user id, no message text", async () => {
    const { sendSpendAlert } = await load();
    for (const level of ["eighty", "reached"] as const) {
      await sendSpendAlert(level, 0.9 * NANO_PER_USD, NANO_PER_USD);
    }
    for (const call of sendAdminAlert.mock.calls) {
      const m = call[0] as { subject: string; text: string };
      expect(`${m.subject}\n${m.text}`).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });

  it("it says whether the mail went out: false when the sender reports it did not (no recipient, no key, the provider refused)", async () => {
    sendAdminAlert.mockResolvedValue({ sent: false, reason: "ADMIN_ALERT_EMAIL is not set" });
    const { sendSpendAlert } = await load();
    expect(await sendSpendAlert("eighty", 0.8 * NANO_PER_USD, NANO_PER_USD)).toBe(false);
  });

  it("a sender that rejects does not escape; it counts as not sent", async () => {
    sendAdminAlert.mockRejectedValue(new Error("mail down"));
    const { sendSpendAlert } = await load();
    await expect(sendSpendAlert("eighty", 0.8 * NANO_PER_USD, NANO_PER_USD)).resolves.toBe(false);
  });

  it("a sender that hangs does not hold the caller more than a couple of seconds, and counts as not sent", async () => {
    vi.useFakeTimers();
    try {
      sendAdminAlert.mockReturnValue(new Promise(() => {}));
      const { sendSpendAlert } = await load();
      const done = vi.fn();
      const p = sendSpendAlert("eighty", 0.8 * NANO_PER_USD, NANO_PER_USD).then(done);
      await vi.advanceTimersByTimeAsync(2_500);
      await p;
      expect(done).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
