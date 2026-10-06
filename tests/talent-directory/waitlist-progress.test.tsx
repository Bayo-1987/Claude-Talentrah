/**
 * The Talent Directory waitlist card shows how close the directory is to opening (C1), and says what the waitlist costs.
 *
 *   - Below the threshold, on both the "Join the waitlist" card and the "You're on the waitlist" card: "N of 10 candidates with a reviewed resume listed" as text AND as a
 *     progressbar (valuemin 0, valuemax 10, valuenow N), so a screen reader gets the same fact a sighted employer gets from the bar.
 *   - On the joined card the old closing sentence "Nothing to pay." is replaced by "Free while you wait. We'll tell you about pricing before anything is charged."
 *   - At or above the threshold there is no progress bar: the card states the live count and offers Subscribe.
 *
 * The literal wording below is pinned here on purpose (not imported from the source), so a change to either file's wording fails a test.
 * Real renderToStaticMarkup, same convention as preview-panel.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TalentDirectoryPreviewPanel } from "@/components/employer/talent-directory-preview-panel";
import { listedProgress } from "@/lib/talent-directory/preview";

const PLANS = [{ id: "plan-1", name: "Local Sourcing — Monthly", price_ngn: 200000 }];
const noop = async (): Promise<void> => {};

function render(count: number, joined: boolean): string {
  return renderToStaticMarkup(
    <TalentDirectoryPreviewPanel preview={{ count, samples: [] }} plans={PLANS} joinedWaitlist={joined} joinAction={noop} purchaseAction={noop} />,
  );
}

const FREE_NOTE = "Free while you wait. We&#x27;ll tell you about pricing before anything is charged.";
const attr = (html: string, name: string) => new RegExp(`role="progressbar"[^>]*? ${name}="([^"]*)"`).exec(html)?.[1];

describe("listedProgress", () => {
  it.each([
    [0, 0, 0],
    [1, 1, 10],
    [3, 3, 30],
    [9, 9, 90],
    [10, 10, 100],
  ])("%i listed: now %i, %i percent", (count, now, pct) => {
    const p = listedProgress(count);
    expect(p).toMatchObject({ now, max: 10, pct, text: `${now} of 10 candidates with a reviewed resume listed` });
  });

  it("never reports more than the maximum, less than zero, or a fraction", () => {
    expect(listedProgress(25)).toMatchObject({ now: 10, pct: 100, text: "10 of 10 candidates with a reviewed resume listed" });
    expect(listedProgress(-4)).toMatchObject({ now: 0, pct: 0 });
    expect(listedProgress(2.9)).toMatchObject({ now: 2 });
    expect(listedProgress(Number.NaN)).toMatchObject({ now: 0, pct: 0 });
  });
});

describe.each([
  ["not joined", false],
  ["joined", true],
] as const)("below the threshold, %s", (_label, joined) => {
  it.each([0, 1, 3, 9])("N = %i: the text 'N of 10 candidates with a reviewed resume listed' is on the card", (n) => {
    expect(render(n, joined)).toContain(`${n} of 10 candidates with a reviewed resume listed`);
  });

  it.each([0, 1, 3, 9])("N = %i: a progressbar with min 0, max 10 and now N, named by that text", (n) => {
    const html = render(n, joined);
    expect((html.match(/role="progressbar"/g) ?? []).length).toBe(1);
    expect(attr(html, "aria-valuemin")).toBe("0");
    expect(attr(html, "aria-valuemax")).toBe("10");
    expect(attr(html, "aria-valuenow")).toBe(String(n));
    expect(attr(html, "aria-valuetext")).toBe(`${n} of 10 candidates with a reviewed resume listed`);
    const labelledBy = attr(html, "aria-labelledby");
    expect(labelledBy, "the bar has no accessible name").toBeTruthy();
    expect(html).toMatch(new RegExp(`id="${labelledBy}"[^>]*>${n} of 10 candidates with a reviewed resume listed<`));
  });

  it("the filled part is N tenths of the bar", () => {
    expect(render(3, joined)).toMatch(/data-testid="listed-progress-fill"[^>]*style="width:30%"/);
    expect(render(0, joined)).toMatch(/data-testid="listed-progress-fill"[^>]*style="width:0%"/);
    expect(render(9, joined)).toMatch(/data-testid="listed-progress-fill"[^>]*style="width:90%"/);
  });

  it("follows the editorial rules: no rounded corners, no shadow", () => {
    const html = render(3, joined);
    expect(html).not.toMatch(/rounded-(?!none)/);
    expect(html).not.toMatch(/shadow/);
  });
});

describe("at the threshold", () => {
  it.each([10, 12])("N = %i: no progress bar and no 'of 10' line, the live count and Subscribe instead", (n) => {
    const html = render(n, false);
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("of 10 candidates with a reviewed resume listed");
    expect(html).toContain("Subscribe");
  });
});

describe("what the joined card says about cost", () => {
  const html = render(3, true);

  it("replaces 'Nothing to pay.' with the free-while-you-wait sentence, once", () => {
    expect(html).not.toContain("Nothing to pay");
    expect(html.split(FREE_NOTE)).toHaveLength(2);
  });

  it("still tells the employer when they will hear from us, and offers no way to pay", () => {
    expect(html).toContain("We&#x27;ll tell you when 10+ are listed.");
    expect(html).not.toMatch(/Subscribe|Join the waitlist|<form|<button/i);
  });

  it("the not-joined card does not carry the sentence (it is a promise to someone who joined)", () => {
    expect(render(3, false)).not.toContain("Free while you wait");
  });
});
