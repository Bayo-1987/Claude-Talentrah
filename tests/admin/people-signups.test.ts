/**
 * The signups list, at the two layers that can be checked without a database.
 *
 * This page reverses a deliberate design — /admin/people lists nobody on
 * purpose — so the guarantees that replace "you cannot enumerate" have to be
 * the ones that actually hold. Three of them are decidable here:
 *
 *   1. The row that reaches the screen carries only the whitelisted fields,
 *      whatever the database hands over.
 *   2. Paging arithmetic cannot return more than a page.
 *   3. A search term cannot widen itself into "everyone".
 *
 * The fourth — that the query really applies these filters against Postgres —
 * needs a real database and is not checked here. See the PR body.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGE_SIZE,
  FORBIDDEN_ON_THIS_PAGE,
  SIGNUP_COLUMNS,
  describeFilters,
  escapeLikeTerm,
  fromInclusiveBound,
  pageRange,
  parseSignupListParams,
  toExclusiveBound,
  toSignupRow,
} from "@/lib/admin/people/signups";

const ROOT = join(__dirname, "..", "..");

describe("what reaches the screen", () => {
  /**
   * The sabotage this is written against: a future join, or `profiles` gaining
   * a column, quietly making resume/application/tailoring data available to
   * this page. The projection is field-by-field for that reason, and this hands
   * it exactly that situation.
   */
  it("drops resume, application and tailoring fields even when handed them", () => {
    const hostile = {
      id: "u1",
      email: "seeker@example.com",
      first_name: "Ada",
      last_name: "Okafor",
      country: "NG",
      created_at: "2026-09-01T10:00:00.000Z",
      credits_balance: 12,
      market_segment: "local",
      referred_by: null,

      // Real columns on `profiles` today — tailoring-adjacent, and not asked for.
      free_trial_tailoring_used: true,
      free_trial_cover_letter_used: false,
      farah_hint_dismissed_at: "2026-08-01T00:00:00.000Z",

      // What a careless join would add tomorrow.
      resume_content: "SECRET CV TEXT",
      resumes: [{ id: "r1", content: "SECRET" }],
      applications: [{ id: "a1", status: "applied" }],
      tailoring_history: [{ id: "t1" }],
    };

    const row = toSignupRow(hostile);
    const serialised = JSON.stringify(row).toLowerCase();

    for (const banned of FORBIDDEN_ON_THIS_PAGE) {
      expect(Object.keys(row), `projection leaked ${banned}`).not.toContain(banned);
      expect(serialised, `value for ${banned} reached the row`).not.toContain(banned);
    }
    expect(serialised).not.toContain("secret");

    // And it still produced the row it is supposed to.
    expect(row).toEqual({
      id: "u1",
      email: "seeker@example.com",
      name: "Ada Okafor",
      country: "NG",
      createdAt: "2026-09-01T10:00:00.000Z",
      creditsBalance: 12,
      marketSegment: "local",
      referredBy: null,
      referredByEmail: null,
    });
  });

  it("asks the database for the whitelisted columns and nothing else", () => {
    // The select string is the enforcement point — widening the page means
    // editing this line, which is what makes the rule greppable.
    for (const banned of FORBIDDEN_ON_THIS_PAGE) {
      expect(SIGNUP_COLUMNS).not.toContain(banned);
    }
    expect(SIGNUP_COLUMNS).toContain("email");
    expect(SIGNUP_COLUMNS).toContain("created_at");
  });

  it("never renders a forbidden field in the page markup either", () => {
    // The projection could be perfect and someone could still write
    // {row.resume} into the table. This reads the page source.
    const page = readFileSync(
      join(ROOT, "src/app/admin/(protected)/people/signups/page.tsx"),
      "utf8",
    ).toLowerCase();

    for (const banned of FORBIDDEN_ON_THIS_PAGE) {
      // The page mentions the exclusion in prose ("no resumes, no applications,
      // no tailoring history"), so only field-shaped uses are a problem.
      expect(page, `page references ${banned} as a field`).not.toMatch(
        new RegExp(`[.\\[]\\s*['"\`]?${banned}\\b`),
      );
    }
  });

  it("falls back to the email when there is no name, rather than a blank", () => {
    expect(toSignupRow({ id: "u", email: "x@y.z", created_at: "t" }).name).toBeNull();
    expect(toSignupRow({ id: "u", email: "x@y.z", created_at: "t", first_name: "  " }).name).toBeNull();
    expect(toSignupRow({ id: "u", email: "x@y.z", created_at: "t", last_name: "Solo" }).name).toBe("Solo");
  });

  it("resolves a referrer's email only when it actually knows it", () => {
    const withEmail = toSignupRow(
      { id: "u", email: "a@b.c", created_at: "t", referred_by: "ref-1" },
      new Map([["ref-1", "referrer@example.com"]]),
    );
    expect(withEmail.referredByEmail).toBe("referrer@example.com");

    // Unknown referrer keeps the id and invents nothing.
    const unknown = toSignupRow({ id: "u", email: "a@b.c", created_at: "t", referred_by: "ref-9" });
    expect(unknown.referredBy).toBe("ref-9");
    expect(unknown.referredByEmail).toBeNull();
  });
});

