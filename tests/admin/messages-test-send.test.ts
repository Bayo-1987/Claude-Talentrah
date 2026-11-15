/**
 * The operator's own test send (src/app/admin/(protected)/messages/test-send.ts): one email to the signed-in operator, a fresh throwaway unsubscribe token on every call, and nothing
 * sent when either switch it needs is off. The flag reader is mocked at its source, so the real inboxEnabled() runs and asks it for the master switch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MassEmail } from "@/lib/email/mass-send";

const h = vi.hoisted(() => ({ flags: new Map<string, boolean>(), asked: [] as string[], sent: [] as MassEmail[], keys: [] as string[] }));

vi.mock("@/lib/flags/read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags/read")>()),
  isFeatureEnabled: async (key: string) => {
    h.asked.push(key);
    return h.flags.get(key) === true;
  },
}));
vi.mock("@/lib/email/mass-send-provider", () => ({
  createResendMassProvider: () => ({
    sendBatch: async (emails: MassEmail[], options: { idempotencyKey: string }) => {
      h.sent.push(...emails);
      h.keys.push(options.idempotencyKey);
      return { kind: "ok", quota: null };
    },
  }),
}));

const { sendTestEmail } = await import("@/app/admin/(protected)/messages/test-send");

const MESSAGE = { id: "m1", kind: "service_announcement" as const, title: "Notice", body: "Body text.", link_path: null, channels: ["email" as const], consent_line: null };
const SWITCHED_OFF = "Admin email is switched off, so no test email was sent.";
const tokenOf = (email: MassEmail) => /token=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(email.text)?.[1];

beforeEach(() => {
  h.flags = new Map([["notifications_master", true], ["admin_email", true]]);
  h.asked = [];
  h.sent = [];
  h.keys = [];
  process.env.MASS_EMAIL_FROM = "Talentrah <announce@mail.example.test>";
});

describe("the test send's unsubscribe token", () => {
  it("is a fresh random token on every call: two test sends carry different tokens", async () => {
    await sendTestEmail(MESSAGE, "operator@example.test");
    await sendTestEmail(MESSAGE, "operator@example.test");
    expect(h.sent).toHaveLength(2);
    const [a, b] = h.sent.map(tokenOf);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  it("the source holds no literal token: the value comes from randomUUID()", () => {
    const src = readFileSync(join(__dirname, "../../src/app/admin/(protected)/messages/test-send.ts"), "utf8");
    expect(src).toMatch(/unsubscribeToken:\s*randomUUID\(\)/);
    expect(src).not.toMatch(/unsubscribeToken:\s*["'`]/);
  });
});

describe("a test send needs both switches", () => {
  it("with both on, one email goes to the operator and to nobody else", async () => {
    expect(await sendTestEmail(MESSAGE, "operator@example.test")).toMatch(/^Test sent to your own address/);
    expect(h.sent.map((e) => e.to)).toEqual(["operator@example.test"]);
    expect(h.sent[0].subject).toBe("[Test] Notice");
  });

  it("with the master switch off nothing is sent and the sentence is the switched-off one", async () => {
    h.flags.set("notifications_master", false);
    expect(await sendTestEmail(MESSAGE, "operator@example.test")).toBe(SWITCHED_OFF);
    expect(h.sent).toEqual([]);
  });

  it("with admin email off nothing is sent and the sentence is the same", async () => {
    h.flags.set("admin_email", false);
    expect(await sendTestEmail(MESSAGE, "operator@example.test")).toBe(SWITCHED_OFF);
    expect(h.sent).toEqual([]);
  });

  it("the master switch is read through inboxEnabled (the flag reader is asked for it by that one function)", async () => {
    await sendTestEmail(MESSAGE, "operator@example.test");
    expect(h.asked).toContain("notifications_master");
    const src = readFileSync(join(__dirname, "../../src/app/admin/(protected)/messages/test-send.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toContain("inboxEnabled()");
    expect(src).not.toMatch(/isFeatureEnabled\(\s*NOTIFICATION_FLAGS\.master/);
  });

  it("a message without the email channel sends nothing and asks for no flag", async () => {
    const out = await sendTestEmail({ ...MESSAGE, channels: ["inapp"] as never }, "operator@example.test");
    expect(out).toMatch(/does not use email/);
    expect(h.sent).toEqual([]);
    expect(h.asked).toEqual([]);
  });
});
