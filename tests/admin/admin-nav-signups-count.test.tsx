import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Signups link in the admin nav carries one quiet number: how many people have an account (ADMIN-NAV-SIGNUPS-COUNT-1).
 *
 * N is the Signups page's own total (every account the page lists, QA and owner test accounts left out). E is the people among them who belong to an organisation, so a person who is both counts once, as an employer, and S = N - E.
 * The visible chip is N only; the link's accessible name and hover text read "Signups, N people: S job seekers, E employers". COUNT ONLY: no name, email or row, and no audit event (the page writes people.listed, the nav does not).
 *
 * The database half (that N really equals the page's total, that a person in two organisations counts once, that a QA member is left out) is tests/admin/signups-nav-counts.test.ts. This file stands in the two count functions and checks
 * what the nav does with them: what it shows, when it asks, and what happens when it cannot.
 */
const state = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  queueFails: false,
  people: 0,
  employers: 0,
  peopleFails: false,
  employersFails: false,
  peopleCalls: 0,
  employersCalls: 0,
  audit: 0,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/moderation/queues", () => ({
  queueCounts: async () => {
    if (state.queueFails) throw new Error("queue counts unavailable");
    return state.counts;
  },
}));
vi.mock("@/lib/admin/people/queries", () => ({
  countSignups: async () => {
    state.peopleCalls++;
    if (state.peopleFails) throw new Error("count failed");
    return state.people;
  },
  countSignupEmployers: async () => {
    state.employersCalls++;
    if (state.employersFails) throw new Error("count failed");
    return state.employers;
  },
}));
vi.mock("@/lib/admin/audit", () => ({
  recordAdminAction: async () => void state.audit++,
  recordAdminActionStrict: async () => void state.audit++,
  recordSystemAction: async () => void state.audit++,
  recordFailedAdminLogin: async () => void state.audit++,
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const { AdminNav } = await import("@/components/admin/admin-nav");

const ZERO = { scholarships: 0, reports: 0, campaigns: 0, feedback: 0, courses: 0, ops: 0, finance: 0, employerVerification: 0, jobReview: 0, mentorReview: 0 };
const QUIET_CLASS = "min-w-6 px-1.5 py-0.5 text-center font-body text-[12px] font-bold bg-transparent text-ink-soft";

async function render(permissions: string[]) {
  return renderToStaticMarkup(await AdminNav({ permissions: permissions as never }));
}

/** The Signups link as rendered: its attributes and everything inside it. */
function signupsLink(html: string) {
  const m = html.match(/<a ([^>]*href="\/admin\/people\/signups"[^>]*)>([\s\S]*?)<\/a>/);
  return m ? { attrs: m[1], inner: m[2] } : null;
}
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];

beforeEach(() => {
  state.counts = { ...ZERO };
  state.queueFails = false;
  state.people = 0;
  state.employers = 0;
  state.peopleFails = false;
  state.employersFails = false;
  state.peopleCalls = 0;
  state.employersCalls = 0;
  state.audit = 0;
});

describe("what the Signups link shows", () => {
  it("N is the visible number, with a thousands separator, and nothing else is visible beside the label", async () => {
    state.people = 1234;
    state.employers = 234;
    const link = signupsLink(await render(["people_list"]));
    expect(link, "no Signups link").not.toBeNull();
    expect(link!.inner).toBe(`Signups<span class="${QUIET_CLASS}">1,234</span>`);
  });

  it("its accessible name and its hover text both read 'Signups, N people: S job seekers, E employers'", async () => {
    state.people = 1234;
    state.employers = 234;
    const link = signupsLink(await render(["people_list"]))!;
    expect(attr(link.attrs, "aria-label")).toBe("Signups, 1,234 people: 1,000 job seekers, 234 employers");
    expect(attr(link.attrs, "title")).toBe("Signups, 1,234 people: 1,000 job seekers, 234 employers");
  });

  it("S + E = N for every pair, and a person who is both counts once (as an employer)", async () => {
    // [N, E, the exact sentence]: written out, so the singular forms ("1 employer") are pinned and a bare number is not enough to pass
    for (const [n, e, sentence] of [
      [3, 1, "Signups, 3 people: 2 job seekers, 1 employer"],
      [0, 0, "Signups, 0 people: 0 job seekers, 0 employers"],
      [7, 7, "Signups, 7 people: 0 job seekers, 7 employers"],
      [1000, 1, "Signups, 1,000 people: 999 job seekers, 1 employer"],
      [12345, 678, "Signups, 12,345 people: 11,667 job seekers, 678 employers"],
    ] as const) {
      state.people = n;
      state.employers = e;
      const label = attr(signupsLink(await render(["people_list"]))!.attrs, "aria-label")!;
      expect(label).toBe(sentence);
      const m = label.match(/^Signups, ([\d,]+) people: ([\d,]+) job seekers, ([\d,]+) employers?$/);
      expect(m, label).not.toBeNull();
      const [nn, ss, ee] = m!.slice(1).map((x) => Number(x.replace(/,/g, "")));
      expect(nn).toBe(n);
      expect(ee).toBe(e);
      expect(ss + ee).toBe(nn);
    }
  });

  it("is the QUIET look (the same class list as a zero count), never the dark alert pill, however large N is", async () => {
    state.people = 98765;
    state.employers = 4;
    const html = await render(["people_list"]);
    const chip = signupsLink(html)!.inner.match(/<span class="([^"]*)">/)![1];
    expect(chip).toBe(QUIET_CLASS);
    expect(chip).not.toContain("bg-ink");
  });

  it("an impossible pair (more employers than people) is not shown: the number would be wrong, so the nav renders without it", async () => {
    state.people = 3;
    state.employers = 5;
    const link = signupsLink(await render(["people_list"]))!;
    expect(link.attrs).not.toContain("aria-label");
    expect(link.inner).toBe("Signups");
  });
});

describe("when it asks, and what happens when it cannot", () => {
  it("fetches the counts only for a viewer who holds people_list, and not at all for anyone else", async () => {
    state.people = 5;
    state.employers = 1;
    const without = await render(["scholarships", "operations"]);
    expect(state.peopleCalls + state.employersCalls, "a viewer without people_list caused a count query").toBe(0);
    expect(signupsLink(without), "a viewer without people_list sees the Signups link").toBeNull();

    await render(["people_list"]);
    expect(state.peopleCalls).toBe(1);
    expect(state.employersCalls).toBe(1);
  });

  it("if either count fails, the nav still renders: the link has no number and no error, and every other count is unchanged", async () => {
    state.counts = { ...ZERO, scholarships: 4, ops: 2 };
    const perms = ["scholarships", "operations", "people_list"];
    state.people = 9;
    state.employers = 2;
    const good = await render(perms);

    for (const which of ["peopleFails", "employersFails"] as const) {
      state[which] = true;
      const html = await render(perms);
      state[which] = false;
      const link = signupsLink(html)!;
      expect(link.inner, `${which}: the link should have no number`).toBe("Signups");
      expect(link.attrs).not.toContain("aria-label");
      expect(html).not.toMatch(/error|could not|unavailable/i);
      // everything outside the Signups link is byte-for-byte the same as with a working count
      expect(html.replace(signupsLink(html)!.inner, "").replace(/<a [^>]*href="\/admin\/people\/signups"[^>]*>/, "")).toBe(
        good.replace(signupsLink(good)!.inner, "").replace(/<a [^>]*href="\/admin\/people\/signups"[^>]*>/, ""),
      );
    }
  });

  it("if the queue counts fail, the nav behaves as it always did (it throws), whatever the Signups count does", async () => {
    state.queueFails = true;
    await expect(AdminNav({ permissions: ["people_list"] as never })).rejects.toThrow("queue counts unavailable");
  });
});

describe("it is a count only", () => {
  it("renders no row data: no address, no table, no person, only the label and one number", async () => {
    state.people = 42;
    state.employers = 6;
    const html = await render(["people_list"]);
    expect(html).not.toMatch(/@/);
    expect(html).not.toMatch(/<table|<tr|<td/);
    expect(signupsLink(html)!.inner).toBe(`Signups<span class="${QUIET_CLASS}">42</span>`);
  });

  it("writes no audit event of any kind when it renders (people.listed belongs to the list page)", async () => {
    state.people = 42;
    state.employers = 6;
    await render(["people_list"]);
    expect(state.audit).toBe(0);
  });

  it("neither the nav nor the count functions import the audit module", () => {
    const nav = readFileSync(join(__dirname, "../../src/components/admin/admin-nav.tsx"), "utf8");
    expect(nav).not.toMatch(/admin\/audit|recordAdminAction|recordSystemAction/);
    const queries = readFileSync(join(__dirname, "../../src/lib/admin/people/queries.ts"), "utf8");
    expect(queries).not.toMatch(/admin\/audit|recordAdminAction|recordSystemAction/);
  });
});

describe("it is its own count, not part of queueCounts", () => {
  it("queueCounts() does not know about signups, and the nav asks for the Signups counts in its own guarded call", () => {
    const queues = readFileSync(join(__dirname, "../../src/lib/admin/moderation/queues.ts"), "utf8");
    expect(queues).not.toMatch(/countSignups|countSignupEmployers|signups/i);
    const nav = readFileSync(join(__dirname, "../../src/components/admin/admin-nav.tsx"), "utf8");
    // own try/catch around the two count functions
    expect(nav).toMatch(/try\s*\{[\s\S]*countSignups\(\)[\s\S]*countSignupEmployers\(\)[\s\S]*\}\s*catch/);
    // and the permission is checked before the call is made
    expect(nav).toMatch(/permissions\.includes\("people_list"\)/);
  });
});

describe("the Signups page's wording (copy only: the page lists everyone with an account)", () => {
  const page = readFileSync(join(__dirname, "../../src/app/admin/(protected)/people/signups/page.tsx"), "utf8");

  it("the eyebrow is 'Signups' and the blurb says everyone with an account", () => {
    expect(page).toContain('eyebrow="Signups"');
    expect(page).toContain('blurb="Newest first. Everyone with an account, job seekers and employers."');
  });

  it("the old wording, which said employers are not listed, is gone", () => {
    expect(page).not.toContain("Job seekers only");
    expect(page).not.toContain("employers live on the organisation side");
    expect(page).not.toContain('eyebrow="Job-seeker signups"');
  });
});
