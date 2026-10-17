/**
 * TAILORING-NOTICE-UI-1. /api/tailoring answers 200 with a `notice` string when the tailored resume saved but the cover letter did not
 * and the cover-letter charge was given back (#951). The form has to say so: before this it kept the whole response in state and rendered
 * a normal success screen with no letter and no explanation, so a person whose credits were returned (or whose give-back failed and who
 * must contact support) was told nothing.
 *
 * HOW THIS RENDERS A POST-FETCH SCREEN WITHOUT A DOM. The success screen is client state set after a fetch, and this repo has no jsdom or
 * testing-library (the neighbouring component tests use react-dom/server). So the real <TailorForm> is rendered statically with its
 * `useState` seeded: the SECOND `useState(null)` of a render is the `data` slot (the first is `error`; see the top of the component).
 * That is order-coupled on purpose and fails loudly rather than quietly: if the slots move, the form renders its input screen, the
 * success text below is missing, and every test here goes red. The real fetch wiring (`setData(json)`) is covered end to end in
 * e2e/tailoring-notice.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let nullStateCalls = 0;
let seededData: unknown = null;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (initial === null) {
        nullStateCalls += 1;
        if (nullStateCalls === 2 && seededData !== null) return actual.useState(seededData);
      }
      return actual.useState(initial as never);
    },
  };
});

const { TailorForm } = await import("@/components/tailoring/tailor-form");
const { EMPTY_RESUME } = await import("@/lib/resume/types");

const NOTICE = "Your tailored resume saved, but the cover letter didn't. Your 5 credits were returned.";
const FAILED_GIVE_BACK =
  "Your tailored resume saved, but the cover letter didn't. We couldn't give your credits back automatically. " +
  "Please contact support and quote this time: 2026-10-17T09:30:00.000Z.";

function apiResult(extra: Record<string, unknown> = {}) {
  return {
    resumeId: "00000000-0000-0000-0000-000000000001",
    coverLetterResumeId: null,
    isFreeTrial: false,
    isPassCovered: false,
    creditsSpent: 20,
    creditsBalance: 30,
    courseRecommendations: [],
    result: {
      structuredJd: { title: "Data Analyst", company: null, skills: [], requirements: [] },
      gapAnalysis: [{ keyword: "SQL", status: "missing", note: "appears 6x in this JD" }],
      tailoredResume: { ...EMPTY_RESUME, contact: { name: "Demo User" } },
      coverLetter: null,
      atsScore: 72,
      atsFixes: ["Add SQL to your skills section"],
      jdTruncation: null,
    },
    ...extra,
  };
}

function render(data: unknown): string {
  nullStateCalls = 0;
  seededData = data;
  const html = renderToStaticMarkup(
    createElement(TailorForm as never, {
      initialJdText: "",
      pricing: { tailoringFree: false, coverLetterFree: false, passCovered: false, balance: 50 },
    } as never) as ReactElement,
  );
  seededData = null;
  return html;
}

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

/** Every element carrying role="status", as {open tag, decoded text}. */
function statusElements(html: string) {
  return [...html.matchAll(/<(\w+)([^>]*\brole="status"[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    attrs: m[2],
    text: decode(m[3]),
    raw: m[0],
  }));
}

beforeEach(() => {
  nullStateCalls = 0;
  seededData = null;
});

describe("the success screen shows the server's notice", () => {
  it("renders the notice, exactly as sent, inside its own role=status element", () => {
    const html = render(apiResult({ notice: NOTICE }));
    expect(decode(html)).toContain("Tailored"); // guard: this IS the success screen, not the input form
    const mine = statusElements(html).filter((el) => el.text === NOTICE);
    expect(mine).toHaveLength(1);
    expect(mine[0].attrs).toContain("text-rust");
  });

  it("puts it above the results, after the charge line, not below the fold", () => {
    const html = render(apiResult({ notice: NOTICE }));
    const at = (needle: string) => html.indexOf(needle);
    expect(at("Tailored")).toBeGreaterThan(-1);
    expect(at("didn&#x27;t")).toBeGreaterThan(at("Tailored"));
    expect(at("didn&#x27;t")).toBeLessThan(at("ATS score"));
  });

  it("has no control that could dismiss it", () => {
    const html = render(apiResult({ notice: NOTICE }));
    const mine = statusElements(html).filter((el) => el.text === NOTICE)[0];
    expect(mine, "the notice is not on screen").toBeDefined();
    expect(mine.raw).not.toMatch(/<(button|a)\b/);
    expect(mine.attrs).not.toMatch(/onclick|tabindex/i);
  });

  it("renders the failed-give-back wording unchanged, timestamp and all", () => {
    const html = render(apiResult({ notice: FAILED_GIVE_BACK }));
    const mine = statusElements(html).filter((el) => el.text === FAILED_GIVE_BACK);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain("Please contact support and quote this time: 2026-10-17T09:30:00.000Z.");
  });
});

describe("without a notice nothing is added", () => {
  it("a 200 with no notice renders only the existing charge line as a status element", () => {
    const html = render(apiResult());
    const els = statusElements(html);
    // The charge announcement ("Tailored — 20 credits used") was already a role=status before this change; the point is that no SECOND one appears.
    expect(els).toHaveLength(1);
    expect(els[0].text).toMatch(/^Tailored/);
    expect(els[0].text).not.toContain("cover letter");
  });

  it("an empty-string notice does not render an empty box", () => {
    expect(statusElements(render(apiResult({ notice: "" })))).toHaveLength(1);
  });

  it("the rest of the screen is byte-for-byte the same with and without a notice", () => {
    const without = render(apiResult());
    const withNotice = render(apiResult({ notice: NOTICE }));
    const shown = statusElements(withNotice).filter((el) => el.text === NOTICE)[0];
    expect(shown, "the notice is not on screen").toBeDefined();
    const stripped = withNotice.replace(shown.raw, "");
    expect(stripped).toBe(without);
  });
});
