/**
 * vercel.json's cron list against Vercel's published limits, read from the docs on 2026-10-02
 * (https://vercel.com/docs/cron-jobs/usage-and-pricing, "Last updated July 15, 2026"):
 *
 *   every plan, Hobby included:  100 cron jobs per project
 *   Hobby:                       each job at most once per day, scheduling precision ±59 minutes
 *   Pro / Enterprise:            once per minute, per-minute precision
 *
 * The older "Hobby allows 2 cron jobs" figure is out of date; this repo already schedules well over 2, so it would not
 * have deployed under it. What this pins is what actually holds: the count stays under the per-project cap, each entry
 * is a once-a-day-at-most schedule (so the file would also deploy on Hobby), and the E3 reminder is registered.
 */
import { describe, expect, it } from "vitest";
import vercelConfig from "../../vercel.json";

const crons = (vercelConfig as { crons: Array<{ path: string; schedule: string }> }).crons;
const MAX_CRONS_PER_PROJECT = 100;

describe("vercel.json crons", () => {
  it("stays under the per-project cron limit", () => {
    expect(crons.length).toBeGreaterThan(0);
    expect(crons.length).toBeLessThanOrEqual(MAX_CRONS_PER_PROJECT);
  });

  it("runs every job at most once a day (a fixed minute and hour; the day fields may narrow it, never widen it)", () => {
    for (const c of crons) {
      const [minute, hour] = c.schedule.split(/\s+/);
      expect(minute, `${c.path}: minute must be a single number`).toMatch(/^\d{1,2}$/);
      expect(hour, `${c.path}: hour must be a single number`).toMatch(/^\d{1,2}$/);
    }
  });

  it("has no path twice", () => {
    expect(new Set(crons.map((c) => c.path)).size).toBe(crons.length);
  });

  it("registers the closing-date reminder", () => {
    expect(crons.some((c) => c.path === "/api/admin/send-expiry-reminders")).toBe(true);
  });
});
