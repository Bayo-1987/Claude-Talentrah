/**
 * Field extraction (src/lib/employer/job-import/extract.ts) — the two paths
 * ("Import from URL" can pre-fill JobPostingForm from), the fabrication
 * backstop, and the size bound before anything reaches the LLM.
 *
 * The LLM is mocked, same pattern as
 * tests/tailoring/fabrication-backstop.test.ts: this is about a contract
 * (missing fields come back null, never guessed) that must hold regardless
 * of real model behaviour, and it must run in CI with no API budget or
 * provider dependency.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
  LLMProviderError: class LLMProviderError extends Error {
    constructor(
      public provider: string,
      public kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { extractFromStructuredData, extractWithLLM, extractJobFields, sanitizeExtractedFields } = await import(
  "@/lib/employer/job-import/extract"
);
const { MAX_PAGE_TEXT_CHARS } = await import("@/lib/employer/job-import/token-budget");

function htmlWithJsonLd(block: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
    block,
  )}</script></head><body></body></html>`;
}

beforeEach(() => {
  generateText.mockReset();
});

const REAL_JOB_POSTING_JSONLD = {
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  title: "Senior Backend Engineer",
  description: "We build payments infrastructure for African businesses. Node.js, Postgres, 5+ years experience required.",
  datePosted: "2026-09-01",
  employmentType: "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: "Acme Fintech", logo: "https://acme.example/logo.png" },
  jobLocation: {
    "@type": "Place",
    address: { "@type": "PostalAddress", addressLocality: "Lagos", addressCountry: "NG" },
  },
  baseSalary: {
    "@type": "MonetaryAmount",
    currency: "NGN",
    value: { "@type": "QuantitativeValue", minValue: 800000, maxValue: 1200000, unitText: "MONTH" },
  },
};

describe("extractFromStructuredData — deterministic, no LLM involved", () => {
  it("maps a real schema.org JobPosting block to ExtractedJobFields", () => {
    const html = htmlWithJsonLd(REAL_JOB_POSTING_JSONLD);
    const fields = extractFromStructuredData(html);
    expect(fields).not.toBeNull();
    expect(fields?.title).toBe("Senior Backend Engineer");
    expect(fields?.location).toBe("Lagos, NG");
    expect(fields?.employmentType).toBe("full_time");
    expect(fields?.salaryMin).toBe(800000);
    expect(fields?.salaryMax).toBe(1200000);
    expect(fields?.salaryCurrency).toBe("NGN");
    expect(fields?.salaryUnit).toBe("month");
    expect(fields?.description).toContain("payments infrastructure");
  });

  it("returns null (not a crash) when the page has no JobPosting block", () => {
    const html = "<html><body><h1>Careers</h1><p>No structured data here.</p></body></html>";
    expect(extractFromStructuredData(html)).toBeNull();
  });

  it("returns null on a malformed JobPosting block rather than throwing", () => {
    const html = htmlWithJsonLd({ "@type": "JobPosting", title: "" /* invalid: blank title */ });
    expect(() => extractFromStructuredData(html)).not.toThrow();
    expect(extractFromStructuredData(html)).toBeNull();
  });

  it("a listing this feature routes end-to-end via extractJobFields skips the LLM entirely", async () => {
    const html = htmlWithJsonLd(REAL_JOB_POSTING_JSONLD);
    const result = await extractJobFields(html, "irrelevant plain text");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.method).toBe("structured-data");
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("sanitizeExtractedFields — the no-invented-content backstop", () => {
  it("a field the model didn't find comes back null, never a guessed default", () => {
    const fields = sanitizeExtractedFields({
      title: "Delivery Rider",
      location: null,
      description: "Deliver packages across Lagos on a motorbike.",
      workType: null,
      employmentType: null,
      seniority: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryUnit: null,
    });
    expect(fields.title).toBe("Delivery Rider");
    expect(fields.location).toBeNull();
    expect(fields.workType).toBeNull();
    expect(fields.employmentType).toBeNull();
    expect(fields.seniority).toBeNull();
    expect(fields.salaryMin).toBeNull();
    expect(fields.salaryCurrency).toBeNull();
  });

  it("drops a value the model returned in the wrong shape/enum, rather than coercing it", () => {
    const fields = sanitizeExtractedFields({
      title: "Ops Lead",
      location: "Abuja",
      description: "Some real description.",
      workType: "flexible", // not one of remote/hybrid/onsite
      employmentType: 42, // wrong type entirely
      seniority: "senior",
      salaryMin: "not a number",
      salaryMax: 500000,
      salaryCurrency: "Nigerian Naira", // not a 3-letter code
      salaryUnit: "monthly", // not the exact enum value "month"
    });
    expect(fields.workType).toBeNull();
    expect(fields.employmentType).toBeNull();
    expect(fields.seniority).toBe("senior");
    expect(fields.salaryMin).toBeNull();
    expect(fields.salaryCurrency).toBeNull();
    expect(fields.salaryUnit).toBeNull();
  });

  it("an inverted salary range is dropped entirely, not silently swapped", () => {
    const fields = sanitizeExtractedFields({
      title: "Analyst",
      location: null,
      description: null,
      workType: null,
      employmentType: null,
      seniority: null,
      salaryMin: 900000,
      salaryMax: 400000,
      salaryCurrency: "NGN",
      salaryUnit: null,
    });
    expect(fields.salaryMin).toBeNull();
    expect(fields.salaryMax).toBeNull();
  });

  it("non-object model output (e.g. a JSON string or array) yields every field null, not a thrown error", () => {
    expect(sanitizeExtractedFields("not an object")).toEqual(sanitizeExtractedFields(null));
    expect(sanitizeExtractedFields(null).title).toBeNull();
  });

  it("a page with clearly missing fields (the required fabrication-backstop scenario) comes back mostly null", async () => {
    // Simulates the model correctly reporting that a thin page states only
    // a title and a location, nothing else — this is what MUST happen on a
    // real thin careers page, and the test fails if any of the untouched
    // fields below are anything other than null.
    generateText.mockResolvedValue(
      JSON.stringify({
        title: "Warehouse Assistant",
        location: "Kano, Nigeria",
        description: null,
        workType: null,
        employmentType: null,
        seniority: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryUnit: null,
      }),
    );

    const result = await extractWithLLM("Warehouse Assistant needed. Location: Kano, Nigeria. Apply within.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.title).toBe("Warehouse Assistant");
    expect(result.fields.location).toBe("Kano, Nigeria");
    for (const field of [
      "description",
      "workType",
      "employmentType",
      "seniority",
      "salaryMin",
      "salaryMax",
      "salaryCurrency",
      "salaryUnit",
    ] as const) {
      expect(result.fields[field]).toBeNull();
    }
  });
});

describe("extractWithLLM — input size bound", () => {
  it("truncates an oversized page before it ever reaches the model", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        title: "Role",
        location: null,
        description: null,
        workType: null,
        employmentType: null,
        seniority: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryUnit: null,
      }),
    );

    const oversized = "A".repeat(MAX_PAGE_TEXT_CHARS * 5);
    await extractWithLLM(oversized);

    expect(generateText).toHaveBeenCalledTimes(1);
    const sentContent = generateText.mock.calls[0][0].turns[0].content as string;
    // The page text is embedded after a short fixed prefix — bounding
    // TOTAL length is what actually matters here, not the exact prefix.
    expect(sentContent.length).toBeLessThan(MAX_PAGE_TEXT_CHARS + 200);
    expect(sentContent.length).toBeGreaterThan(MAX_PAGE_TEXT_CHARS - 200);
  });

  it("a rate-limit failure from the provider degrades to a clear message, not a crash", async () => {
    const { LLMProviderError } = await import("@/lib/llm");
    generateText.mockRejectedValue(new LLMProviderError("groq", "rate_limit", "429"));
    const result = await extractWithLLM("Some page text.");
    expect(result.ok).toBe(false);
  });

  it("unparseable model output degrades cleanly rather than throwing", async () => {
    generateText.mockResolvedValue("not valid json at all");
    const result = await extractWithLLM("Some page text.");
    expect(result.ok).toBe(false);
  });
});
