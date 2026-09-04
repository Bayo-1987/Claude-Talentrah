"use server";

import { getResendClient, getContactRecipient } from "@/lib/resend/client";
import { contactSchema, type ContactActionState } from "./schemas";

export async function sendContactMessageAction(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
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
