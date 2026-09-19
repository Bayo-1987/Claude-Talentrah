/**
 * sendContactMessageAction's own honeypot + per-IP throttle (send-405).
 * Mirrors tests/auth/signin-rate-limit-wiring.test.ts's approach: the
 * underlying rate limiter is proven directly elsewhere
 * (tests/contact/contact-rate-limit.test.ts) — this file proves the ACTION
 * actually calls it, calls it before the real Resend send, and — the honeypot
 * half — that a tripped submission gets an identical success response
 * without ever calling Resend at all.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { CONTACT_HONEYPOT_FIELD } from "@/lib/contact/schemas";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Contact action wiring test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const sentEmails: unknown[] = [];

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: {
      send: async (payload: unknown) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
  getContactRecipient: () => "support@talentrah.test",
}));

const headerStore = { current: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.current.get(name) ?? null,
  }),
}));

const { sendContactMessageAction } = await import("@/lib/contact/actions");

function setIp(ip: string) {
  headerStore.current = new Map([["x-forwarded-for", ip]]);
}

function contactForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("name", "Ada Lovelace");
  fd.set("email", "prober@talentrah.test");
  fd.set("topic", "General question");
  fd.set("message", "This is a real message, definitely more than ten characters long.");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

const testKeys: string[] = [];

beforeEach(() => {
  sentEmails.length = 0;
});

afterAll(async () => {
  if (testKeys.length) {
    const { error } = await admin.from("anonymous_rate_limits").delete().in("rate_key", testKeys);
    if (error) console.warn(`[cleanup] could not delete fixture rate-limit rows: ${error.message}`);
  }
});

describe("the honeypot field", () => {
  it("a filled honeypot silently succeeds — identical response to a real submission, no email sent", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 30) + 1}`;
    testKeys.push(ip);
    setIp(ip);

    const result = await sendContactMessageAction(
      { status: "idle", error: null },
      contactForm({ [CONTACT_HONEYPOT_FIELD]: "http://spam-bot.example" }),
    );

    expect(result).toEqual({ status: "success", error: null });
    expect(sentEmails).toHaveLength(0);
  });

  it("a filled honeypot succeeds silently even with otherwise-invalid fields — never a validation error", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 30) + 40}`;
    testKeys.push(ip);
    setIp(ip);

    const fd = new FormData();
    fd.set(CONTACT_HONEYPOT_FIELD, "bot-filled-this");
    // Deliberately missing every other required field.

    const result = await sendContactMessageAction({ status: "idle", error: null }, fd);
    expect(result).toEqual({ status: "success", error: null });
    expect(sentEmails).toHaveLength(0);
  });

  it("an empty honeypot does not affect a real submission", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 30) + 80}`;
    testKeys.push(ip);
    setIp(ip);

    const result = await sendContactMessageAction({ status: "idle", error: null }, contactForm());
    expect(result.status).toBe("success");
    expect(sentEmails).toHaveLength(1);
  });
});

describe("sendContactMessageAction's per-IP rate limit", () => {
  it("denies the caller BEFORE the real Resend send once this IP's own budget is spent", async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 30) + 120}`;
    testKeys.push(ip);
    setIp(ip);

    // Spend the configured contact-form budget (3/hour) for this IP.
    for (let i = 0; i < 3; i++) {
      await sendContactMessageAction({ status: "idle", error: null }, contactForm());
    }
    expect(sentEmails).toHaveLength(3);

    // The 4th attempt from the SAME IP must be refused without ever calling
    // Resend.
    const result = await sendContactMessageAction({ status: "idle", error: null }, contactForm());
    expect(sentEmails).toHaveLength(3);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/too many messages/i);
  });
});
