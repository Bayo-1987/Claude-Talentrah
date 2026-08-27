/**
 * SAMPLE_RESUME — the persona a stranger's demo is tailored against.
 *
 * It is handed to a model and its output is returned to an anonymous caller,
 * so everything in it is effectively public. These pin the two properties that
 * would be quietly wrong rather than obviously broken.
 */
import { describe, expect, it } from "vitest";
import { SAMPLE_RESUME } from "@/lib/demo/sample-resume";

describe("nothing in it is anyone's real contact detail", () => {
  it("carries no email or phone", () => {
    /*
     * Anything here is echoed into every demo response. A real address would
     * be published by the landing page — and the earlier draft of this file
     * copied a persona that HAD one, from seed data, which is exactly how that
     * happens by accident.
     */
    expect(SAMPLE_RESUME.contact.email).toBeUndefined();
    expect(SAMPLE_RESUME.contact.phone).toBeUndefined();
  });

  it("still has a name and a city, because the model needs a person", () => {
    expect(SAMPLE_RESUME.contact.name).toBeTruthy();
    expect(SAMPLE_RESUME.contact.location).toContain("Lagos");
  });
});

describe("it is substantial enough to produce a real gap analysis", () => {
  it("has experience, education and skills to match against", () => {
    // An empty or near-empty resume makes every keyword "missing", which reads
    // as the product being broken rather than as the demo working.
    expect(SAMPLE_RESUME.experience.length).toBeGreaterThan(0);
    expect(SAMPLE_RESUME.education.length).toBeGreaterThan(0);
    expect(SAMPLE_RESUME.skills.length).toBeGreaterThanOrEqual(5);
  });

  it("is a standalone literal, not a read of seed data", async () => {
    // Structural: this module must not import anything that reaches the
    // database or scripts/. A public endpoint that depended on seed data would
    // change behaviour when someone edited the demo account and break entirely
    // in an environment that was never seeded.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/demo/sample-resume.ts", "utf8");
    const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/resume/types"]);
  });
});
