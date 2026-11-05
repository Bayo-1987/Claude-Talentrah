/**
 * PR-U1: what the plan STORES as a posting's seniority, pinned on synthetic titles so a later change to the rule shows up red. The plan uses inferJobSeniority (S12 (e)): a title that does not
 * state a seniority stores NULL, never the old "mid" default (the "everything is mid" bug fixed in PR #636, which the script's old inferSeniority call had brought back). Measured on the two
 * real sheets, only this field differs from the old script and only for these shapes of title: silent (mid -> null), the word "executive" alone (executive -> null), "senior" or "trainee"
 * beside "executive" (executive -> senior / entry), "trainee" (mid -> entry). The titles here are invented.
 */
import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/jobs/sheet-import/plan";
import { buildPlan as scriptBuildPlan } from "../../scripts/import-jobs-sheet";
import { NOW, csv, linkRow } from "./support";

const stored = (title: string) => {
  const plan = buildPlan(csv([linkRow({ title, company: "Synthetic Co" })]), { now: NOW });
  expect(plan.items, `${title} must be importable for this test to mean anything`).toHaveLength(1);
  return plan.items[0].insert.seniority;
};

describe("the seniority the plan stores", () => {
  it("a title with a clear seniority word stores it", () => {
    expect(stored("Senior Backend Developer")).toBe("senior");
    expect(stored("Team Lead, Customer Support")).toBe("lead");
    expect(stored("Executive Director of Finance")).toBe("executive");
    expect(stored("Chief Operating Officer")).toBe("executive");
    expect(stored("Trainee Accountant")).toBe("entry");
    expect(stored("Junior Designer")).toBe("entry");
  });

  it("a SILENT title stores null: never the old 'mid' default", () => {
    expect(stored("Customer Care Representative")).toBeNull();
    expect(stored("Warehouse Operative")).toBeNull();
    expect(stored("Marketing Officer")).toBeNull();
  });

  it("an AMBIGUOUS title: the word 'executive' alone is a job family, not a seniority, so it stores null; beside a real seniority word the real one wins", () => {
    expect(stored("Sales Executive")).toBeNull();
    expect(stored("Account Executive")).toBeNull();
    expect(stored("Senior Account Executive")).toBe("senior");
    expect(stored("Graduate Trainee Executive")).toBe("entry");
  });

  it("the one named exception: an assistant, associate or deputy manager is mid", () => {
    expect(stored("Assistant Manager, Retail")).toBe("mid");
  });

  it("the script and the uploader share one plan: the same title stores the same value through either", () => {
    expect(scriptBuildPlan).toBe(buildPlan);
  });
});
