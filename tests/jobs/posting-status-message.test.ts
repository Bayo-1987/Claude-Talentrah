/**
 * The job detail page's status callout (send-447) — extracted to
 * jobPostingStatusMessage so this mapping is testable without rendering the
 * page, the same reason getJobShareVisibility is a pure function.
 *
 * The bug this exists to catch: "This posting is no longer open" is false
 * for a draft (it was never open to begin with), and it would have been the
 * default outcome of the ORIGINAL `job.status !== "open"` check the moment
 * `draft` became a real status — this file pins that draft gets its own,
 * different copy, not a shared fallback with closed/removed.
 */
import { describe, expect, it } from "vitest";
import { jobPostingStatusMessage } from "@/lib/jobs/posting-status-message";

describe("jobPostingStatusMessage", () => {
  it("says nothing for an open posting", () => {
    expect(jobPostingStatusMessage("open")).toBeNull();
  });

  it("tells a draft's own-org viewer it hasn't been published yet — not that it's 'no longer open'", () => {
    const message = jobPostingStatusMessage("draft");
    expect(message).toBe("This posting hasn't been published yet.");
    expect(message).not.toContain("no longer open");
  });

  it("keeps the existing copy for closed", () => {
    expect(jobPostingStatusMessage("closed")).toBe("This posting is no longer open.");
  });

  it("keeps the existing copy for removed", () => {
    expect(jobPostingStatusMessage("removed")).toBe("This posting is no longer open.");
  });

  it("draft's message is distinct from every other non-open status", () => {
    const draftMessage = jobPostingStatusMessage("draft");
    for (const status of ["closed", "removed"] as const) {
      expect(draftMessage).not.toBe(jobPostingStatusMessage(status));
    }
  });
});
