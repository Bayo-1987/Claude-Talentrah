/**
 * send-493 (PR B) — every control that spends credits says what it costs, at the control, before the click.
 *
 * THE LIST. `SPENDERS` is the audit list: one entry per key in `CREDIT_COSTS`, with the real component that
 * spends it rendered in the state where it WILL charge. Three things fail this file:
 *   1. a new key in CREDIT_COSTS with no entry here (a new spender nobody gave a price label);
 *   2. an entry whose rendered control does not contain its price;
 *   3. an entry whose price is a typed-in number rather than the one in CREDIT_COSTS — the second render in
 *      this file swaps the whole price list for numbers no real price uses, and each control has to follow.
 *
 * Pass-covered and free states are asserted too: a covered account must never be shown a credit price for an
 * action its Pass already covers (tests/billing/pass-aware-ui.test.tsx pins that for the pill).
 *
 * WHAT THIS FILE CANNOT SEE. vitest here is plain Node (no DOM), so it renders initial markup only. Behaviour
 * after a click (the confirm step, Keep/Discard, prefill vs send, the live-region text, the leave-page guard,
 * the 44px hit target) is covered per spender in e2e/credit-prices.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { loadModule } from "../support/load-module";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/",
}));
vi.mock("@/lib/resume-builder/actions", () => ({
  unlockTemplateAction: async () => ({ ok: true }),
  rewriteBulletAction: async () => ({ text: "" }),
  saveResumeAction: async () => undefined,
}));
vi.mock("@/lib/scholarships/actions", () => ({
  runEligibilityCheckAction: async () => ({}),
  draftSopAction: async () => ({}),
}));
vi.mock("@/lib/talent-directory/actions", () => ({
  requestTalentVerificationAction: async () => ({}),
  requestHumanReviewVerificationAction: async () => ({ status: "idle", message: null }),
  requestTalentDirectoryBoostAction: async () => ({}),
}));
vi.mock("@/lib/auto-apply/actions", () => ({
  confirmAutoApplyAction: async () => ({}),
  dismissAutoApplyAction: async () => ({}),
}));
vi.mock("@/components/resume-builder/template-thumbnail", () => ({ TemplateThumbnail: () => null }));

type CostKey = keyof typeof CREDIT_COSTS;
type Cost = (key: CostKey) => number;

function text(el: ReactElement): string {
  return renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/**
 * Props go through a loose helper because several of these props do not exist on the components until the
 * implementation commit; a typed `<TailorForm pricing={...} />` would stop `tsc` (which runs before the unit
 * tests) and turn "the behaviour is missing" into "does not compile".
 */
const make = (component: unknown, props: Record<string, unknown>): ReactElement =>
  createElement(component as never, props as never);

const plural = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

interface Spender {
  /** Which CREDIT_COSTS key(s) this entry proves a price label for. */
  keys: CostKey[];
  surface: string;
  /** Renders the real control in a state where using it charges, and returns the visible text. */
  render: () => Promise<string>;
  /** What that text must contain, computed from the SAME price list the render read. */
  expects: (cost: Cost) => string[];
}

