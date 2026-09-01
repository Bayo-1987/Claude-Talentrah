/**
 * The digest email itself.
 *
 * Two classes of thing are pinned here, and they fail differently:
 *
 *   VOICE AND VOCABULARY — §6.10 makes a match digest Farah-voiced, and the
 *   design system fixes exactly three tier words. Prose inventing "a great
 *   match" is a fourth tier, which is how a score comes to mean different
 *   things on different screens. Nothing catches that at runtime.
 *
 *   ESCAPING — job titles and company names are ingested from third-party
 *   boards. They are attacker-adjacent strings being interpolated into HTML
 *   that lands in somebody's inbox.
 */
import { describe, expect, it } from "vitest";
import { buildDigestEmail } from "@/lib/digest/template";
import type { DigestJob } from "@/lib/digest/select";

const job = (over: Partial<DigestJob> = {}): DigestJob => ({
  jobId: "j1",
  title: "Backend Engineer",
  companyName: "Zaria Digital",
  location: "Lagos, Nigeria",
  score: 88,
  tier: "excellent",
  ...over,
});

const build = (jobs: DigestJob[], firstName: string | null = "Ada") =>
  buildDigestEmail({ firstName, jobs, unsubscribeToken: "tok-123", ...{} });

describe("it refuses to render an empty digest", () => {
  it("throws rather than sending 'no matches this week'", () => {
    /*
     * The silence rule is enforced by the selector; this is the backstop. An
     * empty digest is the exact thing that rule exists to prevent, so a bug
     * producing one should be loud rather than land in an inbox.
     */
    expect(() => build([])).toThrow(/no jobs/i);
  });
});

describe("voice and vocabulary", () => {
  it("signs off as Farah, and never calls her the AI or a bot", () => {
    const { text, html } = build([job(), job({ jobId: "j2", score: 74, tier: "good" })]);
    expect(text).toContain("— Farah");
    for (const banned of ["the AI", "the bot", "chatbot", "assistant"]) {
      expect(text.toLowerCase(), `copy called Farah "${banned}"`).not.toContain(banned.toLowerCase());
      expect(html.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("uses only the three system tier words", () => {
    const { text } = build([job({ score: 91, tier: "excellent" }), job({ score: 73, tier: "good" })]);
    expect(text).toContain("Excellent");
    expect(text).toContain("Good");
    for (const invented of ["great match", "strong match", "perfect match", "top match"]) {
      expect(text.toLowerCase()).not.toContain(invented);
    }
  });

  it("counts correctly in the subject, singular and plural", () => {
    expect(build([job(), job({ jobId: "j2" })]).subject).toContain("2 new jobs");
    expect(build([job()]).subject).toMatch(/^1 new job worth/);
  });

  it("greets without a name rather than printing an empty one", () => {
    expect(build([job(), job({ jobId: "j2" })], null).text).toContain("Hi,");
    expect(build([job(), job({ jobId: "j2" })], null).text).not.toMatch(/Hi (null|undefined)/);
  });
});

describe("every send carries a way out", () => {
  it("puts the unsubscribe token in both the text and the HTML", () => {
    const { text, html } = build([job(), job({ jobId: "j2" })]);
    expect(text).toContain("/unsubscribe?token=tok-123");
    expect(html).toContain("/unsubscribe?token=tok-123");
  });

  it("links absolutely — a relative URL is dead in an email client", () => {
    const { text, html } = build([job(), job({ jobId: "j2" })]);
    expect(text).toMatch(/https?:\/\/\S+\/unsubscribe\?token=/);
    expect(html).toMatch(/href="https?:\/\/[^"]*\/unsubscribe\?token=/);
  });

  it("always ships a plain-text part alongside the HTML", () => {
    // Low-end Android on expensive data is the target market; HTML-only means
    // some people receive nothing readable.
    const { text, html } = build([job(), job({ jobId: "j2" })]);
    expect(text.length).toBeGreaterThan(80);
    expect(html).toContain("<html>");
  });
});

describe("ingested strings are escaped", () => {
  it("neutralises markup in a title or company name", () => {
    const { html } = build([
      job({ title: '<script>alert(1)</script>', companyName: '"><img src=x onerror=alert(1)>' }),
      job({ jobId: "j2" }),
    ]);
    /*
     * The assertion is about POSITION, not about the substring. An earlier
     * version of this test failed on `onerror=alert(1)` still appearing —
     * which it does, as inert text, because the `<` and `>` around it are
     * escaped. Searching for the payload is the wrong check: what matters is
     * that no attacker-supplied tag survives as markup.
     */
    expect(html, "raw script tag reached the email body").not.toContain("<script>");
    expect(html, "an injected <img> became a real element").not.toMatch(/<img\b/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes the token in the href so it cannot break out of the attribute", () => {
    const { html } = buildDigestEmail({
      firstName: "Ada",
      jobs: [job(), job({ jobId: "j2" })],
      unsubscribeToken: '"><b>x',
    });
    expect(html).not.toContain('token="><b>x');
  });
});
