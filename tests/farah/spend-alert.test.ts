/**
 * The early warning on Farah's daily spend ceiling.
 *
 * The ceiling stops Farah when the day's estimated spend reaches the limit; until now the only earlier sign was a log line at 50%. This adds an email to the operator
 * (the existing admin alert, ADMIN_ALERT_EMAIL) at 80% of the ceiling and again when the ceiling is reached, each at most once a day. "Once a day" is decided by the counter
 * (a marker per alert, added to by the first caller of the day only), not by this code's memory, so it holds across server instances.
 *
 * The 80% and "reached" alerts have separate markers on purpose: if one marker covered both, a day that sent the 80% alert would never send the one that matters more.
 * The alert is a convenience and the ceiling is the safeguard: nothing here may block or throw out of the check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSpendCeiling, DEFAULT_DAILY_CEILING_USD, NANO_PER_USD } from "@/lib/farah/spend-ceiling";

const sendAdminAlert = vi.fn();
vi.mock("@/lib/admin/alert-email", () => ({ sendAdminAlert }));

interface Tally {
  read(): Promise<number>;
  markWarned(): Promise<boolean>;
  markEightyWarned?(): Promise<boolean>;
  markReachedWarned?(): Promise<boolean>;
}
type Notify = (level: "eighty" | "reached", spentNano: number, ceilingNano: number) => Promise<void>;
type Check = (tally: Tally, env?: Record<string, string | undefined>, notify?: Notify) => Promise<{ status: "ok" | "blocked"; spentNano: number; ceilingNano: number }>;
const check = checkSpendCeiling as unknown as Check;

const CEILING = Math.round(DEFAULT_DAILY_CEILING_USD * NANO_PER_USD);
const EIGHTY = CEILING * 0.8;

function tally(spent: number, o: { eighty?: boolean | Error; reached?: boolean | Error } = {}): Tally & { eightyCalls: number; reachedCalls: number } {
  const t = {
    eightyCalls: 0,
    reachedCalls: 0,
    read: async () => spent,
    markWarned: async () => false,
    markEightyWarned: async () => {
      t.eightyCalls += 1;
      if (o.eighty instanceof Error) throw o.eighty;
      return o.eighty ?? true;
    },
    markReachedWarned: async () => {
      t.reachedCalls += 1;
      if (o.reached instanceof Error) throw o.reached;
      return o.reached ?? true;
    },
  };
  return t;
}

describe("checkSpendCeiling: when the alerts fire", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("below 80%: no alert, and the 80% marker is not even touched (no extra counter call on ordinary messages)", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const t = tally(EIGHTY - 1);
    expect((await check(t, {}, notify)).status).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
    expect(t.eightyCalls).toBe(0);
  });

  it("at 80% exactly (and above, below the ceiling): the first caller of the day sends the 80% alert once, with the figures", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    expect((await check(tally(EIGHTY), {}, notify)).status).toBe("ok");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("eighty", EIGHTY, CEILING);
    await check(tally(CEILING - 1), {}, notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("a later caller the same day (the marker says someone already sent it) sends nothing", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await check(tally(EIGHTY + 5, { eighty: false }), {}, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it("at the ceiling: blocked, and the first blocked caller of the day sends the 'reached' alert, not the 80% one", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const t = tally(CEILING);
    expect((await check(t, {}, notify)).status).toBe("blocked");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("reached", CEILING, CEILING);
    expect(t.eightyCalls, "a jump straight past the ceiling does not also send the 80% alert").toBe(0);
  });

  it("blocked and the 'reached' marker already taken: no alert, still blocked", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    expect((await check(tally(CEILING * 3, { reached: false }), {}, notify)).status).toBe("blocked");
    expect(notify).not.toHaveBeenCalled();
  });

  it("the alert follows the configured ceiling, not the default", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const env = { FARAH_DAILY_SPEND_CEILING_USD: "5" };
    const ceiling = 5 * NANO_PER_USD;
    await check(tally(ceiling * 0.8 - 1), env, notify);
    expect(notify).not.toHaveBeenCalled();
    await check(tally(ceiling * 0.8), env, notify);
    expect(notify).toHaveBeenCalledWith("eighty", ceiling * 0.8, ceiling);
  });
});

describe("checkSpendCeiling: the alert never blocks and never throws", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("a failing sender does not change the answer (80%)", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("mail down"));
    await expect(check(tally(EIGHTY), {}, notify)).resolves.toMatchObject({ status: "ok" });
  });

  it("a failing sender does not change the answer (reached): still blocked", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("mail down"));
    await expect(check(tally(CEILING), {}, notify)).resolves.toMatchObject({ status: "blocked" });
  });

  it("a failing marker does not change the answer either way, and sends nothing", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await expect(check(tally(EIGHTY, { eighty: new Error("db down") }), {}, notify)).resolves.toMatchObject({ status: "ok" });
    await expect(check(tally(CEILING, { reached: new Error("db down") }), {}, notify)).resolves.toMatchObject({ status: "blocked" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("no sender supplied (the existing callers): nothing happens and nothing throws", async () => {
    await expect(check(tally(EIGHTY), {})).resolves.toMatchObject({ status: "ok" });
    await expect(check(tally(CEILING), {})).resolves.toMatchObject({ status: "blocked" });
  });

  it("a tally that has no alert markers (an old caller) is fine", async () => {
    const bare: Tally = { read: async () => EIGHTY, markWarned: async () => false };
    await expect(check(bare, {}, vi.fn())).resolves.toMatchObject({ status: "ok" });
  });
});

describe("sendSpendAlert: what the operator is told", () => {
  beforeEach(() => {
    sendAdminAlert.mockReset().mockResolvedValue({ sent: true });
  });

  async function load() {
    return (await import("@/lib/farah/spend-alert")) as { sendSpendAlert(level: "eighty" | "reached", spentNano: number, ceilingNano: number): Promise<void> };
  }

  it("80%: the subject names the 80%, the body has the figures in dollars and what happens at 100%", async () => {
    const { sendSpendAlert } = await load();
    await sendSpendAlert("eighty", 0.82 * NANO_PER_USD, NANO_PER_USD);
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

  it("a sender that rejects does not escape (the alert is a convenience)", async () => {
    sendAdminAlert.mockRejectedValue(new Error("mail down"));
    const { sendSpendAlert } = await load();
    await expect(sendSpendAlert("eighty", 0.8 * NANO_PER_USD, NANO_PER_USD)).resolves.toBeUndefined();
  });

  it("a sender that hangs does not hold the caller more than a couple of seconds", async () => {
    vi.useFakeTimers();
    try {
      sendAdminAlert.mockReturnValue(new Promise(() => {}));
      const { sendSpendAlert } = await load();
      const done = vi.fn();
      const p = sendSpendAlert("eighty", 0.8 * NANO_PER_USD, NANO_PER_USD).then(done);
      await vi.advanceTimersByTimeAsync(2_500);
      await p;
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
