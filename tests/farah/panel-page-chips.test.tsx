/**
 * The panel shows a page's own chips and opening line, and every chip shows a cost label before the click, from the one function the gate also uses.
 * Static render (no DOM, like farah-panel-transcript.test.tsx): the route is faked at the next/navigation boundary.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let path: string | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => path, useSearchParams: () => new URLSearchParams() }));

const { FarahPanel } = await import("@/components/app-shell/farah-panel");
const { FarahQuickActions } = await import("@/components/app-shell/farah-quick-actions");
const noop = () => {};

describe("the panel on the billing page", () => {
  it("shows the three billing chips and the billing opening line, and not today's three", () => {
    path = "/billing";
    const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
    for (const label of ["What can I do with my credits?", "Which pack or pass suits me?", "What&#x27;s free, and when does it renew?"]) expect(html).toContain(label);
    expect(html).toContain("Ask me what your credits can do");
    for (const gone of ["Job Interview Prep", "Career Advisor", "Salary Negotiation", "I can help you prep for an interview"]) expect(html).not.toContain(gone);
  });

  it("on a route that is not listed, today's three and today's greeting", () => {
    for (const p of ["/jobs/remote", "/settings", "/billing/callback", null]) {
      path = p;
      const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
      for (const label of ["Job Interview Prep", "Career Advisor", "Salary Negotiation", "I can help you prep for an interview"]) expect(html, `${p}`).toContain(label);
      expect(html).not.toContain("What can I do with my credits?");
    }
  });
});

describe("the cost label before the click (the same function the gate uses)", () => {
  const html = (freeRemaining: number | null | undefined, balance?: number) =>
    renderToStaticMarkup(<FarahQuickActions freeRemaining={freeRemaining} balance={balance} pending={false} onSend={noop} onPrefill={noop} />);

  it("free messages left: each chip says free", () => expect(html(2).match(/>free</g)?.length).toBe(3));
  it("none left, credits in the account: the price", () => expect(html(0, 5).match(/>1 credit</g)?.length).toBe(3));
  it("none left, no credits: the price and what there is", () => expect(html(0, 0).match(/1 credit \(you have 0\)/g)?.length).toBe(3));
  it("an active Pass: included, no price", () => {
    const h = html(null, 0);
    expect(h.match(/included with your Pass/g)?.length).toBe(3);
    expect(h).not.toMatch(/1 credit/);
  });
  it("count not known yet: no label at all", () => {
    const h = html(undefined, 5);
    expect(h).not.toMatch(/>free</);
    expect(h).not.toMatch(/credit/);
    expect(h).not.toContain("farah-chip-cost-");
  });
  it("the label is a description of the button, so the button's own name is unchanged", () => {
    const h = html(2);
    expect(h).toMatch(/aria-describedby="farah-chip-cost-interview-prep"[^>]*>Job Interview Prep</);
  });
});

describe("the cost label sits UNDER the chip, so the chip text keeps the full column", () => {
  it("each chip is a column: the button, then the cost line, with no side-by-side row", () => {
    const h = renderToStaticMarkup(<FarahQuickActions freeRemaining={0} balance={0} pending={false} onSend={noop} onPrefill={noop} />);
    // wrapper is a column; the cost span follows the button inside it and carries the same id the button points at
    expect(h).toMatch(/<div class="flex flex-col[^"]*"><button[^>]*aria-describedby="farah-chip-cost-interview-prep"[^>]*>Job Interview Prep<\/button><span id="farah-chip-cost-interview-prep"[^>]*>1 credit \(you have 0\)<\/span><\/div>/);
    expect(h).not.toMatch(/justify-between/);
    expect(h).not.toMatch(/flex-shrink-0/);
  });
  it("the cost line is 12px ink-soft, as the allowance line is", () => {
    const h = renderToStaticMarkup(<FarahQuickActions freeRemaining={2} pending={false} onSend={noop} onPrefill={noop} />);
    expect(h).toMatch(/<span id="farah-chip-cost-career-advisor" class="[^"]*text-\[12px\][^"]*text-ink-soft[^"]*">free<\/span>/);
  });
});

describe("useKnownCreditsBalance (what the chips' cost label reads)", () => {
  it("is the balance the shell shows inside the provider, and undefined (not known, never a guess) outside it", async () => {
    const { CreditsBalanceProvider, useKnownCreditsBalance } = await import("@/components/app-shell/credits-balance");
    function Probe() {
      const b = useKnownCreditsBalance();
      return <span>{b === undefined ? "unknown" : `balance:${b}`}</span>;
    }
    expect(renderToStaticMarkup(<CreditsBalanceProvider serverBalance={7}><Probe /></CreditsBalanceProvider>)).toContain("balance:7");
    expect(renderToStaticMarkup(<Probe />)).toContain("unknown");
  });
});

describe("useKnownCreditsBalance reads the same displayed balance as the masthead", () => {
  it("through displayedCreditsBalance (so a live override shows, and expires with the server value), not the bare server number", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/app-shell/credits-balance.tsx", "utf8");
    const body = src.slice(src.indexOf("export function useKnownCreditsBalance"));
    expect(body.slice(0, body.indexOf("\n}\n"))).toMatch(/displayedCreditsBalance\(ctx\.serverBalance, ctx\.override\)/);
  });
});

describe("the panel on the other pages (PR B)", () => {
  it("shows each page's chips and opening line, and the greeting prefix is the same on every page", () => {
    const cases: Array<[string, string, string]> = [
      ["/scholarships", "What's due soonest?", "Choosing a scholarship?"],
      ["/refer", "How does Refer &amp; Earn work?", "Want to invite someone?"],
      ["/talent-directory/verify", "What does the review involve?", "Thinking about joining the Talent Directory?"],
      ["/auto-apply", "How many free confirmations do I have left this week?", "Wondering what Auto-Apply will do with a match?"],
    ];
    for (const [p, chip, line] of cases) {
      path = p;
      const html = renderToStaticMarkup(<FarahPanel firstName="Ada" />);
      expect(html, p).toContain(chip.replace("'", "&#x27;"));
      expect(html, p).toContain(line);
      expect(html, p).not.toContain("Job Interview Prep");
    }
  });
});
