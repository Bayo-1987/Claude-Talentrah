/**
 * send-388 — the free-tier FAQ answer used to describe a "free allotment"
 * of credits on account creation. Checked against the real gating code
 * (src/lib/tailoring/gate.ts, supabase/migrations/0000_baseline_schema.sql:
 * `credits_balance integer not null default 0`): there is no allotment. A
 * new account gets one free tailoring run and one free cover letter run,
 * each a one-time boolean flag (`free_trial_tailoring_used` /
 * `free_trial_cover_letter_used`), not a spendable starting balance.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FaqSection } from "@/components/marketing/faq-section";

describe("the free-tier FAQ answer", () => {
  const html = renderToStaticMarkup(<FaqSection />);

  it("never claims a free credits allotment on account creation", () => {
    expect(html).not.toContain("allotment");
  });

  it("states the real mechanism: one free tailoring run and one free cover letter, then credits", () => {
    expect(html).toContain(
      "Browsing jobs, tracking applications, and building your resume are always free.",
    );
    expect(html).toContain(
      "your first resume tailoring and your first cover letter are free too",
    );
    expect(html).toContain("Talentrah Credits");
  });
});