const SPENDERS: Spender[] = [
  {
    keys: ["tailoringRun"],
    surface: "Tailor my resume button (/tailor), free run used up",
    render: async () => {
      const { TailorForm } = await import("@/components/tailoring/tailor-form");
      return text(
        make(TailorForm, {
          initialJdText: "",
          pricing: { tailoringFree: false, coverLetterFree: false, passCovered: false, balance: 1000 },
        }),
      );
    },
    expects: (c) => [`Tailor my resume · ${plural(c("tailoringRun"))} (you have 1000)`],
  },
  {
    keys: ["tailoringRun", "coverLetterRun"],
    surface: "Tailor my resume button with the cover letter ticked (both charged)",
    render: async () => {
      const { TailorForm } = await import("@/components/tailoring/tailor-form");
      return text(
        make(TailorForm, {
          initialJdText: "",
          defaultCoverLetter: true,
          pricing: { tailoringFree: false, coverLetterFree: false, passCovered: false, balance: 1000 },
        }),
      );
    },
    expects: (c) => [
      `Tailor my resume · ${plural(c("tailoringRun") + c("coverLetterRun"))} (you have 1000)`,
      // The cover-letter checkbox carries its own price, so the second charge is visible BEFORE it is ticked.
      `Also write a cover letter · ${plural(c("coverLetterRun"))}`,
    ],
  },
  {
    keys: ["bulletRewrite"],
    surface: "Farah bullet-rewrite controls in the resume editor",
    render: async () => {
      const { RewriteButtons } = await loadModule<{
        RewriteButtons: (p: { onRewrite: (i: never) => void; passCovered?: boolean }) => ReactElement;
      }>("@/components/resume-builder/resume-editor");
      return text(<RewriteButtons onRewrite={() => {}} />);
    },
    expects: (c) => [
      `More impact-driven · ${plural(c("bulletRewrite"))}`,
      `Quantify this · ${plural(c("bulletRewrite"))}`,
      `More concise · ${plural(c("bulletRewrite"))}`,
    ],
  },
  {
    keys: ["farahChatMessage"],
    surface: "Farah chat: what a further message costs once the free ones are used",
    render: async () => {
      const { FarahAllowanceNote } = await loadModule<{
        FarahAllowanceNote: (p: { freeRemaining: number | null }) => ReactElement | null;
      }>("@/components/app-shell/farah-quick-actions");
      const el = FarahAllowanceNote({ freeRemaining: 0 });
      return el ? text(el) : "";
    },
    expects: (c) => [plural(c("farahChatMessage"))],
  },
  {
    keys: ["autoApplySubmission"],
    surface: "Auto-Apply queue: Confirm button once the free weekly allowance is used",
    render: async () => {
      const { AutoApplyQueueItem } = await import("@/components/jobs/auto-apply-queue-item");
      // The page passes the price down; the test reads it from the price list in force for THIS render
      // (the swapped one in the "follows a changed price list" cases), as the page does.
      const { CREDIT_COSTS: costs } = await import("@/lib/credits/costs");
      return text(
        make(AutoApplyQueueItem, {
          item: {
            id: "q1",
            jobTitle: "Role",
            companyName: "Co",
            location: null,
            matchScore: 90,
            sourceType: "internal",
            explanation: null,
          },
          confirmCostCredits: costs.autoApplySubmission,
        }),
      );
    },
    expects: (c) => [`Confirm and apply · ${plural(c("autoApplySubmission"))}`],
  },
  {
    keys: ["scholarshipEligibilityCheck", "scholarshipSopDraft"],
    surface: "Scholarship actions (already priced — kept in the list so it cannot regress)",
    render: async () => {
      const { FarahActions } = await import("@/components/scholarships/farah-actions");
      return text(<FarahActions scholarshipId="s1" creditsBalance={50} passCovered={false} />);
    },
    expects: (c) => [
      `Check my eligibility · ${plural(c("scholarshipEligibilityCheck"))}`,
      `Draft my personal statement · ${plural(c("scholarshipSopDraft"))}`,
    ],
  },
  {
    keys: ["templateUnlock"],
    surface: "Template gallery: Unlock button (already priced — kept so it cannot regress)",
    render: async () => {
      const { TemplateCard } = await import("@/components/resume-builder/template-card");
      // The card prints the template row's own unlock_cost_credits (a database column); the row carries the
      // price list in force for this render, exactly as a seeded row carries the real one.
      const { CREDIT_COSTS: costs } = await import("@/lib/credits/costs");
      const template = {
        id: "t1",
        slug: "x",
        name: "Sample",
        industry_category: "General",
        ats_safe: true,
        is_premium: true,
        unlock_cost_credits: costs.templateUnlock,
      } as never;
      return text(<TemplateCard template={template} isUnlocked={false} />);
    },
    expects: (c) => [`Unlock for ${plural(c("templateUnlock"))}`],
  },
  {
    keys: ["talentDirectoryVerification"],
    surface: "Talent Directory: Request verification button",
    render: async () => {
      const { VerificationPanel } = await import("@/app/(app)/talent-directory/verify/verification-panel");
      return text(<VerificationPanel status="none" />);
    },
    expects: (c) => [`Request verification · ${plural(c("talentDirectoryVerification"))}`],
  },
  {
    keys: ["talentDirectoryHumanReview"],
    surface: "Talent Directory: Request human review button",
    render: async () => {
      const { HumanReviewForm } = await import("@/app/(app)/talent-directory/verify/human-review-form");
      return text(<HumanReviewForm />);
    },
    expects: (c) => [`Request human review · ${plural(c("talentDirectoryHumanReview"))}`],
  },
  {
    keys: ["talentDirectoryBoost"],
    surface: "Talent Directory: Boost my placement button",
    render: async () => {
      const { BoostPanel } = await import("@/app/(app)/talent-directory/verify/boost-panel");
      return text(<BoostPanel boostedUntil={null} />);
    },
    expects: (c) => [`Boost my placement · ${plural(c("talentDirectoryBoost"))}`],
  },
];

