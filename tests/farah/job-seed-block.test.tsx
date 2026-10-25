/**
 * The block a job arrives in (FARAH-JOB-CTX-1): what a reader sees when "Ask Farah" is clicked on a job. Static markup only (this project's unit environment has no DOM); real scrolling, focus and the live region are in
 * e2e/farah-job-context-visible.spec.ts. The block is one component used by BOTH arrival paths: the pristine panel (the job replaces the greeting) and a conversation already under way (the job is added at the end under a
 * divider), so the two cannot drift apart.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FarahPanel, JobSeedBlock } from "@/components/app-shell/farah-panel";

const SEED = { jobId: "job-42", jobTitle: "Backend Engineer", companyName: "Flutterwave" };
const block = (over: Partial<Parameters<typeof JobSeedBlock>[0]> = {}) =>
  renderToStaticMarkup(<JobSeedBlock seed={SEED} pending={false} onStarter={() => {}} blockId="b1" withDivider={false} {...over} />);

describe("the context chip: which job Farah has", () => {
  it("shows the job's title and company in a chip at the top of the block", () => {
    const html = block();
    const chip = html.match(/<[^>]*data-testid="job-context-chip"[^>]*>([\s\S]*?)<\/p>/);
    expect(chip, "no context chip").not.toBeNull();
    expect(chip![1]).toContain("Backend Engineer");
    expect(chip![1]).toContain("Flutterwave");
  });
  it("is the first thing in the block when there is no divider, and sits under the divider when there is one", () => {
    const plain = block();
    const bare = plain.replace(/^<section[^>]*>/, "");
    expect(bare.startsWith("<p")).toBe(true);
    expect(plain.indexOf("job-context-chip")).toBeLessThan(plain.indexOf("Why is this a good fit for me?"));
    const withDivider = block({ withDivider: true });
    expect(withDivider.indexOf("job-seed-divider")).toBeLessThan(withDivider.indexOf("job-context-chip"));
  });
  it("tells a screen reader what the chip is, not just the two names", () => {
    expect(block()).toMatch(/Job Farah has[^<]*<\/span>/);
  });
});

describe("the divider that separates the new job from the older conversation", () => {
  it("reads 'Asking about: <job title>' and only appears when there is an older conversation above it", () => {
    expect(block({ withDivider: true })).toMatch(/data-testid="job-seed-divider"[\s\S]*?Asking about: Backend Engineer/);
    expect(block({ withDivider: false })).not.toContain("job-seed-divider");
  });
  it("no longer says 'Now looking at'", () => {
    expect(block({ withDivider: true })).not.toContain("Now looking at");
  });
});

describe("the options: labelled, directly under the chip, and reachable", () => {
  it("are a labelled group: the label is visible text, and the group points at it", () => {
    const html = block();
    const group = html.match(/<div[^>]*role="group"[^>]*aria-labelledby="([^"]+)"/);
    expect(group, "options are not a labelled group").not.toBeNull();
    const labelled = new RegExp(`id="${group![1]}"[^>]*>([^<]*)<`).exec(html);
    expect(labelled?.[1]).toBe("Choose what to do with this job");
  });
  it("come in this order: chip, label, the two chat questions, the two links; wording unchanged", () => {
    const html = block();
    const at = (s: string) => html.indexOf(s);
    const order = ["job-context-chip", "Choose what to do with this job", "Why is this a good fit for me?", "What resume tips do you have for this role?", "Tailor my resume for this job", "Draft an intro message for this job"].map(at);
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("all four are marked as options (so keyboard focus can find the first usable one) and the block itself can take focus as a fallback", () => {
    const html = block();
    expect(html.match(/data-job-option/g)).toHaveLength(4);
    expect(html).toMatch(/<section[^>]*tabindex="-1"/);
  });
  it("keeps the opener sentence the panel already used", () => {
    expect(block()).toContain("I can help with the Backend Engineer role at Flutterwave.");
  });
  it("under a divider the opener is left out (the divider, chip and label already say it, and it would push the options below the scroller's fold)", () => {
    expect(block({ withDivider: true })).not.toContain("I can help with the Backend Engineer role");
    expect(block({ withDivider: true })).toContain("Choose what to do with this job");
  });
  it("the chat questions are disabled while a reply is on its way; the two links stay usable", () => {
    const html = block({ pending: true });
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(html.match(/<a [^>]*href="\/tailor/g)).toHaveLength(2);
  });
});

describe("the pristine panel uses the same block", () => {
  it("shows the chip, the label and the options in place of the greeting, with no divider (there is nothing older above it)", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    expect(html).toContain('data-testid="job-context-chip"');
    expect(html).toContain("Choose what to do with this job");
    expect(html).not.toContain("job-seed-divider");
    expect(html).not.toContain("I can help you prep for an interview");
  });
  it("has a polite live region ready for the announcement", () => {
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" initialJobSeed={SEED} />);
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only">/);
  });
});
