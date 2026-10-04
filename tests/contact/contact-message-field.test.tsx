/**
 * S1-56 PR 1a — the contact message box is the shared TextArea, and the server now has the cap it never had.
 *
 * Before this the schema only enforced a minimum of 10, so a message of any size could be mailed. The cap (5000, the same number the
 * counter shows) is enforced in the zod schema and therefore in sendContactMessageAction, before any rate-limit budget is spent or
 * email sent. No database is needed: the rate limiter, IP lookup and mail client are mocked at the module boundary.
 */
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIELD_LIMITS, fitsLimit } from "@/lib/text-limits";
import { CONTACT_HONEYPOT_FIELD, contactSchema } from "@/lib/contact/schemas";

const send = vi.fn<(payload: unknown) => Promise<{ data: { id: string }; error: null }>>(async () => ({ data: { id: "mock" }, error: null }));
const consume = vi.fn<(ip: string) => Promise<{ allowed: boolean }>>(async () => ({ allowed: true }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({ emails: { send } }),
  getContactRecipient: () => "support@talentrah.test",
}));
vi.mock("@/lib/contact/rate-limit", () => ({ consumeContactRateLimit: (ip: string) => consume(ip) }));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => "203.0.113.7" }));

const { sendContactMessageAction } = await import("@/lib/contact/actions");
const { ContactForm } = await import("@/app/contact/contact-form");

const IDLE = { status: "idle" as const, error: null };
const TOO_LONG = "Your message is over the 5,000 limit. Shorten it (an emoji counts as two).";

function form(message: string): FormData {
  const f = new FormData();
  f.set("name", "Ada Lovelace");
  f.set("email", "ada@example.com");
  f.set("topic", "General question");
  f.set("message", message);
  return f;
}

beforeEach(() => {
  send.mockClear();
  consume.mockClear();
});

describe("the contact message box", () => {
  const html = renderToStaticMarkup(createElement(ContactForm));
  const t = /<textarea\b[^>]*>/.exec(html)![0];

  it("keeps the id, name, label and required it always had", () => {
    expect(t).toContain('id="message"');
    expect(t).toContain('name="message"');
    expect(t).toMatch(/\brequired\b/);
    expect(html).toMatch(/<label[^>]*for="message"[^>]*>Message<\/label>/);
  });

  it("is a writing box of at least 6 rows with a counter and a hard cap", () => {
    expect(t).toContain('rows="6"');
    expect(t).toContain("resize-y");
    expect(html).toContain(`0 / ${FIELD_LIMITS.contactMessage}`);
    expect(t).toContain(`maxLength="${FIELD_LIMITS.contactMessage}"`);
  });

  it("keeps the honeypot, off-screen and out of the tab order, and the other fields", () => {
    expect(html).toMatch(new RegExp(`<input[^>]*name="${CONTACT_HONEYPOT_FIELD}"[^>]*tabindex="-1"[^>]*aria-hidden="true"|<input[^>]*tabindex="-1"[^>]*name="${CONTACT_HONEYPOT_FIELD}"`, "i"));
    for (const name of ["name", "email", "topic"]) expect(html).toContain(`name="${name}"`);
  });
});

describe("the server enforces the same cap", () => {
  it("a message at the cap is accepted and mailed", async () => {
    const result = await sendContactMessageAction(IDLE, form("x".repeat(FIELD_LIMITS.contactMessage)));
    expect(result).toEqual({ status: "success", error: null });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("one character over is refused with the message on the field, before any budget or mail", async () => {
    const result = await sendContactMessageAction(IDLE, form("x".repeat(FIELD_LIMITS.contactMessage + 1)));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.message?.[0]).toBe(TOO_LONG);
    expect(consume).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("counts a CRLF line break (what a real form post sends) as ONE character, like the box", async () => {
    const atCap = `${Array.from({ length: 2500 }, () => "a").join("\r\n")}x`; // 5000 counted (2500 lines of "a", 2499 breaks, then "x")
    expect(atCap.length).toBeGreaterThan(FIELD_LIMITS.contactMessage);
    expect((await sendContactMessageAction(IDLE, form(atCap))).status).toBe("success");
    const over = await sendContactMessageAction(IDLE, form(`${atCap}x`));
    expect(over.fieldErrors?.message?.[0]).toBe(TOO_LONG);
  });

  it("counts trimmed, like the counter", () => {
    const padded = contactSchema.safeParse({ name: "A", email: "a@b.co", topic: "Other", message: `   ${"x".repeat(FIELD_LIMITS.contactMessage)}   ` });
    expect(padded.success).toBe(true);
  });

  it("agrees with fitsLimit on both sides of the boundary", () => {
    for (const n of [FIELD_LIMITS.contactMessage - 1, FIELD_LIMITS.contactMessage, FIELD_LIMITS.contactMessage + 1]) {
      const message = "z".repeat(n);
      const ok = contactSchema.safeParse({ name: "A", email: "a@b.co", topic: "Other", message }).success;
      expect(ok, `length ${n}`).toBe(fitsLimit(message, FIELD_LIMITS.contactMessage));
    }
  });

  it("keeps the minimum of 10 and the honeypot's silent success", async () => {
    const short = await sendContactMessageAction(IDLE, form("too short"));
    expect(short.fieldErrors?.message?.[0]).toBe("Give us a bit more detail (at least 10 characters)");
    const bait = form("x".repeat(FIELD_LIMITS.contactMessage + 50));
    bait.set(CONTACT_HONEYPOT_FIELD, "http://bot.example");
    expect(await sendContactMessageAction(IDLE, bait)).toEqual({ status: "success", error: null });
    expect(send).not.toHaveBeenCalled();
  });
});
