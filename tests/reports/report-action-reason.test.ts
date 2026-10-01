/**
 * send-494 / S13 — the server half. Removing the form's default means an empty `reason` can now actually
 * arrive, so this pins what the action does with it: refuse, before any database call.
 *
 * Characterisation: green on the code as it stood (the guard was already there, just unreachable).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { reportJobPostingAction } from "@/lib/reports/actions";
import { initialReportActionState } from "@/lib/reports/state";

const JOB = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  createClient.mockReset();
  createClient.mockImplementation(() => {
    throw new Error("the database must not be touched for an invalid report");
  });
});

describe("reportJobPostingAction without a valid reason", () => {
  for (const [label, fields] of [
    ["no reason at all", { jobId: JOB }],
    ["an empty reason", { jobId: JOB, reason: "" }],
    ["a forged reason", { jobId: JOB, reason: "definitely_a_scam" }],
  ] as const) {
    it(`refuses ${label}, and never reaches the database`, async () => {
      const result = await reportJobPostingAction(initialReportActionState, form(fields));
      expect(result.status).toBe("error");
      expect(result.error).toBe("Pick a reason before sending.");
      expect(createClient).not.toHaveBeenCalled();
    });
  }
});
