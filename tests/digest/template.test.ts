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
  // No `tier` field any more — buildDigestEmail derives it (and applies the
  // thin-match cap) from `score` + `explanation` via describeMatchConfidence.
  // No explanation given here means "nothing to say about thinness", which
  // is exactly the marketing-demo/no-data case describeMatchConfidence
  // handles by rendering the plain tier, unqualified — see
  // tests/lib/match-tier.test.ts for the thin/rich cases themselves.
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
    const { text, html } = build([job(), job({ jobId: "j2", score: 74 })]);
    expect(text).toContain("— Farah");
    for (const banned of ["the AI", "the bot", "chatbot", "assistant"]) {
      expect(text.toLowerCase(), `copy called Farah "${banned}"`).not.toContain(banned.toLowerCase());
      expect(html.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("uses only the three system tier words", () => {
    const { text } = build([job({ score: 91 }), job({ score: 73 })]);
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

  describe("thin-denominator match confidence (docs/match-confidence-invariant.md)", () => {
    it(
      "SABOTAGE-PROOF TARGET: a thin-tag score >=80 does not email a confident, unqualified Excellent",
      () => {
        // The exact One Acre Fund / ALX Africa shape from docs/stage8-match-accuracy.md:
        // a single generic screenable tag behind a 99% score. Before this fix,
        // buildDigestEmail built `${score}% ${MATCH_TIER_LABEL[tier]}` directly
        // and would have mailed "99% Excellent" verbatim.
        const thin = job({
          score: 99,
          explanation: { matchedSkills: ["project management"], missingSkills: [] },
        });
        const { text, html } = build([thin, job({ jobId: "j2", score: 74 })]);
        expect(text, "mailed an unqualified 99% Excellent for a one-tag match").not.toContain("99%");
        expect(text).not.toMatch(/99% Excellent/);
        expect(text).toContain("79% Good — thin match");
        expect(html).toContain("79% · Good — thin match");
      },
    );

    it("POSITIVE CONTROL: a genuinely rich-tag Excellent still emails plainly — the fix must not over-correct", () => {
      const rich = job({
        score: 92,
        explanation: {
          matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"],
          missingSkills: ["react"],
        },
      });
      const { text, html } = build([rich, job({ jobId: "j2", score: 74 })]);
      expect(text).toContain("92% Excellent");
      expect(text).not.toContain("thin match");
      expect(html).toContain("92% · Excellent");
    });

    it("no explanation on the row at all renders exactly as before — no qualifier without data to justify it", () => {
      const { text } = build([job({ score: 92 }), job({ jobId: "j2", score: 74 })]);
      expect(text).toContain("92% Excellent");
      expect(text).not.toContain("thin match");
    });
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
