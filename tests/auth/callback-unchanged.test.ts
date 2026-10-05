/**
 * The emailed-link route is NOT touched by signing up with a code (S1-101): people who signed up before the email template changed still hold a link, and it
 * has to keep working exactly as it did. tests/auth/callback-cookies.test.ts proves what the route DOES; this pins that the file itself has not changed.
 * If you change the route on purpose, update the hash and say why in the commit.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("/auth/callback", () => {
  it("is byte-for-byte what it was before the code page existed", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/app/auth/callback/route.ts"));
    expect(createHash("sha256").update(src).digest("hex")).toBe("fbd29eddd4da6768c27d0f824b154332f828d31a752bb4bdbcc6fd2241d5df1c");
  });
});
