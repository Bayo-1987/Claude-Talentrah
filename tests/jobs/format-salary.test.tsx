/**
 * formatSalary — the seeker-facing rendering of job_postings.salary_*,
 * gated identically to src/lib/seo/job-posting-jsonld.ts's baseSalary
 * emission so the two can never disagree about what counts as "a salary
 * worth showing".
 *
 * Split the same way tests/jobs/freshness-note.test.tsx is: pure formatter
 * cases first, then "the card actually renders it" — the module can be
 * perfectly correct and the card still silently drop the line, which is one
 * conditional away and needs its own proof.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { formatSalary } from "@/lib/jobs/format-salary";
import type { Tables } from "@/lib/supabase/types";

type SalaryRow = Pick<Tables<"job_postings">, "salary_min" | "salary_max" | "salary_currency" | "salary_unit">;

function row(over: Partial<SalaryRow> = {}): SalaryRow {
  return {
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_unit: null,
    ...over,
  };
}

describe("formatSalary", () => {
  it("a full range with a unit", () => {
    expect(
      formatSalary(row({ salary_min: 500000, salary_max: 800000, salary_currency: "NGN", salary_unit: "month" })),
    ).toBe("₦500,000 – ₦800,000 per month");
  });

  it("a non-NGN currency renders with its own symbol", () => {
    expect(
      formatSalary(row({ salary_min: 60000, salary_max: 90000, salary_currency: "USD", salary_unit: "year" })),
    ).toBe("US$60,000 – US$90,000 per year");
  });

  it("min only — 'From X'", () => {
    expect(formatSalary(row({ salary_min: 500000, salary_currency: "NGN" }))).toBe("From ₦500,000");
  });

  it("max only — 'Up to X'", () => {
    expect(formatSalary(row({ salary_max: 800000, salary_currency: "NGN" }))).toBe("Up to ₦800,000");
  });

  it("equal min and max (a single stated figure) renders as one amount, not a redundant range", () => {
    expect(formatSalary(row({ salary_min: 90000, salary_max: 90000, salary_currency: "USD" }))).toBe(
      "US$90,000",
    );
  });

  it("no unit is simply absent from the line, not a placeholder word", () => {
    const withUnit = formatSalary(row({ salary_min: 500000, salary_currency: "NGN", salary_unit: "month" }));
    const withoutUnit = formatSalary(row({ salary_min: 500000, salary_currency: "NGN" }));
    expect(withUnit).toBe("From ₦500,000 per month");
    expect(withoutUnit).toBe("From ₦500,000");
    expect(withoutUnit).not.toContain("per");
  });

  it.each(["hour", "day", "week", "month", "year"] as const)("renders the %s unit correctly", (unit) => {
    expect(formatSalary(row({ salary_min: 100, salary_currency: "USD", salary_unit: unit }))).toBe(
      `From US$100 per ${unit}`,
    );
  });

  describe("renders nothing — the gate matches job-posting-jsonld.ts's baseSalary rule exactly", () => {
    it("currency with no bounds at all", () => {
      expect(formatSalary(row({ salary_currency: "NGN" }))).toBeNull();
    });

    it("bounds with no currency", () => {
      expect(formatSalary(row({ salary_min: 500000, salary_max: 800000 }))).toBeNull();
    });

    it("a single bound with no currency", () => {
      expect(formatSalary(row({ salary_min: 500000 }))).toBeNull();
    });

    it("nothing at all", () => {
      expect(formatSalary(row())).toBeNull();
    });

    it("a currency Intl cannot format at all degrades to null, not a thrown error or a raw code", () => {
      // salary_currency's only real guarantee is SHAPE (3 letters) — this
      // exercises the defensive try/catch as insurance, not because today's
      // writers (schema-org's mapCurrency, the employer form) can produce it.
      // Confirmed this shape genuinely throws inside Intl.NumberFormat
      // (`Invalid currency code : NOT-A-CODE`) before asserting the catch.
      let result: string | null = "not yet called";
      expect(() => {
        result = formatSalary(row({ salary_min: 1, salary_currency: "NOT-A-CODE" }));
      }).not.toThrow();
      expect(result).toBeNull();
    });
  });

  describe("PostgREST's numeric-as-string quirk", () => {
    // `numeric` columns can arrive as strings over the wire — never trust the
    // declared TypeScript type over what actually came back.
    it("accepts string-typed bounds", () => {
      expect(
        formatSalary(
          row({
            salary_min: "500000" as unknown as number,
            salary_max: "800000" as unknown as number,
            salary_currency: "NGN",
          }),
        ),
      ).toBe("₦500,000 – ₦800,000");
    });

    it("an unparsable string bound is treated as absent, not zero", () => {
      expect(
        formatSalary(row({ salary_min: "not-a-number" as unknown as number, salary_currency: "NGN" })),
      ).toBeNull();
    });
  });
});

describe("the card actually renders it", () => {
  function card(over: Partial<Tables<"job_postings">> = {}) {
    return renderToStaticMarkup(
      <JobCard
        job={
          {
            id: "job-1",
            title: "Senior Backend Engineer",
            company_name: "Zaria Digital",
            description: "A fixture posting for the salary display test.",
            location: "Lagos",
            work_type: null,
            seniority: null,
            employment_type: null,
            external_url: null,
            status: "open",
            source_type: "internal",
            posted_at: new Date().toISOString(),
            last_checked_at: new Date().toISOString(),
            salary_min: null,
            salary_max: null,
            salary_currency: null,
            salary_unit: null,
            ...over,
          } as unknown as Tables<"job_postings">
        }
        score={75}
        isSaved={false}
        applicationStage={null}
        explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
        origin="https://talentrah.test"
      />,
    );
  }

  it("prints the salary line when the row has one", () => {
    const html = card({ salary_min: 500000, salary_max: 800000, salary_currency: "NGN", salary_unit: "month" });
    expect(html).toContain("₦500,000");
    expect(html).toContain("per month");
  });

  it("prints nothing at all when the row has none — no placeholder, no empty row", () => {
    const html = card();
    expect(html).not.toContain("₦");
    expect(html).not.toContain("Salary");
    expect(html).not.toContain("not disclosed");
  });

  it("prints nothing when currency is set but neither bound is", () => {
    const html = card({ salary_currency: "NGN" });
    expect(html).not.toContain("₦");
  });

  it("prints nothing when a bound is set but currency is not", () => {
    const html = card({ salary_min: 500000 });
    expect(html).not.toContain("500,000");
  });
});
