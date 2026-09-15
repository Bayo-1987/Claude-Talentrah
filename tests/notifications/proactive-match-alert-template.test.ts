/**
 * send-138's proactive "exceptional match" alert template
 * (src/lib/notifications/proactive-match-alert/template.ts).
 *
 * `select.ts`'s own `isExcellentMatch` already refuses a thin-denominator
 * match at eligibility time (see proactive-match-alert-select.test.ts's own
 * SABOTAGE-PROOF TARGET), so a thin match should never reach this template at
 * all in the real pipeline. What THIS file pins is narrower but still real:
 * the template must not carry its OWN copy of `displayMatchScore`'s Stage 12
 * 99-cap — it routes through `describeMatchConfidence` (match-tier.ts) like
 * every other render site, per docs/match-confidence-invariant.md, so a
 * >=100 raw score (which `computeMatchScore` can produce) never appears
 * verbatim in an email that already claims "an exceptional match".
 */
import { describe, expect, it } from "vitest";
import { buildProactiveAlertEmail, buildProactiveAlertInApp } from "@/lib/notifications/proactive-match-alert/template";
import type { ScoredNewJob } from "@/lib/notifications/proactive-match-alert/select";

const job = (over: Partial<ScoredNewJob> = {}): ScoredNewJob => ({
  jobId: "job-1",
  title: "Senior Backend Engineer",
  companyName: "Verified Co",
  location: "Lagos",
  score: 92,
  explanation: {
    matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"],
    missingSkills: ["react"],
    seniorityAlignment: "unknown",
  },
  ...over,
});

describe("display score is capped, not raw — Stage 12's cap applies here too", () => {
  it(
    "SABOTAGE-PROOF TARGET: a >=100 raw score never appears verbatim in the email or in-app copy",
    () => {
      const raw = job({ score: 105 });
      const email = buildProactiveAlertEmail({ firstName: "Ada", job: raw, unsubscribeToken: "tok" });
      const inApp = buildProactiveAlertInApp(raw);

      expect(email.text).not.toMatch(/105%/);
      expect(email.html).not.toMatch(/105%/);
      expect(inApp.body).not.toMatch(/105%/);
      expect(email.text).toContain("99%");
      expect(email.html).toContain("99%");
      expect(inApp.body).toContain("99%");
    },
  );

  it("POSITIVE CONTROL: an ordinary score under the cap renders unchanged", () => {
    const ordinary = job({ score: 92 });
    const email = buildProactiveAlertEmail({ firstName: "Ada", job: ordinary, unsubscribeToken: "tok" });
    const inApp = buildProactiveAlertInApp(ordinary);
    expect(email.text).toContain("92%");
    expect(inApp.body).toContain("92%");
  });

  it("still names the job, company and the standing 'rare alert' promise from §6.10", () => {
    const email = buildProactiveAlertEmail({ firstName: "Ada", job: job(), unsubscribeToken: "tok" });
    expect(email.text).toContain("Senior Backend Engineer");
    expect(email.text).toContain("Verified Co");
    expect(email.text).toContain("You'll only hear from me like this for matches this strong.");
  });
});