afterEach(() => {
  vi.doUnmock("@/lib/credits/costs");
  vi.resetModules();
});

describe("the audit list is complete", () => {
  it("has an entry for every key in CREDIT_COSTS — a new spender cannot ship without a price label", () => {
    const covered = new Set(SPENDERS.flatMap((s) => s.keys));
    const missing = (Object.keys(CREDIT_COSTS) as CostKey[]).filter((k) => !covered.has(k));
    expect(missing, `CREDIT_COSTS keys with no audited control: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("every spender renders its price, taken from CREDIT_COSTS", () => {
  for (const spender of SPENDERS) {
    it(spender.surface, async () => {
      const html = await spender.render();
      for (const needle of spender.expects((k) => CREDIT_COSTS[k])) {
        expect(html, `expected "${needle}" on: ${spender.surface}`).toContain(needle);
      }
    });
  }
});

describe("no price is typed into a component", () => {
  // Numbers that are not any real price: a label that still reads a real one is hard-coded or reads the wrong key.
  const SWAPPED: Record<CostKey, number> = {
    tailoringRun: 777,
    coverLetterRun: 333,
    bulletRewrite: 55,
    farahChatMessage: 9,
    autoApplySubmission: 41,
    scholarshipEligibilityCheck: 42,
    scholarshipSopDraft: 43,
    templateUnlock: 44,
    talentDirectoryVerification: 45,
    talentDirectoryHumanReview: 46,
    talentDirectoryBoost: 47,
  };

  for (const spender of SPENDERS) {
    it(`${spender.surface} follows a changed price list`, async () => {
      vi.resetModules();
      vi.doMock("@/lib/credits/costs", () => ({ CREDIT_COSTS: SWAPPED }));
      const html = await spender.render();
      for (const needle of spender.expects((k) => SWAPPED[k])) {
        expect(html, `expected "${needle}" after swapping the price list: ${spender.surface}`).toContain(needle);
      }
    });
  }

  it("the component sources contain no literal 'N credits' outside comments", () => {
    const files = [
      "src/components/tailoring/tailor-form.tsx",
      "src/components/resume-builder/resume-editor.tsx",
      "src/components/app-shell/farah-quick-actions.tsx",
      "src/components/jobs/auto-apply-queue-item.tsx",
      "src/components/scholarships/farah-actions.tsx",
      "src/app/(app)/talent-directory/verify/verification-panel.tsx",
      "src/app/(app)/talent-directory/verify/human-review-form.tsx",
      "src/app/(app)/talent-directory/verify/boost-panel.tsx",
    ];
    for (const f of files) {
      const code = readFileSync(path.join(process.cwd(), f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} types a price into the markup`).not.toMatch(/\b\d+\s+credits?\b/);
    }
  });
});