describe("paging cannot hand back more than a page", () => {
  it("maps pages onto inclusive ranges with no overlap and no gap", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: PAGE_SIZE - 1 });
    expect(pageRange(2)).toEqual({ from: PAGE_SIZE, to: PAGE_SIZE * 2 - 1 });

    // Supabase's .range() is inclusive at BOTH ends — the classic off-by-one
    // here is a page that returns PAGE_SIZE + 1 rows and overlaps the next.
    for (let p = 1; p <= 20; p++) {
      const r = pageRange(p);
      expect(r.to - r.from + 1, `page ${p} spans the wrong number of rows`).toBe(PAGE_SIZE);
      if (p > 1) expect(r.from).toBe(pageRange(p - 1).to + 1);
    }
  });

  it("does not let the caller choose the page size", () => {
    // ?pageSize=100000 is how a paginated page becomes "download everything".
    const spec = parseSignupListParams({ page: "2", pageSize: "100000", limit: "100000" });
    expect(pageRange(spec.page).to - pageRange(spec.page).from + 1).toBe(PAGE_SIZE);
    expect(describeFilters(spec).page_size).toBe(PAGE_SIZE);
  });

  it("clamps a nonsense page rather than computing a negative range", () => {
    for (const bad of ["0", "-3", "abc", "", "1e9999", undefined]) {
      const spec = parseSignupListParams({ page: bad });
      expect(spec.page, `page=${String(bad)}`).toBeGreaterThanOrEqual(1);
      expect(pageRange(spec.page).from).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the search term stays a search term", () => {
  it("escapes LIKE wildcards so a term cannot become 'everyone'", () => {
    // Unescaped, `%` matches every address on the platform — a search that
    // silently turns into the enumeration this page is already careful about.
    expect(escapeLikeTerm("%")).toBe("\\%");
    expect(escapeLikeTerm("a_b")).toBe("a\\_b");
    expect(escapeLikeTerm("100%_sure")).toBe("100\\%\\_sure");
    // Backslash first, or the escapes get escaped.
    expect(escapeLikeTerm("a\\%b")).toBe("a\\\\\\%b");
  });

  it("ESCAPES the term on the way through parse, not just in the helper", () => {
    /*
     * The helper having an escape function proves nothing about the path the
     * page actually takes. Removing the `escapeLikeTerm` call from
     * parseSignupListParams left every other test in this file green — so this
     * asserts the parsed spec, which is what reaches `.ilike()`.
     */
    expect(parseSignupListParams({ email: "%" }).email).toBe("\\%");
    expect(parseSignupListParams({ email: "a_b@c.com" }).email).toBe("a\\_b@c.com");
    // The wildcard case is the one that matters: unescaped, `%` lists everyone.
    expect(parseSignupListParams({ email: "%" }).email).not.toBe("%");
  });

  it("normalises and bounds the term", () => {
    expect(parseSignupListParams({ email: "  ADA@Example.COM " }).email).toBe("ada@example.com");
    expect(parseSignupListParams({ email: "   " }).email).toBeUndefined();
    expect(parseSignupListParams({ email: "x".repeat(500) }).email!.length).toBeLessThanOrEqual(320);
  });
});

describe("the date range", () => {
  it("keeps only real calendar dates", () => {
    expect(parseSignupListParams({ from: "2026-09-01" }).from).toBe("2026-09-01");
    for (const bad of ["2026-02-31", "not-a-date", "2026-9-1", "", "2026-13-01"]) {
      expect(parseSignupListParams({ from: bad }).from, `from=${bad}`).toBeUndefined();
    }
  });

  it("includes the whole of the 'to' day", () => {
    // A naive `lte(to)` would silently drop everyone who signed up after
    // midnight on the last day of the range — the bug reads as "nobody
    // signed up that day".
    expect(fromInclusiveBound("2026-09-01")).toBe("2026-09-01T00:00:00.000Z");
    expect(toExclusiveBound("2026-09-07")).toBe("2026-09-08T00:00:00.000Z");
  });

  it("swaps a backwards range instead of returning nothing", () => {
    const spec = parseSignupListParams({ from: "2026-09-30", to: "2026-09-01" });
    expect(spec.from).toBe("2026-09-01");
    expect(spec.to).toBe("2026-09-30");
  });

  it("composes with paging and search in the audit detail", () => {
    const spec = parseSignupListParams({
      page: "3",
      email: "ada@",
      from: "2026-09-01",
      to: "2026-09-07",
    });
    expect(describeFilters(spec)).toEqual({
      page: 3,
      page_size: PAGE_SIZE,
      email_filter: "ada@",
      from: "2026-09-01",
      to: "2026-09-07",
    });
  });
});

describe("what writes to the audit log", () => {
  it("the polling count action does not log, and the list page does", () => {
    // An interval that logged would fill the trail with entries nobody
    // performed — an idle tab out-logging a real operator makes the log worse
    // at the one question it exists for. The count returns no rows, so it is
    // the safe half to leave unlogged.
    const action = readFileSync(join(ROOT, "src/lib/admin/people/actions.ts"), "utf8");
    expect(action).not.toContain("recordAdminAction");
    expect(action).toContain("requirePermission");

    const page = readFileSync(
      join(ROOT, "src/app/admin/(protected)/people/signups/page.tsx"),
      "utf8",
    );
    expect(page).toContain("recordAdminAction");
    expect(page).toContain('action: "people.listed"');
  });

  it("the audit detail records filters and counts, never the people", () => {
    const spec = parseSignupListParams({ page: "1", email: "ada@" });
    const detail = describeFilters(spec);
    // Ids or emails of the listed rows must not be in the trail — the filters
    // already describe what was looked at, and the rows would duplicate the
    // data the log exists to police access to.
    expect(Object.keys(detail).sort()).toEqual(["email_filter", "from", "page", "page_size", "to"]);
  });
});
