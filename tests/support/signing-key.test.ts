/** ENV-SKIP-1: tests that need a valid project signing key skip with a clear reason when it is absent or rejected, instead of failing deep inside a hook. */
import { describe, expect, it } from "vitest";
import { SIGNING_KEY_SKIP_REASON, evaluateSigningKey } from "./signing-key";
import { fakeSecret } from "./fake-secret";

describe("evaluateSigningKey", () => {
  it("no secret set: skip, naming the requirement and that it is not set", async () => {
    const r = await evaluateSigningKey({ secret: undefined, probe: async () => ({ status: 200 }) });
    expect(r).toContain(SIGNING_KEY_SKIP_REASON);
    expect(r).toMatch(/not set/);
  });
  it("an empty secret counts as not set", async () => {
    expect(await evaluateSigningKey({ secret: "", probe: async () => ({ status: 200 }) })).toMatch(/not set/);
  });
  it("a secret the project rejects (PGRST301 / 401): skip, saying it was rejected", async () => {
    const r = await evaluateSigningKey({ secret: fakeSecret("token"), probe: async () => ({ status: 401, body: '{"code":"PGRST301","message":"No suitable key or wrong key type"}' }) });
    expect(r).toContain(SIGNING_KEY_SKIP_REASON);
    expect(r).toMatch(/rejected/);
  });
  it("a secret the project accepts: no skip", async () => {
    expect(await evaluateSigningKey({ secret: fakeSecret("token"), probe: async () => ({ status: 200 }) })).toBeNull();
  });
  it("a project that cannot be reached is NOT a signing-key problem: no skip, so the real error still shows", async () => {
    expect(await evaluateSigningKey({ secret: fakeSecret("token"), probe: async () => { throw new Error("fetch failed"); } })).toBeNull();
  });
  it("any other HTTP answer (e.g. 404, 500) is not read as a rejected key", async () => {
    expect(await evaluateSigningKey({ secret: fakeSecret("token"), probe: async () => ({ status: 500 }) })).toBeNull();
  });
  it("the reason never contains the secret", async () => {
    const secret = fakeSecret("token");
    const r = await evaluateSigningKey({ secret, probe: async () => ({ status: 401, body: "PGRST301" }) });
    expect(r).not.toContain(secret);
  });
});