describe("a covered or free action never shows a credit price", () => {
  it("a Pass-covered tailoring run says it is included, with no credit number", async () => {
    const { TailorForm } = await import("@/components/tailoring/tailor-form");
    const html = text(
      make(TailorForm, {
        initialJdText: "",
        pricing: { tailoringFree: false, coverLetterFree: false, passCovered: true, balance: 0 },
      }),
    );
    expect(html).toContain("Tailor my resume · included with your Pass");
    expect(html).not.toMatch(/\d+ credits/);
  });

  it("the free run is labelled free, and once it is used the 'first run free' copy is gone from the page copy", async () => {
    const { TailorForm } = await import("@/components/tailoring/tailor-form");
    const free = text(
      make(TailorForm, {
        initialJdText: "",
        pricing: { tailoringFree: true, coverLetterFree: true, passCovered: false, balance: 40 },
      }),
    );
    expect(free).toMatch(/Tailor my resume · free/);

    const { tailoringIntro } = await loadModule<{
      tailoringIntro(p: { tailoringFree: boolean; coverLetterFree: boolean; passCovered: boolean }): string;
    }>("@/lib/credits/price-labels");
    expect(tailoringIntro({ tailoringFree: true, coverLetterFree: true, passCovered: false })).toMatch(/free/i);
    const used = tailoringIntro({ tailoringFree: false, coverLetterFree: false, passCovered: false });
    expect(used).not.toMatch(/first (tailoring )?run/i);
    expect(used).not.toMatch(/\bfree\b/i);
  });

  it("a Pass holder sees 'included' on the rewrite controls, not a credit price", async () => {
    const { RewriteButtons } = await loadModule<{
      RewriteButtons: (p: { onRewrite: (i: never) => void; passCovered?: boolean }) => ReactElement;
    }>("@/components/resume-builder/resume-editor");
    const html = text(<RewriteButtons onRewrite={() => {}} passCovered />);
    expect(html).toContain("More concise · included with your Pass");
    expect(html).not.toMatch(/\d+ credits/);
  });
});

describe("Farah quick actions", () => {
  type QA = (p: {
    freeRemaining: number | null;
    pending: boolean;
    onSend: (key: string) => void;
    onPrefill: (key: string) => void;
  }) => ReactElement;

  it("renders the three quick actions as buttons", async () => {
    const { FarahQuickActions } = await loadModule<{ FarahQuickActions: QA }>(
      "@/components/app-shell/farah-quick-actions",
    );
    const html = text(<FarahQuickActions freeRemaining={3} pending={false} onSend={() => {}} onPrefill={() => {}} />);
    for (const label of ["Job Interview Prep", "Career Advisor", "Salary Negotiation"]) expect(html).toContain(label);
  });

  it("chips are disabled while the free-message count is still loading, so an early click cannot send a paid message", async () => {
    const { FarahQuickActions } = await loadModule<{
      FarahQuickActions: (p: Record<string, unknown>) => ReactElement;
    }>("@/components/app-shell/farah-quick-actions");
    const loading = renderToStaticMarkup(
      make(FarahQuickActions, {
        freeRemaining: undefined,
        allowanceLoading: true,
        pending: false,
        onSend: () => {},
        onPrefill: () => {},
      }),
    );
    expect(loading.match(/<button[^>]*\sdisabled(=|\s|>)/g)?.length, "all three chips are disabled while loading").toBe(3);
    const ready = renderToStaticMarkup(
      make(FarahQuickActions, {
        freeRemaining: 3,
        allowanceLoading: false,
        pending: false,
        onSend: () => {},
        onPrefill: () => {},
      }),
    );
    expect(ready).not.toMatch(/<button[^>]*\sdisabled(=|\s|>)/);
  });

  it("each chip is at least 44px tall (the hit-target rule)", async () => {
    const { FarahQuickActions } = await loadModule<{ FarahQuickActions: QA }>(
      "@/components/app-shell/farah-quick-actions",
    );
    const markup = renderToStaticMarkup(
      <FarahQuickActions freeRemaining={3} pending={false} onSend={() => {}} onPrefill={() => {}} />,
    );
    expect(markup).toMatch(/min-h-11/);
  });
});
