/**
 * send-100's pure job-seed helpers. `seedFarahForJob`/`onFarahJobSeed`
 * themselves touch `window` and are NOT covered here — this repo's vitest
 * environment is plain Node (see farah-panel-transcript.test.tsx's own
 * header for the identical boundary on the panel's history-fetch effect),
 * so the actual event round trip needs a real browser, verified live rather
 * than in this suite. What's testable without one is everything that
 * doesn't touch the DOM: the templated copy and the two link builders.
 */
import { describe, expect, it } from "vitest";
import { JOB_SEED_CHAT_STARTERS, coverLetterHref, jobSeedOpener, tailorHref } from "@/lib/farah/job-seed";

describe("jobSeedOpener", () => {
  it("names the actual job's title and company", () => {
    const opener = jobSeedOpener({ jobId: "j1", jobTitle: "Backend Engineer", companyName: "Flutterwave" });
    expect(opener).toContain("Backend Engineer");
    expect(opener).toContain("Flutterwave");
  });

  it("offers both fit and resume-strength framing, not just one", () => {
    const opener = jobSeedOpener({ jobId: "j1", jobTitle: "Backend Engineer", companyName: "Flutterwave" });
    expect(opener).toMatch(/fit/i);
    expect(opener).toMatch(/resume/i);
  });
});

describe("tailorHref / coverLetterHref", () => {
  it("both carry the given jobId", () => {
    expect(tailorHref("abc-123")).toContain("jobId=abc-123");
    expect(coverLetterHref("abc-123")).toContain("jobId=abc-123");
  });

  it("differ ONLY by the coverLetter flag — the exact contract /tailor's own page reads", () => {
    // src/app/(app)/tailor/page.tsx checks `coverLetter === "1" || coverLetter === "true"`.
    expect(tailorHref("abc-123")).toBe("/tailor?jobId=abc-123");
    expect(coverLetterHref("abc-123")).toBe("/tailor?jobId=abc-123&coverLetter=1");
  });
});

describe("JOB_SEED_CHAT_STARTERS", () => {
  it("has exactly two real-chat-message starters, both keyed to the job_fit entry point", () => {
    expect(JOB_SEED_CHAT_STARTERS).toHaveLength(2);
    for (const starter of JOB_SEED_CHAT_STARTERS) {
      expect(starter.key).toBe("job_fit");
      expect(starter.label.length).toBeGreaterThan(0);
    }
  });

  it("the two labels are distinct — no risk of an accidental duplicate starter", () => {
    const labels = JOB_SEED_CHAT_STARTERS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
