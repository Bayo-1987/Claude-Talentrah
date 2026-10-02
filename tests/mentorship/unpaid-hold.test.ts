/**
 * send-502 / S15 — an unpaid booking holds its slot for 30 minutes, then it is released.
 *
 * The rule has to hold WITHOUT the daily sweep (Vercel Hobby crons cannot run more often), so it is enforced at read and
 * booking time in SQL (migration 0203) and mirrored here for the mentee's own page. Two copies of one number, so one test
 * pins them to each other: the TypeScript constant must equal the interval the migration defines.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UNPAID_HOLD_MINUTES,
  UNPAID_HOLD_NOTICE,
  unpaidHoldEndsAt,
  unpaidHoldLapsed,
} from "@/lib/mentorship/unpaid-hold";

const CREATED = "2026-10-01T12:00:00.000Z";
const at = (offsetMs: number) => new Date(Date.parse(CREATED) + offsetMs);
const MIN = 60_000;

describe("the unpaid hold", () => {
  it("is 30 minutes", () => {
    expect(UNPAID_HOLD_MINUTES).toBe(30);
  });

  it("is still held at 29:59", () => {
    expect(unpaidHoldLapsed(CREATED, at(29 * MIN + 59_000))).toBe(false);
  });

  it("has lapsed at 30:01", () => {
    expect(unpaidHoldLapsed(CREATED, at(30 * MIN + 1_000))).toBe(true);
  });

  it("lapses AT 30:00, matching the SQL's created_at <= now() - hold", () => {
    expect(unpaidHoldLapsed(CREATED, at(30 * MIN))).toBe(true);
  });

  it("reports when the hold ends", () => {
    expect(unpaidHoldEndsAt(CREATED).toISOString()).toBe("2026-10-01T12:30:00.000Z");
  });

  it("tells the mentee, in these words, how long they have", () => {
    expect(UNPAID_HOLD_NOTICE).toBe("Complete payment within 30 minutes to keep this slot");
  });

  it("is the same 30 minutes the migration enforces", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/0203_mentor_session_unpaid_expiry.sql"), "utf8");
    const m = sql.match(/function public\.mentor_unpaid_hold\(\)[\s\S]*?interval '(\d+) minutes'/);
    expect(m, "0203 must define public.mentor_unpaid_hold() as an interval of N minutes").not.toBeNull();
    expect(Number(m![1])).toBe(UNPAID_HOLD_MINUTES);
  });
});
