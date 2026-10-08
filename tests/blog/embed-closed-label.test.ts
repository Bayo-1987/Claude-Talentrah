/**
 * The blog embed's fact card for a scholarship whose deadline has PASSED but whose listing is still 'verified' (the daily expiry sweep takes it off 'verified' later, after which the
 * card becomes the fallback notice). It used to pass `showClosed: false`, so for up to a day the card showed a bare date ("Deadline: 20 Oct 2026") with nothing saying it had closed. It now
 * reads "<date> · Closed", the same words the scholarship card and detail page use. Pure function; the module builds a Supabase client at import, so the env is stubbed first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ loadPublicScholarship: vi.fn() }));
vi.mock("@/lib/scholarships/public", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/scholarships/public")>()), loadPublicScholarship: loader.loadPublicScholarship }));

type FactCard = (id: string, row: Record<string, string | null>) => string;
let factCardHtml: FactCard;
let resolveScholarshipEmbeds: (body: string) => Promise<string>;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-import-only");
  const mod = (await import("@/lib/blog/scholarship-embed")) as unknown as { factCardHtml: FactCard; resolveScholarshipEmbeds: (body: string) => Promise<string> };
  factCardHtml = mod.factCardHtml;
  resolveScholarshipEmbeds = mod.resolveScholarshipEmbeds;
});
afterAll(() => vi.unstubAllEnvs());

const ID = "df5233e0-8963-4f84-b983-a76bd3f247f0";
const row = (over: Record<string, string | null> = {}) => ({
  provider: "Example Foundation",
  program_name: "Example Scholarship",
  application_deadline: "2020-01-01",
  close_time: "11:00",
  close_tz: "UTC",
  deadline_note: null,
  deadline_verified_at: null,
  ...over,
});

describe("factCardHtml after the deadline has passed", () => {
  it("says Closed next to the date, not a bare date", () => {
    const html = factCardHtml(ID, row());
    expect(html).toContain("Deadline: 1 Jan 2020 · Closed");
  });
  it("still links to the listing", () => {
    expect(factCardHtml(ID, row())).toContain(`href="/scholarships/${ID}"`);
  });
});

describe("factCardHtml before the deadline (unchanged)", () => {
  it("shows the date and a countdown, never 'Closed'", () => {
    const year = new Date().getUTCFullYear() + 2;
    const html = factCardHtml(ID, row({ application_deadline: `${year}-06-15` }));
    expect(html).not.toContain("Closed");
    expect(html).toContain(`15 Jun ${year}`);
  });
  it("a listing with no recorded deadline shows the provider's note, as before", () => {
    const html = factCardHtml(ID, row({ application_deadline: null, close_time: null, close_tz: null, deadline_note: null }));
    expect(html).not.toContain("Closed");
  });
});

describe("the whole embed, from the token in a post body", () => {
  const body = `Intro.\n\n[[scholarship:${ID}]]\n\nOutro.`;
  it("a closed-but-still-verified listing reads 'Closed' in the post", async () => {
    loader.loadPublicScholarship.mockResolvedValueOnce(row());
    const out = await resolveScholarshipEmbeds(body);
    expect(out).toContain("Deadline: 1 Jan 2020 · Closed");
  });
  it("a listing the daily sweep has taken off 'verified' (the loader returns nothing) still falls back to the plain notice, with no date at all", async () => {
    loader.loadPublicScholarship.mockResolvedValueOnce(null);
    const out = await resolveScholarshipEmbeds(body);
    expect(out).toContain("isn't currently available");
    expect(out).toContain('href="/scholarships/apply-now"');
    expect(out).not.toContain("Closed");
    expect(out).not.toContain("Deadline:");
  });
  it("an open listing is unchanged by the label: date and countdown, no 'Closed'", async () => {
    const year = new Date().getUTCFullYear() + 2;
    loader.loadPublicScholarship.mockResolvedValueOnce(row({ application_deadline: `${year}-06-15` }));
    const out = await resolveScholarshipEmbeds(body);
    expect(out).toContain(`15 Jun ${year}`);
    expect(out).not.toContain("Closed");
  });
});
