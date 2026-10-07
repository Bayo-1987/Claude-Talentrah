/** The iframe snippet the Company Profile card shows for an employer to paste (src/lib/embed/snippet.ts). */
import { describe, expect, it } from "vitest";
import { embedUrl, iframeSnippet } from "@/lib/embed/snippet";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("iframeSnippet", () => {
  it("points at the organisation's embed URL on the canonical origin, with a title, a fluid width, a height and lazy loading", () => {
    const s = iframeSnippet({ organizationId: ORG, companyName: "Acme Ltd", origin: "https://www.talentrah.com" });
    expect(s).toBe(`<iframe src="https://www.talentrah.com/embed/jobs/${ORG}" title="Jobs at Acme Ltd" width="100%" height="480" style="border:0" loading="lazy"></iframe>`);
    expect(embedUrl(ORG, "https://www.talentrah.com")).toBe(`https://www.talentrah.com/embed/jobs/${ORG}`);
  });

  it("escapes a company name so it cannot break out of the title attribute or add markup to the employer's page", () => {
    const s = iframeSnippet({ organizationId: ORG, companyName: `Evil" onload="alert(1)"><script>x</script> & Co`, origin: "https://www.talentrah.com" });
    expect(s).not.toContain(`" onload=`);
    expect(s).not.toContain("<script>");
    expect(s).toContain("&quot;");
    expect(s).toContain("&amp; Co");
    expect(s.match(/<iframe/g)).toHaveLength(1);
    expect(s.endsWith("></iframe>")).toBe(true);
  });

  it("never builds a URL from anything but a uuid", () => {
    expect(() => embedUrl("x/../admin", "https://www.talentrah.com")).toThrow();
  });
});
