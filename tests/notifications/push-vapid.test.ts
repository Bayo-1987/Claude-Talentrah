import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PushConfigError, VAPID_PRIVATE_KEY_ENV, VAPID_PUBLIC_KEY_ENV, VAPID_SUBJECT_ENV, readVapidConfig, vapidKeysMatch } from "@/lib/notifications/push/vapid";
import { makeVapidPair } from "./push-support";

const ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const env = (over: Record<string, string | undefined> = {}) => {
  const pair = makeVapidPair();
  return { pair, env: { [VAPID_PUBLIC_KEY_ENV]: pair.publicKey, [VAPID_PRIVATE_KEY_ENV]: pair.privateKey, [VAPID_SUBJECT_ENV]: "mailto:ops@example.test", ...over } };
};

describe("the VAPID pair", () => {
  it("the three variable names are the ones the plan fixed", () => {
    expect([VAPID_PUBLIC_KEY_ENV, VAPID_PRIVATE_KEY_ENV, VAPID_SUBJECT_ENV]).toEqual(["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
  });
  it("a matching pair is accepted", () => {
    const { pair, env: e } = env();
    expect(vapidKeysMatch(pair.publicKey, pair.privateKey)).toBe(true);
    expect(readVapidConfig(e)).toEqual({ publicKey: pair.publicKey, privateKey: pair.privateKey, subject: "mailto:ops@example.test" });
  });
  it("the sender refuses to start when the private key does not match the public key", () => {
    const a = makeVapidPair();
    const b = makeVapidPair();
    expect(vapidKeysMatch(a.publicKey, b.privateKey)).toBe(false);
    const { env: e } = env({ [VAPID_PRIVATE_KEY_ENV]: b.privateKey, [VAPID_PUBLIC_KEY_ENV]: a.publicKey });
    expect(() => readVapidConfig(e)).toThrow(PushConfigError);
  });
  it("a missing, empty or malformed value refuses to start", () => {
    for (const name of [VAPID_PUBLIC_KEY_ENV, VAPID_PRIVATE_KEY_ENV, VAPID_SUBJECT_ENV]) {
      expect(() => readVapidConfig(env({ [name]: undefined }).env)).toThrow(PushConfigError);
      expect(() => readVapidConfig(env({ [name]: "" }).env)).toThrow(PushConfigError);
    }
    expect(() => readVapidConfig(env({ [VAPID_PRIVATE_KEY_ENV]: "not-a-key" }).env)).toThrow(PushConfigError);
    expect(() => readVapidConfig(env({ [VAPID_SUBJECT_ENV]: "ops@example.test" }).env)).toThrow(PushConfigError);
  });
  it("the refusal never contains a key, so a failed start cannot leak one into a log", () => {
    const a = makeVapidPair();
    const b = makeVapidPair();
    try {
      readVapidConfig({ [VAPID_PUBLIC_KEY_ENV]: a.publicKey, [VAPID_PRIVATE_KEY_ENV]: b.privateKey, [VAPID_SUBJECT_ENV]: "mailto:ops@example.test" });
      throw new Error("did not refuse");
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify(error)}`;
      for (const secret of [a.publicKey, a.privateKey, b.publicKey, b.privateKey]) expect(text).not.toContain(secret);
    }
  });
  it("the page and the sender read the same public key variable", () => {
    // The sender reads it through the shared name constant; the page-side file is U3b's, so this pins the name both must use and the one copy in the example env.
    expect(read("src/lib/notifications/push/vapid.ts")).toContain("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const example = read(".env.example");
    for (const name of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      const lines = example.split("\n").filter((line) => line.includes(name));
      expect(lines.length).toBe(1);
      expect(lines[0]).toMatch(new RegExp(`^#\\s*${name}=\\s*$`));
    }
    const wiring = read("src/lib/notifications/push/wiring.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(wiring).not.toMatch(/VAPID_PUBLIC_KEY\b(?!_ENV)/);
    expect(wiring).toContain("readVapidConfig(");
  });
});
