"use client";

import { useSearchParams } from "next/navigation";
import { contactTopicFromParam } from "@/lib/contact/schemas";
import { ContactForm } from "./contact-form";

/**
 * Reads `?topic=` in the browser, so /contact itself stays a static page (reading searchParams on the server would
 * make every request render it). The page wraps this in <Suspense> with the plain form as the fallback: the static HTML
 * is the form with no topic chosen, and on the client this replaces it already holding the right one. A repeated
 * `?topic=` is treated as unknown rather than guessing which was meant.
 */
export function ContactFormFromLink() {
  const topics = useSearchParams()?.getAll("topic") ?? [];
  return <ContactForm initialTopic={contactTopicFromParam(topics.length === 1 ? topics[0] : undefined)} />;
}
