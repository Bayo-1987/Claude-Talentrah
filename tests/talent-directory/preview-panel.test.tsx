/**
 * EMP-1 / E1 — what an employer with no subscription sees on /employer/talent-directory.
 *
 * Real renderToStaticMarkup passes, string assertions on the output (the same shape as tests/employer/wallet-topup.test.tsx), at 9 and
 * at 10 candidates: below the threshold there is NO Subscribe button and there is a waitlist; at it the normal Subscribe flow is back.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TalentDirectoryPreviewPanel } from "@/components/employer/talent-directory-preview-panel";
import type { PreviewSample } from "@/lib/talent-directory/preview";

const PLANS = [{ id: "plan-1", name: "Local Sourcing — Monthly", price_ngn: 200000 }];

async function noopJoin(): Promise<void> {}
async function noopPurchase(): Promise<void> {}

const SAMPLES: PreviewSample[] = [
  { role: "Engineering", yearsBand: "3-5", skills: ["react", "typescript"], availableForHire: true, remoteReady: true },
  { role: "Engineering", yearsBand: "6-9", skills: ["typescript", "sql"], availableForHire: false, remoteReady: true },
  { role: "Professional", yearsBand: null, skills: [], availableForHire: true, remoteReady: false },
];

function render(count: number, opts: { joined?: boolean; samples?: PreviewSample[] } = {}) {
  return renderToStaticMarkup(
    <TalentDirectoryPreviewPanel
      preview={{ count, samples: opts.samples ?? [] }}
      plans={PLANS}
      joinedWaitlist={opts.joined ?? false}
      joinAction={noopJoin}
      purchaseAction={noopPurchase}
    />,
  );
}

const BELOW_COPY = (n: number) =>
  `We&#x27;re building the directory: ${n} verified candidates so far. Join the waitlist and we&#x27;ll tell you when 10+ are listed.`;

describe("below the threshold (9 candidates)", () => {
  const html = render(9);

  it("shows the exact founder copy with N interpolated, as a single text node", () => {
    expect(html).toContain(BELOW_COPY(9));
  });

  it("has no Subscribe button, and no plan price offered for purchase", () => {
    expect(html).not.toMatch(/Subscribe/);
    expect(html).not.toContain("200,000");
    expect(html).not.toContain("Local Sourcing");
  });

  it("offers the waitlist, free", () => {
    expect(html).toContain("Join the waitlist");
  });

  it("never says anything about payment on the waitlist path", () => {
    expect(html).not.toMatch(/Paystack|charged|pay now/i);
  });
});

describe("at the threshold (10 candidates)", () => {
  const html = render(10);

  it("the normal Subscribe flow is back, with the real plan price read from the plan row", () => {
    expect(html).toContain("Subscribe — Local Sourcing — Monthly (₦200,000/mo)");
  });

  it("no waitlist, and none of the building-the-directory copy", () => {
    expect(html).not.toContain("Join the waitlist");
    expect(html).not.toContain("building the directory");
  });

  it("states the live count", () => {
    expect(html).toContain("10 verified candidates");
  });
});

describe("the waitlist state", () => {
  it("an org already on the waitlist sees a confirmation, not a second join button, and still no Subscribe", () => {
    const html = render(3, { joined: true });
    expect(html).toContain("You&#x27;re on the waitlist");
    expect(html).not.toContain("Join the waitlist");
    expect(html).not.toMatch(/Subscribe/);
  });
});

describe("the sample cards", () => {
  const html = render(12, { samples: SAMPLES });

  it("render each sample's role, experience band, skills and availability", () => {
    expect(html).toContain("Engineering");
    expect(html).toContain("3-5 years");
    expect(html).toContain("6-9 years");
    expect(html).toContain("react");
    expect(html).toContain("Available now");
    expect(html).toContain("Remote-ready");
  });

  it("have no photo, no avatar and no link into a candidate", () => {
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/\/employer\/talent-directory\//);
    expect(html).not.toMatch(/avatar|photo/i);
  });

  it("say they are anonymised, and use 'Resume' wording only", () => {
    expect(html).toMatch(/anonymised/i);
    expect(html).not.toMatch(/\bCV\b/);
  });

  it("render no samples section at all when there are none", () => {
    expect(render(2)).not.toMatch(/anonymised/i);
  });

  it("render no more cards than the sample cap, whatever it is handed", () => {
    const four = render(12, { samples: [...SAMPLES, SAMPLES[0]] });
    expect((four.match(/data-testid="preview-sample"/g) ?? []).length).toBeLessThanOrEqual(3);
  });
});

describe("the editorial rules", () => {
  it("no rounded corners and no shadow classes", () => {
    const html = render(12, { samples: SAMPLES });
    expect(html).not.toMatch(/rounded-(?!none)/);
    expect(html).not.toMatch(/shadow/);
  });
});
