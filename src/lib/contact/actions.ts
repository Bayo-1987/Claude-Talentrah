"use server";

import { getResendClient, getContactRecipient } from "@/lib/resend/client";
import { contactSchema, CONTACT_HONEYPOT_FIELD, type ContactActionState } from "./schemas";
import { consumeContactRateLimit } from "./rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";

/** Identical to a real success response — a bot must never learn it was caught. */
const HONEYPOT_TRIPPED_RESPONSE: ContactActionState = { status: "success", error: null };

export async function sendContactMessageAction(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  /*
   * send-405 — honeypot, checked FIRST and unconditionally, before any real
   * validation runs: a submission with the hidden field filled in gets the
   * exact same success response a real one gets, no matter what else is
   * wrong with it, and no email is sent. Telling a bot its submission was
   * rejected just teaches it to adapt — silence is the point.
   */
  if (formData.get(CONTACT_HONEYPOT_FIELD)) {
    return HONEYPOT_TRIPPED_RESPONSE;
  }

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    topic: formData.get("topic"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      error: "Check the highlighted fields below.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  /*
   * Per-IP throttle BEFORE the real send — same ordering discipline as the
   * auth Server Actions: schema validation first (so malformed input never
   * consumes a real caller's budget), then the rate-limit check, then the
   * real work.
   */
  const ip = await getRequestIp();
  const rateLimit = await consumeContactRateLimit(ip);
  if (!rateLimit.allowed) {
    return {
      status: "error",
      error: "Too many messages from this connection — try again later.",
    };
  }

  const { name, email, topic, message } = parsed.data;
  const resend = getResendClient();

  // Not a hard failure — the page's mailto link is a real fallback, so a
  // missing RESEND_API_KEY degrades to "tell the visitor to email us
  // directly" rather than a broken form with no explanation.
  if (!resend) {
    return {
      status: "error",
      error:
        "The contact form isn't wired up yet — please email us directly at " +
        getContactRecipient() +
        " instead.",
    };
  }

  const { error } = await resend.emails.send({
    from: "Talentrah Contact Form <contact@talentrah.com>",
    to: getContactRecipient(),
    replyTo: email,
    subject: `[${topic}] Message from ${name}`,
    text: `From: ${name} <${email}>\nTopic: ${topic}\n\n${message}`,
  });

  if (error) {
    return {
      status: "error",
      error: "Something went wrong sending your message — please try emailing us directly instead.",
    };
  }

  return { status: "success", error: null };
}
