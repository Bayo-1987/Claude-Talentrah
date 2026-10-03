import { describe, expect, it } from "vitest";
import { generateExtendToken, hashExtendToken } from "@/lib/jobs/expiry-reminders/token";

describe("extend tokens", () => {
  it("are long, url-safe and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token } = generateExtendToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("are stored as a sha256 hex hash that is not the token and is deterministic", () => {
    const { token, hash } = generateExtendToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashExtendToken(token)).toBe(hash);
    expect(hashExtendToken(token + "x")).not.toBe(hash);
  });
});
